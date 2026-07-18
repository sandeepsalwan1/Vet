import type {
  ClientContactPreferences,
  ClientJourneyAppointment,
  ClientJourneyProfile,
  ClientJourneySettings
} from "@central-vet/db";

export type ClientMessagePlan = {
  messageType: string;
  channel: "email" | "sms" | "portal";
  subject: string | null;
  body: string;
  scheduledFor: string;
  status?: "planned" | "skipped";
  idempotencyKey: string;
};

type DateParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

function partsInTimeZone(value: Date, timeZone: string): DateParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(value);
  const number = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  return { year: number("year"), month: number("month"), day: number("day"), hour: number("hour"), minute: number("minute"), second: number("second") };
}

function instantForLocal(parts: DateParts, timeZone: string) {
  const wallTime = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  let instant = new Date(wallTime);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const zoned = partsInTimeZone(instant, timeZone);
    const represented = Date.UTC(zoned.year, zoned.month - 1, zoned.day, zoned.hour, zoned.minute, zoned.second);
    instant = new Date(instant.getTime() + wallTime - represented);
  }
  return instant;
}

function appointmentInstant(appointment: ClientJourneyAppointment, timeZone: string) {
  const [year, month, day] = appointment.appointmentDate.split("-").map(Number);
  const [hour = 9, minute = 0, second = 0] = appointment.appointmentTime.split(":").map(Number);
  return instantForLocal({ year, month, day, hour, minute, second }, timeZone);
}

function hoursBefore(appointment: ClientJourneyAppointment, hours: number, timeZone: string) {
  return new Date(appointmentInstant(appointment, timeZone).getTime() - hours * 60 * 60_000);
}

function outsideQuietHours(value: Date, settings: ClientJourneySettings) {
  const startHour = Number(settings.quietHoursStart.split(":")[0]);
  const endHour = Number(settings.quietHoursEnd.split(":")[0]);
  const local = partsInTimeZone(value, settings.timeZone);
  if (local.hour < endHour || local.hour >= startHour) {
    const safeWallTime = new Date(Date.UTC(local.year, local.month - 1, local.day, startHour, -1, 0));
    if (local.hour < endHour) safeWallTime.setUTCDate(safeWallTime.getUTCDate() - 1);
    return instantForLocal({
      year: safeWallTime.getUTCFullYear(),
      month: safeWallTime.getUTCMonth() + 1,
      day: safeWallTime.getUTCDate(),
      hour: safeWallTime.getUTCHours(),
      minute: safeWallTime.getUTCMinutes(),
      second: 0
    }, settings.timeZone).toISOString();
  }
  return value.toISOString();
}

