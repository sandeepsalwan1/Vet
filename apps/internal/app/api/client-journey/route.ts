import {
  cancelClientJourneyMessages,
  createClientJourneyEvent,
  createTask,
  getClientJourneySettings,
  getClientJourneySnapshot,
  recordClientJourneyResponse,
  saveClientContactPreferences,
  type ClientJourneyEvent,
  type ClientJourneyMessage
} from "@central-vet/db";
import { planPetCheckMessage } from "@central-vet/notifications";
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { dbError, noStoreHeaders } from "../_apiResponse";
import { resolveClinicFromRequest } from "../_shared";
import { persistClientJourneyPlans } from "./_messagePlans";

export const dynamic = "force-dynamic";

const preferencesSchema = z.object({
  action: z.literal("preferences"),
  emailEnabled: z.boolean(),
  smsConsent: z.boolean(),
  preferredChannel: z.enum(["email", "sms", "both"])
});

const feedbackSchema = z.object({
  action: z.literal("feedback"),
  responseType: z.enum(["visit_experience", "pet_health"]),
  sentiment: z.enum(["up", "down"]),
  comment: z.string().trim().max(1000).optional().nullable()
});

const recordsRequestSchema = z.object({ action: z.literal("records_request") });

const insuranceSchema = z.object({
  action: z.literal("insurance_help"),
  provider: z.string().trim().max(120).optional().nullable(),
  memberNumber: z.string().trim().max(120).optional().nullable()
});

const actionSchema = z.discriminatedUnion("action", [
  preferencesSchema,
  feedbackSchema,
  recordsRequestSchema,
  insuranceSchema
]);

const systemActor = { name: "Client journey", role: "admin" as const };

