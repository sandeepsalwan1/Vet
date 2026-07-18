import {
  beginClientAccountClaim,
  completeClientAccountClaim,
  createClientJourneyEvent,
  createTask,
  deferClientAccountClaim,
  failClientAccountClaim,
  getClientAccountClaimForVerification,
  getClientJourneySettings,
  getClientJourneySnapshot
} from "@central-vet/db";
import { guardPublicRequest } from "@central-vet/client-request";
import {
  planAppointmentMessages,
  planWelcomeMessages,
  sendClientVerificationCode
} from "@central-vet/notifications";
import { createHash, randomBytes, randomInt } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { dbError, noStoreHeaders } from "../_apiResponse";
import { resolveClinicFromRequest } from "../_shared";
import { persistClientJourneyPlans } from "../client-journey/_messagePlans";

export const dynamic = "force-dynamic";

const requestBase = {
  action: z.literal("request"),
  petName: z.string().trim().min(2).max(80)
};
export const requestSchema = z.discriminatedUnion("contactKind", [
  z.object({
    ...requestBase,
    contactKind: z.literal("email"),
    contactValue: z.string().trim().email().max(160)
  }),
  z.object({
    ...requestBase,
    contactKind: z.literal("phone"),
    contactValue: z.string().trim().max(40)
      .regex(/^\+?[0-9().\-\s]+$/)
      .refine((value) => {
        const length = value.replace(/\D/g, "").length;
        return length >= 10 && length <= 15;
      })
  })
]);

const verifySchema = z.object({
  action: z.literal("verify"),
  claimId: z.string().uuid(),
  code: z.string().trim().regex(/^\d{6}$/)
});

const claimSchema = z.union([requestSchema, verifySchema]);
const systemActor = { name: "Client journey", role: "admin" as const };

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function claimThrottleIdentity(contactKind: "email" | "phone", contactValue: string, petName: string) {
  const contact = contactKind === "email"
    ? contactValue.trim().toLowerCase()
    : contactValue.replace(/\D/g, "").slice(-10);
  return sha256([contactKind, contact, petName.trim().toLowerCase()].join("|"));
}

function hint(kind: "email" | "phone", value: string) {
  if (kind === "email") {
    const [name, domain] = value.split("@");
    return name && domain ? `${name.slice(0, 2)}***@${domain}` : "your email";
  }
  const digits = value.replace(/\D/g, "");
  return digits.length >= 4 ? `***-***-${digits.slice(-4)}` : "your phone";
}

function demoAccountsEnabled() {
  return process.env.NODE_ENV !== "production" && process.env.DEMO_ACCOUNTS !== "disabled";
}

async function createClaimReviewTask(args: {
  clinicId: string;
  hospitalName: string;
  claimId: string;
  contactKind: "email" | "phone";
  contactValue: string;
  petName: string;
  reason: string;
}) {
  return createTask({
    clinicId: args.clinicId,
    idempotencyKey: `account-claim-review/${args.claimId}`,
    hospitalName: args.hospitalName,
    status: "pending_review",
    source: "client_form",
    clientName: "Portal account claim",
    clientPhone: args.contactKind === "phone" ? args.contactValue : "Not provided",
    petName: args.petName,
    request: "Review a portal account claim and contact the client safely.",
    requestType: "patient_update",
    notes: `${args.reason} Requested contact channel: ${args.contactKind}. ${args.contactKind === "email" ? `Submitted email: ${args.contactValue}. ` : ""}Do not disclose clinic-record matching details until identity is confirmed.`,
    priority: "medium",
    dueDate: new Date().toISOString().slice(0, 10),
    dueTime: "19:00"
  }, systemActor);
}

