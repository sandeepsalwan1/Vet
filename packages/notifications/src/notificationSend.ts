import {
  createNotificationAttempt,
  markNotificationFailed,
  markNotificationSent,
  markNotificationSkipped
} from "@central-vet/db";
import { Resend } from "resend";
import {
  deliveriesFor,
  notificationChannel,
  notificationEmailFrom,
  notificationMode,
  type Delivery,
  type NotificationChannel,
  type NotificationMode
} from "./notificationDelivery";

export type SendResult = {
  recipient: string;
  status: "sent" | "skipped" | "duplicate" | "failed";
  channel: "email" | "sms";
  resendId?: string | null;
  error?: string;
};

export async function sendNotification(args: {
  clinicId?: string | null;
  clinicName?: string;
  notificationType: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKeyBase: string;
  taskId?: string | null;
  modeOverride?: NotificationMode;
  channelOverride?: NotificationChannel;
  deliveriesOverride?: Delivery[];
}) {
  const currentMode = args.modeOverride ?? notificationMode();
  const currentChannel = args.channelOverride ?? notificationChannel();
  const deliveries = args.deliveriesOverride ?? deliveriesFor(currentMode, currentChannel);
  const from = notificationEmailFrom();
  const recipientCount = deliveries.reduce((count, delivery) => count + delivery.recipients.length, 0);

  if (recipientCount === 0) {
    return [
      {
        recipient: "",
        status: "failed" as const,
        channel: currentChannel === "both" ? "sms" as const : currentChannel,
        error: "No notification recipients configured."
      }
    ];
  }

  const resendApiKey = process.env.RESEND_API_KEY;
  const resend = currentMode === "disabled" || !resendApiKey ? null : new Resend(resendApiKey);
  const results: SendResult[] = [];

  for (const delivery of deliveries) {
    for (const recipient of delivery.recipients) {
      const idempotencyKey = `${args.idempotencyKeyBase}/${currentMode}/${delivery.channel}/${recipient}`;
      const notificationId = await createNotificationAttempt({
        clinicId: args.clinicId,
        taskId: args.taskId,
        notificationType: `${args.notificationType}_${delivery.channel}`,
        recipient,
        idempotencyKey
      });

      if (!notificationId) {
        results.push({ recipient, status: "duplicate", channel: delivery.channel });
        continue;
      }

      if (currentMode === "disabled") {
        await markNotificationSkipped(notificationId, "NOTIFICATION_MODE=disabled");
        results.push({ recipient, status: "skipped", channel: delivery.channel });
        continue;
      }

      if (!resend) {
        await markNotificationFailed(notificationId, "RESEND_API_KEY is required.");
        results.push({
          recipient,
          status: "failed",
          channel: delivery.channel,
          error: "RESEND_API_KEY is required."
        });
        continue;
      }

      try {
        const emailPayload =
          delivery.channel === "sms"
            ? {
                from,
                to: [recipient],
                subject: args.clinicName || "Clinic Notification",
                text: args.text
              }
            : {
                from,
                to: [recipient],
                subject: args.subject,
                html: args.html
              };
        const { data, error } = await resend.emails.send(
          emailPayload,
          { idempotencyKey }
        );

        if (error) {
          const message = error.message || "Resend send failed.";
          await markNotificationFailed(notificationId, message);
          results.push({ recipient, status: "failed", channel: delivery.channel, error: message });
        } else {
          await markNotificationSent(notificationId, data?.id ?? null);
          results.push({
            recipient,
            status: "sent",
            channel: delivery.channel,
            resendId: data?.id ?? null
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown send error.";
        await markNotificationFailed(notificationId, message);
        results.push({ recipient, status: "failed", channel: delivery.channel, error: message });
      }
    }
  }

  return results;
}
