import { smokeTestHtml } from "./notificationContent";
import {
  localNotificationParts,
  type NotificationChannel,
  type NotificationMode
} from "./notificationDelivery";
import { clinicNameFor } from "./notificationClinic";
import { sendNotification } from "./notificationSend";

export async function sendSmokeEmail(options?: {
  clinicId?: string | null;
  timeZone?: string;
  modeOverride?: NotificationMode;
  channelOverride?: NotificationChannel;
}) {
  const clinicName = await clinicNameFor(options?.clinicId);
  const { date } = localNotificationParts(options?.timeZone);
  const stamp = new Date().toISOString().slice(0, 16);
  const results = await sendNotification({
    clinicId: options?.clinicId,
    clinicName,
    notificationType: "smoke_test",
    subject: `${clinicName} notification smoke test`,
    html: smokeTestHtml(date, clinicName),
    text: `${clinicName} notification smoke test for ${date}.`,
    idempotencyKeyBase: `smoke-test/${stamp}`,
    modeOverride: options?.modeOverride,
    channelOverride: options?.channelOverride
  });
  return { localDate: date, results };
}
