import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizePlatformUsageSnapshot,
  type PlatformOperatorSettingsRow
} from "./productUsageRows";

const settings: PlatformOperatorSettingsRow = {
  usage_alerts_enabled: false,
  return_rate_threshold: "15",
  current_alert_state: "collecting",
  last_alerted_at: null,
  updated_at: "2026-07-27T12:00:00.000Z"
};

test("usage stays Collecting until five mature users exist", () => {
  const snapshot = normalizePlatformUsageSnapshot({
    summary: {
      daily_active_users: "3",
      active_hospitals: "1",
      sessions_this_month: "12",
      data_through: "2026-07-27T11:00:00.000Z"
    },
    retention: {
      eligible_users: "4",
      returned_users: "1"
    },
    settings,
    generatedAt: "2026-07-27T12:00:00.000Z"
  });

  assert.equal(snapshot.returnRate.percent, null);
  assert.equal(snapshot.returnRate.minimumCohortSize, 5);
  assert.equal(snapshot.dailyActiveUsers, 3);
  assert.equal(snapshot.sessionsThisMonth, 12);
});

test("usage calculates the mature days 8 to 30 return cohort", () => {
  const snapshot = normalizePlatformUsageSnapshot({
    summary: undefined,
    retention: {
      eligible_users: 10,
      returned_users: 2
    },
    settings
  });

  assert.equal(snapshot.returnRate.percent, 20);
  assert.equal(snapshot.returnRate.eligibleUsers, 10);
  assert.equal(snapshot.returnRate.returnedUsers, 2);
});