async function requestClaim(request: Request, input: z.infer<typeof requestSchema>) {
  const clinic = await resolveClinicFromRequest(request);
  const sourceGuard = await guardPublicRequest(request, {
    clinicId: clinic.clinicId,
    content: input,
    rejectDuplicate: false
  });
  if (!sourceGuard.allowed) {
    return NextResponse.json({ error: sourceGuard.error }, { status: 429, headers: noStoreHeaders });
  }
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const salt = randomBytes(16).toString("hex");
  const claim = await beginClientAccountClaim({
    clinicId: clinic.clinicId,
    requesterHash: claimThrottleIdentity(input.contactKind, input.contactValue, input.petName),
    contactKind: input.contactKind,
    contactValue: input.contactValue,
    petName: input.petName,
    codeHash: sha256(`${salt}:${code}`),
    codeSalt: salt,
    destinationHint: hint(input.contactKind, input.contactValue)
  });

  if (!claim.rateLimited && claim.matched) {
    const settings = await getClientJourneySettings({ clinicId: clinic.clinicId });
    const matchedDestination = input.contactKind === "email" ? claim.match?.email : claim.match?.phone;
    if (!matchedDestination) throw new Error("Matched clinic record has no valid verification destination.");
    const delivery = await sendClientVerificationCode({
      clinicId: clinic.clinicId,
      clinicName: settings.publicName,
      contactKind: input.contactKind,
      contactValue: matchedDestination,
      code,
      claimId: claim.claimId
    });
    const delivered = delivery.some((result) => result.status === "sent" || result.status === "duplicate");
    if (!delivered && !demoAccountsEnabled()) {
      await deferClientAccountClaim({ clinicId: clinic.clinicId, claimId: claim.claimId });
      await createClaimReviewTask({
        clinicId: clinic.clinicId,
        hospitalName: clinic.name,
        claimId: claim.claimId,
        contactKind: input.contactKind,
        contactValue: input.contactValue,
        petName: input.petName,
        reason: "Automated verification delivery was unavailable."
      });
    }
  } else if (!claim.rateLimited) {
    await createClaimReviewTask({
      clinicId: clinic.clinicId,
      claimId: claim.claimId,
      hospitalName: clinic.name,
      contactKind: input.contactKind,
      contactValue: input.contactValue,
      petName: input.petName,
      reason: "No unique clinic record matched the submitted details."
    });
  }

  return NextResponse.json({
    claimId: claim.claimId,
    message: "If the details match a clinic record, a 6-digit code is on its way. Otherwise, our team will review the request.",
    destinationHint: hint(input.contactKind, input.contactValue),
    demoCode: claim.matched && demoAccountsEnabled() ? code : undefined
  }, { headers: noStoreHeaders });
}

async function verifyClaim(request: Request, input: z.infer<typeof verifySchema>) {
  const clinic = await resolveClinicFromRequest(request);
  const claim = await getClientAccountClaimForVerification({ clinicId: clinic.clinicId, claimId: input.claimId });
  const expired = !claim?.expires_at || new Date(claim.expires_at).getTime() <= Date.now();
  const valid = claim?.status === "pending" && !expired && claim.attempts < 5 && claim.code_salt &&
    claim.code_hash === sha256(`${claim.code_salt}:${input.code}`);
  if (!valid || !claim?.matched_client_id || !claim.matched_pet_id) {
    if (claim) await failClientAccountClaim({ clinicId: clinic.clinicId, claimId: input.claimId });
    return NextResponse.json({ error: "That code is invalid or expired." }, { status: 400 });
  }

  const accessToken = randomBytes(32).toString("base64url");
  const tokenHash = sha256(accessToken);
  const completed = await completeClientAccountClaim({
    clinicId: clinic.clinicId,
    claimId: input.claimId,
    clientId: claim.matched_client_id,
    petId: claim.matched_pet_id,
    tokenHash
  });
  if (!completed) return NextResponse.json({ error: "That code is invalid or expired." }, { status: 400 });
  const snapshot = await getClientJourneySnapshot({ clinicId: clinic.clinicId, tokenHash });
  if (!snapshot) return NextResponse.json({ error: "Account setup could not be completed." }, { status: 409 });

  const eventId = await createClientJourneyEvent({
    clinicId: clinic.clinicId,
    clientId: snapshot.profile.clientId,
    petId: snapshot.profile.petId,
    appointmentId: snapshot.appointment?.id,
    eventType: "account_claimed",
    audience: "both",
    source: "customer_portal",
    summary: "Portal access verified against the clinic record."
  });
  await persistClientJourneyPlans({
    clinicId: clinic.clinicId,
    clientId: snapshot.profile.clientId,
    petId: snapshot.profile.petId,
    eventId,
    plans: planWelcomeMessages({ settings: snapshot.settings, profile: snapshot.profile })
  });
  if (snapshot.appointment) {
    await persistClientJourneyPlans({
      clinicId: clinic.clinicId,
      clientId: snapshot.profile.clientId,
      petId: snapshot.profile.petId,
      appointmentId: snapshot.appointment.id,
      eventId,
      plans: planAppointmentMessages({
        settings: snapshot.settings,
        profile: snapshot.profile,
        preferences: snapshot.preferences,
        appointment: snapshot.appointment
      })
    });
  }

  return NextResponse.json({
    accessToken,
    profile: snapshot.profile,
    message: "Your clinic record is verified. Finish account setup to continue."
  }, { headers: noStoreHeaders });
}

export async function POST(request: Request) {
  try {
    const parsed = claimSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Check the account setup details." }, { status: 400 });
    return parsed.data.action === "request"
      ? await requestClaim(request, parsed.data)
      : await verifyClaim(request, parsed.data);
  } catch (error) {
    return dbError(error, { route: "client-account-claim" });
  }
}
