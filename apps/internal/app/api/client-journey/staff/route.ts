import {
  cancelClientJourneyMessages,
  createClientJourneyEvent,
  getClientClaimProfile,
  getClientContactPreferences,
  getClientJourneySettings,
  listStaffClientJourneys
} from "@central-vet/db";
import { planStaffUpdateMessage } from "@central-vet/notifications";
import { NextResponse } from "next/server";
import { z } from "zod";
import { actorSchema, authenticateActor, authenticateActorFromQuery, resolveClinicFromRequest } from "../../_shared";
import { dbError, noStoreHeaders } from "../../_apiResponse";
import { persistClientJourneyPlans } from "../_messagePlans";

export const dynamic = "force-dynamic";

const updateSchema = z.object({
  actor: actorSchema,
  clientId: z.string().trim().min(1).max(160),
  petId: z.string().trim().min(1).max(160),
  appointmentId: z.string().trim().min(1).max(160).optional().nullable(),
  updateType: z.enum(["hospitalized_update", "ready_for_pickup", "discharge", "checkout", "appointment_changed"]),
  detail: z.string().trim().max(1000).optional().nullable(),
  balanceCents: z.number().int().min(0).max(10_000_000).optional().nullable()
});

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const clinic = await resolveClinicFromRequest(request);
    const auth = await authenticateActorFromQuery(url, request, clinic);
    if ("response" in auth) return auth.response;
    if (auth.actor.role !== "admin") {
      return NextResponse.json({ error: "Admin access required." }, { status: 403 });
    }
    return NextResponse.json(await listStaffClientJourneys({ clinicId: clinic.clinicId }), { headers: noStoreHeaders });
  } catch (error) {
    return dbError(error, { route: "client-journey.staff.get" });
  }
}

export async function POST(request: Request) {
  try {
    const clinic = await resolveClinicFromRequest(request);
    const parsed = updateSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Check the client update details." }, { status: 400 });
    const auth = await authenticateActor(parsed.data.actor, request, clinic);
    if ("response" in auth) return auth.response;
    if (auth.actor.role !== "admin") {
      return NextResponse.json({ error: "Admin access required." }, { status: 403 });
    }
    const profile = await getClientClaimProfile({
      clinicId: clinic.clinicId,
      clientId: parsed.data.clientId,
      petId: parsed.data.petId
    });
    if (!profile) return NextResponse.json({ error: "Client record not found." }, { status: 404 });
    const [settings, preferences] = await Promise.all([
      getClientJourneySettings({ clinicId: clinic.clinicId }),
      getClientContactPreferences({ clinicId: clinic.clinicId, clientId: profile.clientId, profile })
    ]);
    const eventId = await createClientJourneyEvent({
      clinicId: clinic.clinicId,
      clientId: profile.clientId,
      petId: profile.petId,
      appointmentId: parsed.data.appointmentId,
      eventType: parsed.data.updateType,
      audience: "both",
      source: `staff:${auth.actor.role}`,
      summary: parsed.data.updateType === "checkout"
        ? `${profile.petName} checked out; discharge and follow-up queued.`
        : `${profile.petName}: ${parsed.data.updateType.replaceAll("_", " ")} queued.`
    });
    if (parsed.data.updateType === "appointment_changed") {
      await cancelClientJourneyMessages({
        clinicId: clinic.clinicId,
        clientId: profile.clientId,
        appointmentId: parsed.data.appointmentId,
        messageTypes: ["appointment_confirmation", "appointment_preparation", "appointment_reminder"],
        reason: "Appointment cancelled or rescheduled; stale reminders suppressed."
      });
      return NextResponse.json({ ok: true, planned: 0 });
    }
    const common = {
      settings,
      profile,
      preferences,
      appointmentId: parsed.data.appointmentId ?? null,
      detail: parsed.data.detail ?? undefined,
      balanceCents: parsed.data.balanceCents
    };
    const plans = parsed.data.updateType === "checkout"
      ? [
          ...planStaffUpdateMessage({ ...common, updateType: "discharge" }),
          ...planStaffUpdateMessage({ ...common, updateType: "checkout" })
        ]
      : planStaffUpdateMessage({ ...common, updateType: parsed.data.updateType });
    await persistClientJourneyPlans({
      clinicId: clinic.clinicId,
      clientId: profile.clientId,
      petId: profile.petId,
      appointmentId: parsed.data.appointmentId,
      eventId,
      plans
    });
    return NextResponse.json({ ok: true, planned: plans.length });
  } catch (error) {
    return dbError(error, { route: "client-journey.staff.post" });
  }
}
