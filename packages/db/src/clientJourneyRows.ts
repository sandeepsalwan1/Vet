export type ClientJourneySettings = {
  clinicId: string;
  timeZone: string;
  publicName: string;
  familyStory: string;
  primaryDomain: string | null;
  pimsProvider: string;
  pimsMode: string;
  confirmationEmailEnabled: boolean;
  reminderEmailHours: number;
  reminderSmsHours: number;
  reminderSmsEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
  feedbackDelayMinutes: number;
  petCheckDelayHours: number;
  roomPressureNumerator: number;
  roomPressureDenominator: number;
};

export type ClientContactPreferences = {
  email: string | null;
  phone: string | null;
  emailEnabled: boolean;
  smsConsent: boolean;
  preferredChannel: "email" | "sms" | "both";
};

export type ClientJourneyProfile = {
  clientId: string;
  clientName: string;
  email: string | null;
  phone: string;
  petId: string;
  petName: string;
  species: string;
  breed: string | null;
};

export type ClientJourneyAppointment = {
  id: string;
  appointmentDate: string;
  appointmentTime: string;
  appointmentType: string;
  doctor: string;
  status: string;
  roomStatus: string;
};

export type ClientJourneyInvoice = {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  totalCents: number;
  status: string;
};

export type ClientJourneyEvent = {
  id: string;
  eventType: string;
  audience: "customer" | "employee" | "both";
  source: string;
  summary: string;
  occurredAt: string;
};

export type ClientJourneyMessage = {
  id: string;
  messageType: string;
  audience: "customer" | "employee";
  channel: "email" | "sms" | "portal";
  subject: string | null;
  body: string;
  scheduledFor: string;
  status: "planned" | "sent" | "skipped" | "cancelled" | "failed";
  cancellationReason: string | null;
};

export type DueClientJourneyMessage = {
  id: string;
  clinicId: string;
  clinicName: string;
  messageType: string;
  channel: "email" | "sms";
  subject: string | null;
  body: string;
  idempotencyKey: string;
  email: string | null;
  phone: string | null;
  emailEnabled: boolean;
  smsConsent: boolean;
};

export type ClientJourneySnapshot = {
  settings: ClientJourneySettings;
  profile: ClientJourneyProfile;
  preferences: ClientContactPreferences;
  appointment: ClientJourneyAppointment | null;
  invoice: ClientJourneyInvoice | null;
  events: ClientJourneyEvent[];
  messages: ClientJourneyMessage[];
};

export type StaffJourneyItem = {
  clientId: string | null;
  clientName: string;
  petName: string;
  messageType: string;
  channel: string;
  status: string;
  scheduledFor: string;
  body: string;
};

export type StaffJourneyClient = {
  clientId: string;
  clientName: string;
  phone: string;
  petId: string;
  petName: string;
  appointmentId: string | null;
  appointmentStatus: string | null;
  appointmentTime: string | null;
  invoiceBalanceCents: number | null;
};

export type StaffClientJourneySnapshot = {
  settings: ClientJourneySettings;
  roomPressure: {
    occupied: number;
    total: number;
    pressured: boolean;
    thresholdLabel: string;
  };
  clients: StaffJourneyClient[];
  items: StaffJourneyItem[];
};

export type JourneySettingsRow = {
  clinic_id: string;
  public_name: string;
  family_story: string;
  primary_domain: string | null;
  pims_provider: string;
  pims_mode: string;
  confirmation_email_enabled: boolean;
  reminder_email_hours: number;
  reminder_sms_hours: number;
  reminder_sms_enabled: boolean;
  quiet_hours_start: string;
  quiet_hours_end: string;
  feedback_delay_minutes: number;
  pet_check_delay_hours: number;
  room_pressure_numerator: number;
  room_pressure_denominator: number;
};

export const journeySettingsColumns = `
  clinic_id,
  public_name,
  family_story,
  primary_domain,
  pims_provider,
  pims_mode,
  confirmation_email_enabled,
  reminder_email_hours,
  reminder_sms_hours,
  reminder_sms_enabled,
  quiet_hours_start::text,
  quiet_hours_end::text,
  feedback_delay_minutes,
  pet_check_delay_hours,
  room_pressure_numerator,
  room_pressure_denominator
`;

export function normalizeJourneySettings(row: JourneySettingsRow, timeZone: string): ClientJourneySettings {
  return {
    clinicId: row.clinic_id,
    timeZone,
    publicName: row.public_name,
    familyStory: row.family_story,
    primaryDomain: row.primary_domain,
    pimsProvider: row.pims_provider,
    pimsMode: row.pims_mode,
    confirmationEmailEnabled: row.confirmation_email_enabled,
    reminderEmailHours: row.reminder_email_hours,
    reminderSmsHours: row.reminder_sms_hours,
    reminderSmsEnabled: row.reminder_sms_enabled,
    quietHoursStart: row.quiet_hours_start,
    quietHoursEnd: row.quiet_hours_end,
    feedbackDelayMinutes: row.feedback_delay_minutes,
    petCheckDelayHours: row.pet_check_delay_hours,
    roomPressureNumerator: row.room_pressure_numerator,
    roomPressureDenominator: row.room_pressure_denominator
  };
}

export function dateText(value: string | Date) {
  return value instanceof Date ? value.toISOString().slice(0, 10) : value.split("T")[0] || value;
}
