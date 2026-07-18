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

async function sendTwilioSms(recipient: string, text: string) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_PHONE_NUMBER;
  if (!accountSid || !authToken || !from) {
    throw new Error("Twilio SMS credentials are required.");
  }
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`, {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
      "content-type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({ To: recipient, From: from, Body: text })
  });
  const body = await response.json().catch(() => ({})) as { sid?: string; message?: string };
  if (!response.ok || !body.sid) throw new Error(body.message || `Twilio SMS failed with ${response.status}.`);
  return body.sid;
}

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

      if (delivery.channel === "email" && !resend) {
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
        if (delivery.channel === "sms") {
          const providerId = await sendTwilioSms(recipient, args.text);
          await markNotificationSent(notificationId, providerId);
          results.push({ recipient, status: "sent", channel: delivery.channel, resendId: providerId });
          continue;
        }
        const { data, error } = await resend!.emails.send({
          from,
          to: [recipient],
          subject: args.subject,
          html: args.html
        }, { idempotencyKey });

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
