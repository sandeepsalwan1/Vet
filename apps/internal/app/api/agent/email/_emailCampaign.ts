import { z } from "zod";

const modeSchema = z.enum(["disabled", "test", "production"]);
const cadenceSchema = z.enum(["once", "monthly", "post_appointment"]);
const audienceSchema = z.enum(["explicit_recipients", "all_active_clients", "recent_clients", "recent_appointments"]);

export const emailBodySchema = z.object({
  message: z.string().trim().max(4000).optional(),
  subject: z.string().trim().max(160).optional(),
  mode: modeSchema.optional(),
  cadence: cadenceSchema.optional(),
  audience: audienceSchema.optional(),
  period: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  recipient: z.string().trim().max(320).optional(),
  to: z.union([z.string().trim().max(2000), z.array(z.string().trim().max(320)).max(20)]).optional(),
  recipients: z.array(z.string().trim().max(320)).max(20).optional(),
  recipientCount: z.number().int().min(0).optional(),
  templateId: z.string().trim().max(80).optional(),
  templateVersion: z.string().trim().max(80).optional(),
  templateReviewed: z.boolean().optional(),
  confirmed: z.boolean().optional(),
  sendNow: z.boolean().optional(),
  scheduledFor: z.string().trim().max(80).optional(),
  postAppointmentDelayDays: z.number().int().min(1).max(90).optional()
}).passthrough();

type EmailBody = z.infer<typeof emailBodySchema>;
type EmailMode = z.infer<typeof modeSchema>;
type EmailCadence = z.infer<typeof cadenceSchema>;
type EmailAudience = z.infer<typeof audienceSchema>;

const emailPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const emailAddressSchema = z.string().email();

function emailsFrom(value: unknown) {
  const values = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[,\s;]+/) : [];
  return values.filter((item): item is string => typeof item === "string");
}

export function recipientsFromBody(body: EmailBody) {
  const candidates = [
    ...emailsFrom(body.recipient),
    ...emailsFrom(body.to),
    ...emailsFrom(body.recipients),
    ...(body.message?.match(emailPattern) ?? [])
  ];
  const unique = Array.from(new Set(candidates.map((item) => item.trim()).filter(Boolean)));
  return unique.filter((item) => emailAddressSchema.safeParse(item).success).slice(0, 20);
}

export function cadenceFromBody(body: EmailBody): EmailCadence {
  if (body.cadence) return body.cadence;
  if (/\b(post[- ]?appointment|after appointment|after visit|follow[- ]?up)\b/i.test(body.message ?? "")) {
    return "post_appointment";
  }
  return /\b(monthly|every month|per month|month-end|month end)\b/i.test(body.message ?? "") ? "monthly" : "once";
}

export function audienceFromBody(body: EmailBody, cadence: EmailCadence, recipients: string[]): EmailAudience {
  if (body.audience) return body.audience;
  if (recipients.length > 0) return "explicit_recipients";
  if (cadence === "post_appointment") return "recent_appointments";
  if (cadence === "monthly") return "all_active_clients";
  return "explicit_recipients";
}

export function emailConfirmation(input: {
  body: EmailBody;
  mode: EmailMode;
  cadence: EmailCadence;
  audience: EmailAudience;
  recipients: string[];
  actorProfileId?: string | null;
}) {
  const recipientCount = input.body.recipientCount ?? input.recipients.length;
  return {
    mode: input.mode,
    cadence: input.cadence,
    audience: input.audience,
    recipientCount,
    subject: input.body.subject?.trim() || "Clinic agent email",
    templateId: input.body.templateId?.trim() || `${input.cadence}-default`,
    templateVersion: input.body.templateVersion?.trim() || "draft",
    templateReviewed: input.body.templateReviewed ?? input.mode === "disabled",
    reviewedByActorId: input.actorProfileId ?? "unknown",
    sendNow: input.body.sendNow ?? input.cadence === "once",
    scheduledFor: input.body.scheduledFor,
    postAppointmentDelayDays: input.cadence === "post_appointment"
      ? input.body.postAppointmentDelayDays ?? 7
      : undefined
  };
}

export function emailBlockers(confirmation: ReturnType<typeof emailConfirmation>, confirmed: boolean | undefined) {
  const blockers: string[] = [];
  const riskySend = confirmation.mode !== "disabled" &&
    (confirmation.mode === "production" || confirmation.cadence !== "once" || confirmation.recipientCount > 1);
  if (riskySend && !confirmation.templateReviewed) blockers.push("template_review_required");
  if (confirmation.mode === "production" && !confirmed) blockers.push("production_confirmation_required");
  if (confirmation.mode === "production" && confirmation.recipientCount > 500) blockers.push("recipient_count_too_high");
  if (confirmation.cadence === "post_appointment" && confirmation.audience !== "recent_appointments") {
    blockers.push("post_appointment_requires_recent_appointments_audience");
  }
  if (confirmation.cadence === "monthly" && confirmation.audience === "recent_appointments") {
    blockers.push("monthly_audience_mismatch");
  }
  return blockers;
}

export function resultStats(results: Array<{ status: string }>) {
  return results.reduce(
    (stats, result) => {
      stats[result.status as keyof typeof stats] = (stats[result.status as keyof typeof stats] ?? 0) + 1;
      return stats;
    },
    { sent: 0, skipped: 0, duplicate: 0, failed: 0 }
  );
}

export function statusMessage(stats: ReturnType<typeof resultStats>, mode: string) {
  if (stats.sent > 0) return `Agent email sent to ${stats.sent} recipient${stats.sent === 1 ? "" : "s"}.`;
  if (stats.skipped > 0) return `Agent email prepared but not sent because notification mode is ${mode}.`;
  if (stats.duplicate > 0) return "Agent email was already processed for this idempotency key.";
  return "Agent email could not be sent; check notification recipients and Resend configuration.";
}

export function blockedMessage(blockers: string[]) {
  if (blockers.includes("template_review_required")) return "Agent email needs template review before sending.";
  if (blockers.includes("production_confirmation_required")) return "Agent email needs explicit production confirmation before sending.";
  return "Agent email needs confirmation before sending.";
}
