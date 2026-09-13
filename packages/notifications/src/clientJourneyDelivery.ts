import {
  listDueClientJourneyMessages,
  markClientJourneyMessageStatus
} from "@central-vet/db";
import {
  notificationMode,
  smsDestinationFor,
  type NotificationMode
} from "./notificationDelivery";
import { sendNotification } from "./notificationSend";

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export async function sendClientVerificationCode(options: {
  clinicId: string;
  clinicName: string;
  contactKind: "email" | "phone";
  contactValue: string;
  code: string;
  claimId: string;
}) {
  const mode = notificationMode();
  const channel = options.contactKind === "email"
    ? "email" as const
    : "sms" as const;
  const productionRecipient = channel === "email"
    ? options.contactValue.trim()
    : smsDestinationFor(options.contactValue);
  return sendNotification({
    clinicId: options.clinicId,
    clinicName: options.clinicName,
    notificationType: "client_account_verification",
    subject: `${options.clinicName} verification code`,
    html:
      `<p>Your ${escapeHtml(options.clinicName)} verification code is ` +
      `<strong>${options.code}</strong>. It expires in 10 minutes.</p>`,
    text:
      `${options.clinicName} verification code: ${options.code}. ` +
      "It expires in 10 minutes.",
    idempotencyKeyBase: `client-account-claim/${options.claimId}`,
    modeOverride: mode,
    channelOverride: channel,
    deliveriesOverride: mode === "production"
      ? productionRecipient
        ? [{ channel, recipients: [productionRecipient] }]
        : []
      : undefined
  });
}

export async function sendDueClientJourneyMessages(options?: {
  clinicId?: string | null;
  limit?: number;
  modeOverride?: NotificationMode;
}) {
  const mode = options?.modeOverride ?? notificationMode();
  const messages = await listDueClientJourneyMessages({
    clinicId: options?.clinicId,
    limit: options?.limit
  });
  const outcomes: Array<{
    id: string;
    status: "held" | "sent" | "skipped" | "failed";
  }> = [];

  for (const message of messages) {
    const recipient = message.channel === "email"
      ? message.emailEnabled
        ? message.email?.trim() ?? ""
        : ""
      : message.smsConsent
        ? smsDestinationFor(message.phone ?? "")
        : "";
    if (!recipient) {
      await markClientJourneyMessageStatus({
        clinicId: message.clinicId,
        messageId: message.id,
        status: "skipped",
        reason:
          `Current ${message.channel} preference or address ` +
          "does not allow delivery."
      });
      outcomes.push({ id: message.id, status: "skipped" });
      continue;
    }
    if (mode === "disabled") {
      outcomes.push({ id: message.id, status: "held" });
      continue;
    }

    const results = await sendNotification({
      clinicId: message.clinicId,
      clinicName: message.clinicName,
      notificationType: `client_journey_${message.messageType}`,
      subject: message.subject || message.clinicName,
      html: `<p>${escapeHtml(message.body).replaceAll("\n", "<br>")}</p>`,
      text: message.body,
      idempotencyKeyBase:
        `client-journey/${message.id}/${message.idempotencyKey}`,
      modeOverride: mode,
      channelOverride: message.channel,
      deliveriesOverride: mode === "production"
        ? [{ channel: message.channel, recipients: [recipient] }]
        : undefined
    });
    if (mode !== "production") {
      outcomes.push({
        id: message.id,
        status: results.some((result) => result.status === "failed")
          ? "failed"
          : "held"
      });
      continue;
    }

    const status = results.every(
      (result) => result.status === "sent" || result.status === "duplicate"
    )
      ? "sent" as const
      : "failed" as const;
    await markClientJourneyMessageStatus({
      clinicId: message.clinicId,
      messageId: message.id,
      status,
      reason: status === "failed"
        ? "Notification transport did not confirm delivery."
        : null
    });
    outcomes.push({ id: message.id, status });
  }

  return {
    mode,
    due: messages.length,
    sent: outcomes.filter((outcome) => outcome.status === "sent").length,
    skipped: outcomes.filter((outcome) => outcome.status === "skipped").length,
    failed: outcomes.filter((outcome) => outcome.status === "failed").length,
    held: outcomes.filter((outcome) => outcome.status === "held").length
  };
}
