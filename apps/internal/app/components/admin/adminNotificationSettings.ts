import type { ClientJourneySettings } from "@central-vet/db";

export type EditableNotificationSettings = Pick<
  ClientJourneySettings,
  | "confirmationEmailEnabled"
  | "reminderEmailHours"
  | "reminderSmsHours"
  | "reminderSmsEnabled"
  | "quietHoursStart"
  | "quietHoursEnd"
  | "feedbackDelayMinutes"
  | "petCheckDelayHours"
  | "followupCallDelayHours"
>;

type TimingOption = Readonly<{ value: number; label: string }>;

export const emailReminderOptions: readonly TimingOption[] = [
  { value: 168, label: "1 week before" },
  { value: 72, label: "3 days before" },
  { value: 48, label: "2 days before" },
  { value: 24, label: "1 day before" },
  { value: 12, label: "12 hours before" }
];

export const textReminderOptions: readonly TimingOption[] = [
  { value: 48, label: "2 days before" },
  { value: 24, label: "1 day before" },
  { value: 12, label: "12 hours before" },
  { value: 6, label: "6 hours before" },
  { value: 2, label: "2 hours before" }
];

export const feedbackOptions: readonly TimingOption[] = [
  { value: 30, label: "30 minutes after" },
  { value: 60, label: "1 hour after" },
  { value: 75, label: "75 minutes after" },
  { value: 120, label: "2 hours after" },
  { value: 240, label: "4 hours after" }
];

export const petCheckOptions: readonly TimingOption[] = [
  { value: 12, label: "12 hours after" },
  { value: 24, label: "1 day after" },
  { value: 48, label: "2 days after" },
  { value: 72, label: "3 days after" }
];

export const callQueueOptions: readonly TimingOption[] = [
  { value: 24, label: "1 day without a reply" },
  { value: 48, label: "2 days without a reply" },
  { value: 72, label: "3 days without a reply" },
  { value: 96, label: "4 days without a reply" }
];

export const clockOptions = Array.from({ length: 24 }, (_, hour) => {
  const value = `${String(hour).padStart(2, "0")}:00`;
  return {
    value,
    label: new Date(2020, 0, 1, hour).toLocaleTimeString("en-US", {
      hour: "numeric"
    })
  };
});

export function editableNotificationSettings(
  settings: ClientJourneySettings
): EditableNotificationSettings {
  return {
    confirmationEmailEnabled: settings.confirmationEmailEnabled,
    reminderEmailHours: settings.reminderEmailHours,
    reminderSmsHours: settings.reminderSmsHours,
    reminderSmsEnabled: settings.reminderSmsEnabled,
    quietHoursStart: settings.quietHoursStart.slice(0, 5),
    quietHoursEnd: settings.quietHoursEnd.slice(0, 5),
    feedbackDelayMinutes: settings.feedbackDelayMinutes,
    petCheckDelayHours: settings.petCheckDelayHours,
    followupCallDelayHours: settings.followupCallDelayHours
  };
}

export function notificationSettingsChanged(
  settings: ClientJourneySettings,
  draft: EditableNotificationSettings
) {
  const saved = editableNotificationSettings(settings);
  return Object.keys(saved).some((key) => {
    const setting = key as keyof EditableNotificationSettings;
    return draft[setting] !== saved[setting];
  });
}
