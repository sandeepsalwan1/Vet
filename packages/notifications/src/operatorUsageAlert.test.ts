import assert from "node:assert/strict";
import test from "node:test";
import {
  decideOperatorUsageAlert,
  operatorUsageAlertWasDelivered
} from "./operatorUsageAlert";

const now = new Date("2026-07-27T12:00:00.000Z");

test("low-usage alert waits while real usage is collecting", () => {
  assert.deepEqual(decideOperatorUsageAlert({
    enabled: true,
    percent: null,
    thresholdPercent: 15,
    previousState: "collecting",
    lastSentAt: null,
    now
  }), {
    state: "collecting",
    shouldSend: false,
    reason: "collecting"
  });
});

test("low-usage alert sends once when return crosses below 15 percent", () => {
  assert.deepEqual(decideOperatorUsageAlert({
    enabled: true,
    percent: 14.9,
    thresholdPercent: 15,
    previousState: "healthy",
    lastSentAt: null,
    now
  }), {
    state: "below",
    shouldSend: true,
    reason: "crossed_below"
  });
});

test("low-usage alert does not send while disabled", () => {
  assert.equal(decideOperatorUsageAlert({
    enabled: false,
    percent: 10,
    thresholdPercent: 15,
    previousState: "healthy",
    lastSentAt: null,
    now
  }).shouldSend, false);
});

test("low-usage alert suppresses reminders for 30 days", () => {
  assert.deepEqual(decideOperatorUsageAlert({
    enabled: true,
    percent: 10,
    thresholdPercent: 15,
    previousState: "below",
    lastSentAt: "2026-07-01T12:00:00.000Z",
    now
  }), {
    state: "below",
    shouldSend: false,
    reason: "cooldown"
  });

  assert.equal(decideOperatorUsageAlert({
    enabled: true,
    percent: 10,
    thresholdPercent: 15,
    previousState: "below",
    lastSentAt: "2026-06-27T12:00:00.000Z",
    now
  }).reason, "reminder_due");
});

test("low-usage alert advances cooldown only after confirmed delivery", () => {
  assert.equal(
    operatorUsageAlertWasDelivered({
      status: "duplicate",
      priorStatus: "failed"
    }),
    false
  );
  assert.equal(
    operatorUsageAlertWasDelivered({
      status: "duplicate",
      priorStatus: "sent"
    }),
    true
  );
  assert.equal(
    operatorUsageAlertWasDelivered({ status: "sent" }),
    true
  );
});