function minutesAfterNow(minutes: number) {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

function emailPlan(args: Omit<ClientMessagePlan, "channel">): ClientMessagePlan {
  return { ...args, channel: "email" };
}

function conciseSms(value: string) {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length <= 480 ? compact : `${compact.slice(0, 477).trimEnd()}...`;
}

export function planWelcomeMessages(args: {
  settings: ClientJourneySettings;
  profile: ClientJourneyProfile;
}) {
  const clinic = args.settings.publicName;
  const name = args.profile.clientName.split(" ")[0] || "there";
  const body = [
    `Welcome to the ${clinic} family, ${name}.`,
    args.settings.familyStory,
    "Here is what to expect: 1. Check in and share your questions. 2. A veterinary assistant will clarify your concerns and bring your pet to the treatment area. 3. Another assistant supports the doctor during the exam, then we make checkout and follow-up easy.",
    "Before a first visit, upload prior medical and vaccine records through the secure portal."
  ].filter(Boolean).join("\n\n");
  return [emailPlan({
    messageType: "welcome",
    subject: `Welcome to the ${clinic} family`,
    body,
    scheduledFor: new Date().toISOString(),
    idempotencyKey: `welcome/${args.profile.clientId}`
  })];
}

export function planAppointmentMessages(args: {
  settings: ClientJourneySettings;
  profile: ClientJourneyProfile;
  preferences: ClientContactPreferences;
  appointment: ClientJourneyAppointment;
}) {
  if (!["scheduled", "confirmed"].includes(args.appointment.status.toLowerCase())) return [];
  if (appointmentInstant(args.appointment, args.settings.timeZone).getTime() <= Date.now()) return [];
  const clinic = args.settings.publicName;
  const appointmentLabel = `${args.appointment.appointmentDate} at ${args.appointment.appointmentTime.slice(0, 5)}`;
  const prep = `Please arrive on time for ${args.profile.petName}'s visit on ${appointmentLabel}. Complete pre-check-in questions and upload prior medical and vaccine records before the visit. At check-in we answer questions, a veterinary assistant clarifies your concerns, your pet goes to the treatment area, and a second assistant supports the doctor during the exam.`;
  const plans: ClientMessagePlan[] = [];
  if (args.settings.confirmationEmailEnabled && args.preferences.emailEnabled) {
    plans.push(emailPlan({
      messageType: "appointment_confirmation",
      subject: `${args.profile.petName}'s appointment is confirmed`,
      body: `${clinic}: ${args.profile.petName}'s appointment is confirmed for ${appointmentLabel} with ${args.appointment.doctor}.`,
      scheduledFor: new Date().toISOString(),
      idempotencyKey: `appointment/${args.appointment.id}/confirmation/email`
    }));
    plans.push(emailPlan({
      messageType: "appointment_preparation",
      subject: `Help us prepare for ${args.profile.petName}`,
      body: prep,
      scheduledFor: outsideQuietHours(hoursBefore(args.appointment, args.settings.reminderEmailHours, args.settings.timeZone), args.settings),
      idempotencyKey: `appointment/${args.appointment.id}/prep/email/${args.settings.reminderEmailHours}h`
    }));
  }
  if (args.settings.reminderSmsEnabled && args.preferences.smsConsent) {
    plans.push({
      messageType: "appointment_reminder",
      channel: "sms",
      subject: null,
      body: conciseSms(`${clinic}: ${args.profile.petName}'s visit is ${appointmentLabel}. Please arrive on time, complete pre-check-in, and upload transfer records: [secure portal] Reply STOP to opt out.`),
      scheduledFor: outsideQuietHours(hoursBefore(args.appointment, args.settings.reminderSmsHours, args.settings.timeZone), args.settings),
      idempotencyKey: `appointment/${args.appointment.id}/reminder/sms/${args.settings.reminderSmsHours}h`
    });
  }
  return plans;
}

export function planStaffUpdateMessage(args: {
  settings: ClientJourneySettings;
  profile: ClientJourneyProfile;
  preferences: ClientContactPreferences;
  appointmentId: string | null;
  updateType: "hospitalized_update" | "ready_for_pickup" | "discharge" | "checkout";
  detail?: string;
  balanceCents?: number | null;
}) {
  const clinic = args.settings.publicName;
  const base = `update/${args.appointmentId ?? args.profile.petId}/${args.updateType}`;
  const channel = args.preferences.smsConsent && args.updateType !== "discharge" ? "sms" as const : "email" as const;
  if (args.updateType === "hospitalized_update") {
    return [{
      messageType: args.updateType,
      channel,
      subject: channel === "email" ? `${args.profile.petName}'s care update` : null,
      body: conciseSms(`${clinic}: Here is an update about ${args.profile.petName}. ${args.detail || "Your care team will keep you informed."} Call us with questions.`),
      scheduledFor: new Date().toISOString(),
      idempotencyKey: `${base}/${Date.now()}`
    } satisfies ClientMessagePlan];
  }
  if (args.updateType === "ready_for_pickup") {
    const balance = typeof args.balanceCents === "number" ? ` Balance: $${(args.balanceCents / 100).toFixed(2)}.` : "";
    return [{
      messageType: args.updateType,
      channel,
      subject: channel === "email" ? `${args.profile.petName} is ready for pickup` : null,
      body: conciseSms(`${clinic}: Good news, ${args.profile.petName} is ready for pickup.${balance} Pay securely before arrival or at the front desk. Discharge instructions will be available after checkout: [secure portal]`),
      scheduledFor: new Date().toISOString(),
      idempotencyKey: base
    } satisfies ClientMessagePlan];
  }
  if (args.updateType === "discharge") {
    return [emailPlan({
      messageType: args.updateType,
      subject: `${args.profile.petName}'s discharge instructions`,
      body: `${clinic}: ${args.profile.petName}'s doctor-approved, visit-specific discharge instructions and invoice are ready in the secure portal. ${args.detail || "Call us if you have questions or your pet's condition changes."}`,
      scheduledFor: new Date().toISOString(),
      idempotencyKey: base
    })];
  }
  const feedbackAt = minutesAfterNow(args.settings.feedbackDelayMinutes);
  return [{
    messageType: "visit_experience",
    channel: args.preferences.smsConsent ? "sms" : "email",
    subject: args.preferences.smsConsent ? null : `How was ${args.profile.petName}'s visit?`,
    body: conciseSms(`${clinic}: How was your visit today? Choose thumbs up or thumbs down in your secure portal. If something was not right, our team will follow up.`),
    scheduledFor: feedbackAt,
    idempotencyKey: `feedback/${args.appointmentId ?? args.profile.petId}/visit`
  } satisfies ClientMessagePlan];
}

export function planPetCheckMessage(args: {
  settings: ClientJourneySettings;
  profile: ClientJourneyProfile;
  preferences: ClientContactPreferences;
  appointmentId: string | null;
}) {
  return [{
    messageType: "pet_health_check",
    channel: args.preferences.smsConsent ? "sms" : "email",
    subject: args.preferences.smsConsent ? null : `How is ${args.profile.petName} doing?`,
    body: conciseSms(`${args.settings.publicName}: How is ${args.profile.petName} doing after the visit? Choose thumbs up or thumbs down in the secure portal. If symptoms are severe, worsening, or urgent, call the clinic or seek emergency veterinary care now.`),
    scheduledFor: minutesAfterNow(args.settings.petCheckDelayHours * 60),
    idempotencyKey: `feedback/${args.appointmentId ?? args.profile.petId}/pet-health`
  } satisfies ClientMessagePlan];
}
