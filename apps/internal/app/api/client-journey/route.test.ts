import assert from "node:assert/strict";
import test from "node:test";
import { hasOutstandingFeedbackPrompt } from "./route";
import { clientJourneySettingsPatchSchema } from "./staff/route";

const due = "2030-02-05T18:30:00.000Z";
const now = new Date("2030-02-05T19:00:00.000Z").getTime();

test("feedback requires a due matching prompt", () => {
  assert.equal(hasOutstandingFeedbackPrompt({
    messages: [{ messageType: "visit_experience", status: "planned", scheduledFor: due }],
    events: []
  }, "visit_experience", now), true);
  assert.equal(hasOutstandingFeedbackPrompt({
    messages: [{ messageType: "pet_health_check", status: "planned", scheduledFor: due }],
    events: []
  }, "visit_experience", now), false);
});

test("feedback rejects early and already answered prompts", () => {
  assert.equal(hasOutstandingFeedbackPrompt({
    messages: [{ messageType: "visit_experience", status: "planned", scheduledFor: "2030-02-06T18:30:00.000Z" }],
    events: []
  }, "visit_experience", now), false);
  assert.equal(hasOutstandingFeedbackPrompt({
    messages: [{ messageType: "visit_experience", status: "sent", scheduledFor: due }],
    events: [{ eventType: "visit_experience_down", occurredAt: "2030-02-05T18:45:00.000Z" }]
  }, "visit_experience", now), false);
});

const validSettingsPatch = {
  actor: {
    name: "Clinic Admin",
    role: "admin" as const,
    passcode: "1234"
  },
  settings: {
    confirmationEmailEnabled: true,
    reminderEmailHours: 48,
    reminderSmsHours: 24,
    reminderSmsEnabled: true,
    quietHoursStart: "20:00",
    quietHoursEnd: "08:00",
    feedbackDelayMinutes: 75,
    petCheckDelayHours: 24,
    followupCallDelayHours: 48
  }
};

test("notification settings accept the editable tenant fields", () => {
  assert.equal(clientJourneySettingsPatchSchema.safeParse(validSettingsPatch).success, true);
});

test("notification settings reject invalid timing and unknown fields", () => {
  assert.equal(clientJourneySettingsPatchSchema.safeParse({
    ...validSettingsPatch,
    settings: {
      ...validSettingsPatch.settings,
      reminderEmailHours: 0
    }
  }).success, false);
  assert.equal(clientJourneySettingsPatchSchema.safeParse({
    ...validSettingsPatch,
    settings: {
      ...validSettingsPatch.settings,
      deliveryMode: "production"
    }
  }).success, false);
});
