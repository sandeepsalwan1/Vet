import { randomUUID } from "node:crypto";
import {
  agentExampleHtml,
  agentExampleText
} from "./notificationContent";
import {
  localNotificationParts,
  notificationEmailFrom,
  type NotificationMode
} from "./notificationDelivery";
import { clinicNameFor } from "./notificationClinic";
import { sendNotification } from "./notificationSend";

type AgentEmailCadence = "once" | "monthly" | "post_appointment";

export async function sendAgentExampleEmail(options?: {
  clinicId?: string | null;
  timeZone?: string;
  modeOverride?: NotificationMode;
  recipients?: string[];
  subject?: string;
  message?: string;
  actorName?: string;
  cadence?: AgentEmailCadence;
  period?: string;
  postAppointmentDelayDays?: number;
  idempotencyKeyBase?: string;
}) {
  const clinicName = await clinicNameFor(options?.clinicId);
  const { date, month } = localNotificationParts(options?.timeZone);
  const requestedRecipients = Array.from(
    new Set(
      (options?.recipients ?? [])
        .map((recipient) => recipient.trim())
        .filter(Boolean)
    )
  );
  const message = options?.message?.trim() ||
    `This is an example email from the ${clinicName} agent.`;
  const subject = options?.subject?.trim() || `${clinicName} agent email`;
  const currentMode = options?.modeOverride ?? "test";
  const deliveryRecipients = currentMode === "test"
    ? []
    : requestedRecipients;
  const cadence = options?.cadence ?? "once";
  const period = cadence === "monthly"
    ? options?.period ?? month
    : undefined;
  const postAppointmentDelayDays =
    options?.postAppointmentDelayDays ?? 7;
  const idempotencyKeyBase = options?.idempotencyKeyBase ??
    (cadence === "monthly"
      ? `agent-example-email/monthly/${period}`
      : cadence === "post_appointment"
        ? `agent-example-email/post-appointment/${date}/delay-${postAppointmentDelayDays}`
        : `agent-example-email/${randomUUID()}`);
  const results = await sendNotification({
    clinicId: options?.clinicId,
    clinicName,
    notificationType: "agent_example_email",
    subject,
    html: agentExampleHtml(message, options?.actorName, date, clinicName),
    text: agentExampleText(message, options?.actorName, date, clinicName),
    idempotencyKeyBase,
    modeOverride: currentMode,
    channelOverride: "email",
    deliveriesOverride: deliveryRecipients.length > 0
      ? [{ channel: "email", recipients: deliveryRecipients }]
      : undefined
  });
  return {
    localDate: date,
    mode: currentMode,
    from: notificationEmailFrom(),
    recipients: deliveryRecipients,
    requestedRecipients,
    subject,
    cadence,
    postAppointmentDelayDays: cadence === "post_appointment"
      ? postAppointmentDelayDays
      : null,
    period: period ?? null,
    results
  };
}
