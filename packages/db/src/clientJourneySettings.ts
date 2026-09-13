import { getClinicById, resolveClinicId } from "./clinics";
import { getSql } from "./connection";
import {
  journeySettingsColumns,
  normalizeJourneySettings,
  type ClientJourneySettings,
  type JourneySettingsRow
} from "./clientJourneyRows";

function defaultSettings(
  clinicId: string,
  publicName: string,
  timeZone: string
): ClientJourneySettings {
  return {
    clinicId,
    timeZone,
    publicName,
    familyStory: "",
    primaryDomain: null,
    pimsProvider: "unconfigured",
    pimsMode: "adapter",
    confirmationEmailEnabled: true,
    reminderEmailHours: 48,
    reminderSmsHours: 24,
    reminderSmsEnabled: true,
    quietHoursStart: "20:00:00",
    quietHoursEnd: "08:00:00",
    feedbackDelayMinutes: 75,
    petCheckDelayHours: 24,
    followupCallDelayHours: 48,
    roomPressureNumerator: 2,
    roomPressureDenominator: 3
  };
}

export async function getClientJourneySettings(options?: {
  clinicId?: string | null;
}) {
  const sql = getSql();
  const clinicId = await resolveClinicId(options?.clinicId);
  const clinic = await getClinicById(clinicId);
  const timeZone = clinic?.timeZone ??
    process.env.APP_TIME_ZONE ??
    process.env.TZ ??
    "America/Los_Angeles";
  const rows = await sql<JourneySettingsRow[]>`
    select ${sql.unsafe(journeySettingsColumns)}
    from client_journey_settings
    where clinic_id = ${clinicId}
    limit 1
  `;
  if (rows[0]) return normalizeJourneySettings(rows[0], timeZone);

  const clinics = await sql<{ name: string }[]>`
    select name
    from clinics
    where id = ${clinicId}
    limit 1
  `;
  const defaults = defaultSettings(
    clinicId,
    clinics[0]?.name ?? "Veterinary Hospital",
    timeZone
  );
  const inserted = await sql<JourneySettingsRow[]>`
    insert into client_journey_settings (clinic_id, public_name)
    values (${clinicId}, ${defaults.publicName})
    returning ${sql.unsafe(journeySettingsColumns)}
  `;
  return normalizeJourneySettings(inserted[0], defaults.timeZone);
}

export async function updateClientJourneySettings(input: {
  clinicId?: string | null;
  confirmationEmailEnabled: boolean;
  reminderEmailHours: number;
  reminderSmsHours: number;
  reminderSmsEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
  feedbackDelayMinutes: number;
  petCheckDelayHours: number;
  followupCallDelayHours: number;
}) {
  const sql = getSql();
  const clinicId = await resolveClinicId(input.clinicId);
  const current = await getClientJourneySettings({ clinicId });
  const rows = await sql<JourneySettingsRow[]>`
    update client_journey_settings
    set
      confirmation_email_enabled = ${input.confirmationEmailEnabled},
      reminder_email_hours = ${input.reminderEmailHours},
      reminder_sms_hours = ${input.reminderSmsHours},
      reminder_sms_enabled = ${input.reminderSmsEnabled},
      quiet_hours_start = ${input.quietHoursStart},
      quiet_hours_end = ${input.quietHoursEnd},
      feedback_delay_minutes = ${input.feedbackDelayMinutes},
      pet_check_delay_hours = ${input.petCheckDelayHours},
      followup_call_delay_hours = ${input.followupCallDelayHours},
      updated_at = now()
    where clinic_id = ${clinicId}
    returning ${sql.unsafe(journeySettingsColumns)}
  `;
  return normalizeJourneySettings(rows[0], current.timeZone);
}
