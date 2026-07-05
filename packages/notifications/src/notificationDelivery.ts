import { listRecipientProfiles } from "@central-vet/db";

export type NotificationMode = "disabled" | "test" | "production";
export type NotificationChannel = "email" | "sms" | "both";
export type Delivery = { channel: "email" | "sms"; recipients: string[] };

type ProfileAlertKind = "escalation" | "dailyPriority";

const defaultEmailFrom = "Clinic Notifications <notifications@eepish.com>";

export function notificationEmailFrom() {
  return process.env.EMAIL_FROM || defaultEmailFrom;
}

export function notificationMode(): NotificationMode {
  const value = process.env.NOTIFICATION_MODE;
  if (value === "test" || value === "production") return value;
  return "disabled";
}

export function notificationChannel(): NotificationChannel {
  const value = process.env.NOTIFICATION_CHANNEL;
  if (value === "sms" || value === "both") return value;
  return "email";
}

function envList(value: string | undefined) {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function emailRecipientsFor(currentMode: NotificationMode) {
  if (currentMode === "test") return envList(process.env.TEST_NOTIFICATION_EMAIL);
  if (currentMode === "production") {
    return envList(process.env.DOCTOR_NOTIFICATION_EMAILS);
  }
  return envList(process.env.TEST_NOTIFICATION_EMAIL || process.env.DOCTOR_NOTIFICATION_EMAILS);
}

function smsRecipientsFor(currentMode: NotificationMode) {
  if (currentMode === "test") {
    return envList(process.env.TEST_SMS_NOTIFICATION_RECIPIENTS || process.env.SMS_NOTIFICATION_RECIPIENTS);
  }
  if (currentMode === "production") {
    return envList(process.env.SMS_NOTIFICATION_RECIPIENTS);
  }
  return envList(process.env.TEST_SMS_NOTIFICATION_RECIPIENTS || process.env.SMS_NOTIFICATION_RECIPIENTS);
}

export function deliveriesFor(currentMode: NotificationMode, currentChannel: NotificationChannel) {
  const deliveries: Delivery[] = [];
  if (currentChannel === "email" || currentChannel === "both") {
    deliveries.push({ channel: "email", recipients: emailRecipientsFor(currentMode) });
  }
  if (currentChannel === "sms" || currentChannel === "both") {
    deliveries.push({ channel: "sms", recipients: smsRecipientsFor(currentMode) });
  }
  return deliveries;
}

export function localNotificationParts(
  timeZone = process.env.APP_TIME_ZONE || process.env.TZ || "America/Los_Angeles"
) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    month: `${get("year")}-${get("month")}`,
    hour: Number(get("hour"))
  };
}

function smsAddressFor(phone: string) {
  const clean = phone.trim();
  if (clean.includes("@")) return clean;
  const digits = clean.replace(/\D/g, "");
  if (digits.length === 10) return `${digits}@vtext.com`;
  if (digits.length === 11 && digits.startsWith("1")) return `${digits.slice(1)}@vtext.com`;
  return "";
}

export async function veterinarianDeliveries(
  kind: ProfileAlertKind,
  options?: { clinicId?: string | null }
) {
  const profiles = await listRecipientProfiles({
    clinicId: options?.clinicId,
    includeInactive: false
  });
  const enabledForKind = (profile: Awaited<ReturnType<typeof listRecipientProfiles>>[number]) =>
    kind === "escalation" ? profile.escalationOptIn : profile.dailyPriorityOptIn;
  const emailRecipients = profiles
    .filter((profile) => enabledForKind(profile) && profile.emailOptIn && profile.email)
    .map((profile) => profile.email);
  const smsRecipients = profiles
    .filter((profile) => enabledForKind(profile) && profile.smsOptIn && profile.phone)
    .map((profile) => smsAddressFor(profile.phone))
    .filter(Boolean);
  const deliveries: Delivery[] = [
    { channel: "email", recipients: emailRecipients },
    { channel: "sms", recipients: smsRecipients }
  ];
  return deliveries.filter((delivery) => delivery.recipients.length > 0);
}
