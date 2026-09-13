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
  priorStatus?: "pending" | "sent" | "skipped" | "failed";
};

type NotificationAttemptInput = {
  clinicId?: string | null;
  taskId?: string | null;
  notificationType: string;
  recipient: string;
  idempotencyKey: string;
};

type NotificationAttemptOutcome = {
  id: string;
  status: "sent" | "skipped" | "failed";
  providerId?: string | null;
  error?: string | null;
};

export type NotificationAttemptAdapter = {
  create: (input: NotificationAttemptInput) => Promise<
    | { id: string }
    | {
        duplicate: true;
        priorStatus?: "pending" | "sent" | "skipped" | "failed";
      }
  >;
  mark: (outcome: NotificationAttemptOutcome) => Promise<void>;
};

export type NotificationTransportAdapter = {
  sendEmail: (input: {
    recipient: string;
    subject: string;
    html: string;
    idempotencyKey: string;
  }) => Promise<string | null>;
  sendSms: (input: {
    recipient: string;
    text: string;
  }) => Promise<string | null>;
};

type NotificationSendInput = {
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

const tenantNotificationAttempts: NotificationAttemptAdapter = {
  async create(input) {
    const id = await createNotificationAttempt(input);
    return id ? { id } : { duplicate: true };
  },
  async mark(outcome) {
    if (outcome.status === "sent") {
      await markNotificationSent(outcome.id, outcome.providerId);
      return;
    }
    if (outcome.status === "skipped") {
      await markNotificationSkipped(outcome.id, outcome.error ?? "Notification skipped.");
      return;
    }
    await markNotificationFailed(outcome.id, outcome.error ?? "Notification failed.");
  }
};

const notificationTransports: NotificationTransportAdapter = {
  async sendEmail(input) {
    const resendApiKey = process.env.RESEND_API_KEY;
    if (!resendApiKey) throw new Error("RESEND_API_KEY is required.");
    const resend = new Resend(resendApiKey);
    const { data, error } = await resend.emails.send({
      from: notificationEmailFrom(),
      to: [input.recipient],
      subject: input.subject,
      html: input.html
    }, { idempotencyKey: input.idempotencyKey });
    if (error) throw new Error(error.message || "Resend send failed.");
    return data?.id ?? null;
  },
  async sendSms(input) {
    return sendTwilioSms(input.recipient, input.text);
  }
};

export function createNotificationSender(
  attempts: NotificationAttemptAdapter,
  transports: NotificationTransportAdapter = notificationTransports
) {
  return async function send(args: NotificationSendInput) {
    const currentMode = args.modeOverride ?? notificationMode();
    const currentChannel = args.channelOverride ?? notificationChannel();
    const deliveries = args.deliveriesOverride ??
      deliveriesFor(currentMode, currentChannel);
    const recipientCount = deliveries.reduce(
      (count, delivery) => count + delivery.recipients.length,
      0
    );

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

    const results: SendResult[] = [];
    for (const delivery of deliveries) {
      for (const recipient of delivery.recipients) {
        const idempotencyKey =
          `${args.idempotencyKeyBase}/${currentMode}/${delivery.channel}/${recipient}`;
        const attempt = await attempts.create({
          clinicId: args.clinicId,
          taskId: args.taskId,
          notificationType: `${args.notificationType}_${delivery.channel}`,
          recipient,
          idempotencyKey
        });

        if ("duplicate" in attempt) {
          results.push({
            recipient,
            status: "duplicate",
            channel: delivery.channel,
            priorStatus: attempt.priorStatus
          });
          continue;
        }
        const notificationId = attempt.id;

        if (currentMode === "disabled") {
          const error = "NOTIFICATION_MODE=disabled";
          await attempts.mark({
            id: notificationId,
            status: "skipped",
            error
          });
          results.push({ recipient, status: "skipped", channel: delivery.channel });
          continue;
        }

        try {
          const providerId = delivery.channel === "sms"
            ? await transports.sendSms({ recipient, text: args.text })
            : await transports.sendEmail({
                recipient,
                subject: args.subject,
                html: args.html,
                idempotencyKey
              });
          await attempts.mark({
            id: notificationId,
            status: "sent",
            providerId
          });
          results.push({
            recipient,
            status: "sent",
            channel: delivery.channel,
            resendId: providerId
          });
        } catch (error) {
          const message = error instanceof Error
            ? error.message
            : "Unknown send error.";
          await attempts.mark({
            id: notificationId,
            status: "failed",
            error: message
          });
          results.push({
            recipient,
            status: "failed",
            channel: delivery.channel,
            error: message
          });
        }
      }
    }

    return results;
  };
}

export const sendNotification = createNotificationSender(
  tenantNotificationAttempts
);
