import assert from "node:assert/strict";
import test from "node:test";
import type { ClientJourneySettings } from "@central-vet/db";
import {
  editableNotificationSettings,
  notificationSettingsChanged
} from "./adminNotificationSettings";

const settings: ClientJourneySettings = {
  clinicId: "clinic",
  timeZone: "America/Los_Angeles",
  publicName: "Example Veterinary Hospital",
  familyStory: "Example clinic",
  primaryDomain: "clinic.example",
  pimsProvider: "mock-clinic",
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

test("notification settings normalize database time values for browser controls", () => {
  assert.deepEqual(editableNotificationSettings(settings), {
    confirmationEmailEnabled: true,
    reminderEmailHours: 48,
    reminderSmsHours: 24,
    reminderSmsEnabled: true,
    quietHoursStart: "20:00",
    quietHoursEnd: "08:00",
    feedbackDelayMinutes: 75,
    petCheckDelayHours: 24,
    followupCallDelayHours: 48
  });
});

test("notification settings detect every editable change without serialization", () => {
  const saved = editableNotificationSettings(settings);
  assert.equal(notificationSettingsChanged(settings, saved), false);

  for (const key of Object.keys(saved) as Array<keyof typeof saved>) {
    const value = saved[key];
    const changed = {
      ...saved,
      [key]: typeof value === "boolean"
        ? !value
        : typeof value === "number"
          ? value + 1
          : `${value}-changed`
    };
    assert.equal(notificationSettingsChanged(settings, changed), true, key);
  }
});