export function hasOutstandingFeedbackPrompt(
  snapshot: {
    messages: Array<Pick<ClientJourneyMessage, "messageType" | "status" | "scheduledFor">>;
    events: Array<Pick<ClientJourneyEvent, "eventType" | "occurredAt">>;
  },
  responseType: "visit_experience" | "pet_health",
  now = Date.now()
) {
  const messageType = responseType === "pet_health" ? "pet_health_check" : "visit_experience";
  return snapshot.messages.some((message) => {
    const scheduledAt = new Date(message.scheduledFor).getTime();
    if (message.messageType !== messageType || !["planned", "sent"].includes(message.status) || scheduledAt > now) return false;
    return !snapshot.events.some((event) =>
      (event.eventType === `${responseType}_up` || event.eventType === `${responseType}_down`) &&
      new Date(event.occurredAt).getTime() >= scheduledAt
    );
  });
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function bearerToken(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  return authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
}

async function authenticatedSnapshot(request: Request) {
  const clinic = await resolveClinicFromRequest(request);
  const token = bearerToken(request);
  if (!token) return { clinic, snapshot: null };
  return {
    clinic,
    snapshot: await getClientJourneySnapshot({ clinicId: clinic.clinicId, tokenHash: sha256(token) })
  };
}

export async function GET(request: Request) {
  try {
    const { clinic, snapshot } = await authenticatedSnapshot(request);
    if (!snapshot) {
      if (new URL(request.url).searchParams.get("public") === "1") {
        return NextResponse.json({ settings: await getClientJourneySettings({ clinicId: clinic.clinicId }) }, { headers: noStoreHeaders });
      }
      return NextResponse.json({ error: "Sign in again to view this journey." }, { status: 401 });
    }
    return NextResponse.json(snapshot, { headers: noStoreHeaders });
  } catch (error) {
    return dbError(error, { route: "client-journey.get" });
  }
}

async function createFollowupTask(args: {
  clinicId: string;
  idempotencyKey?: string;
  hospitalName: string;
  clientName: string;
  clientPhone: string;
  petName: string;
  request: string;
  notes: string;
  priority: "medium" | "high";
  requestType?: "patient_update" | "records_request";
}) {
  return createTask({
    clinicId: args.clinicId,
    idempotencyKey: args.idempotencyKey,
    hospitalName: args.hospitalName,
    status: "due",
    source: "client_form",
    clientName: args.clientName,
    clientPhone: args.clientPhone,
    petName: args.petName,
    request: args.request,
    requestType: args.requestType ?? "patient_update",
    notes: args.notes,
    priority: args.priority,
    dueDate: new Date().toISOString().slice(0, 10),
    dueTime: "19:00"
  }, systemActor);
}

export async function POST(request: Request) {
  try {
    const parsed = actionSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Check the submitted details." }, { status: 400 });
    const { clinic, snapshot } = await authenticatedSnapshot(request);
    if (!snapshot) return NextResponse.json({ error: "Sign in again to continue." }, { status: 401 });
    const profile = snapshot.profile;

    if (parsed.data.action === "preferences") {
      await saveClientContactPreferences({
        clinicId: clinic.clinicId,
        clientId: profile.clientId,
        email: profile.email,
        phone: profile.phone,
        emailEnabled: parsed.data.emailEnabled,
        smsConsent: parsed.data.smsConsent,
        preferredChannel: parsed.data.preferredChannel
      });
      await createClientJourneyEvent({
        clinicId: clinic.clinicId,
        clientId: profile.clientId,
        petId: profile.petId,
        eventType: "communication_preferences_updated",
        audience: "both",
        source: "customer_portal",
        summary: parsed.data.smsConsent ? "Email and consent-based text preferences saved." : "Email preference saved. Text messages are off."
      });
      return NextResponse.json({ ok: true, message: "Communication preferences saved." });
    }

    if (parsed.data.action === "feedback") {
      if (!hasOutstandingFeedbackPrompt(snapshot, parsed.data.responseType)) {
        return NextResponse.json({ error: "That follow-up is not available yet." }, { status: 409 });
      }
      let taskId: string | null = null;
      if (parsed.data.sentiment === "down") {
        const task = await createFollowupTask({
          clinicId: clinic.clinicId,
          idempotencyKey: [
            "client-feedback",
            profile.clientId,
            profile.petId,
            snapshot.appointment?.id ?? "no-appointment",
            parsed.data.responseType
          ].join("/"),
          hospitalName: clinic.name,
          clientName: profile.clientName,
          clientPhone: profile.phone,
          petName: profile.petName,
          request: parsed.data.responseType === "pet_health"
            ? `Clinical callback requested after ${profile.petName}'s visit.`
            : `Service recovery follow-up requested after ${profile.petName}'s visit.`,
          notes: parsed.data.comment || "Client selected thumbs down in the secure portal.",
          priority: parsed.data.responseType === "pet_health" ? "high" : "medium"
        });
        taskId = task.id;
      }
      await recordClientJourneyResponse({
        clinicId: clinic.clinicId,
        clientId: profile.clientId,
        petId: profile.petId,
        appointmentId: snapshot.appointment?.id,
        responseType: parsed.data.responseType,
        sentiment: parsed.data.sentiment,
        comment: parsed.data.comment,
        followupTaskId: taskId
      });
      const summary = parsed.data.sentiment === "up"
        ? parsed.data.responseType === "pet_health" ? `Glad to hear ${profile.petName} is doing well.` : "Thanks for telling us the visit went well."
        : "Thanks for telling us. A team member will follow up.";
      const eventId = await createClientJourneyEvent({
        clinicId: clinic.clinicId,
        clientId: profile.clientId,
        petId: profile.petId,
        appointmentId: snapshot.appointment?.id,
        eventType: `${parsed.data.responseType}_${parsed.data.sentiment}`,
        audience: "customer",
        source: "customer_portal",
        summary
      });
      if (parsed.data.responseType === "visit_experience" && parsed.data.sentiment === "up") {
        await persistClientJourneyPlans({
          clinicId: clinic.clinicId,
          clientId: profile.clientId,
          petId: profile.petId,
          appointmentId: snapshot.appointment?.id,
          eventId,
          plans: planPetCheckMessage({
            settings: snapshot.settings,
            profile,
            preferences: snapshot.preferences,
            appointmentId: snapshot.appointment?.id ?? null
          })
        });
      } else if (parsed.data.responseType === "visit_experience" && parsed.data.sentiment === "down") {
        await cancelClientJourneyMessages({
          clinicId: clinic.clinicId,
          clientId: profile.clientId,
          appointmentId: snapshot.appointment?.id,
          messageTypes: ["pet_health_check"],
          reason: "Suppressed after negative visit response; service recovery task created."
        });
      }
      return NextResponse.json({ ok: true, message: summary });
    }

    if (parsed.data.action === "records_request") {
      await createFollowupTask({
        clinicId: clinic.clinicId,
        idempotencyKey: `records-request/${profile.clientId}/${profile.petId}/${new Date().toISOString().slice(0, 10)}`,
        hospitalName: clinic.name,
        clientName: profile.clientName,
        clientPhone: profile.phone,
        petName: profile.petName,
        request: `Help ${profile.clientName} with a records request for ${profile.petName}.`,
        requestType: "records_request",
        notes: "Client requested records through the portal. Staff must confirm authorization, recipient, and scope before release.",
        priority: "medium"
      });
      await createClientJourneyEvent({
        clinicId: clinic.clinicId,
        clientId: profile.clientId,
        petId: profile.petId,
        eventType: "records_request_created",
        audience: "both",
        source: "customer_portal",
        summary: "Records help requested from staff."
      });
      return NextResponse.json({ ok: true, message: "Records request sent to the front desk." });
    }

    await createFollowupTask({
      clinicId: clinic.clinicId,
      idempotencyKey: `insurance-help/${profile.clientId}/${profile.petId}/${new Date().toISOString().slice(0, 10)}`,
      hospitalName: clinic.name,
      clientName: profile.clientName,
      clientPhone: profile.phone,
      petName: profile.petName,
      request: `Help ${profile.clientName} prepare a pet-insurance claim packet.`,
      requestType: "records_request",
      notes: `Provider: ${parsed.data.provider || "Not provided"}. Member number supplied: ${parsed.data.memberNumber ? "yes" : "no"}. Keep claim identifiers private.`,
      priority: "medium"
    });
    return NextResponse.json({ ok: true, message: "Insurance help requested. We will prepare the itemized invoice and claim-ready records." });
  } catch (error) {
    return dbError(error, { route: "client-journey.post" });
  }
}
