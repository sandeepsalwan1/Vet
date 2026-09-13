import assert from "node:assert/strict";
import test from "node:test";
import type { ClientAnalyticsSnapshot } from "@central-vet/db";
import {
  analyticsDateTime,
  analyticsFreshness,
  analyticsMinutes,
  analyticsPercent,
  waitTimeChartData
} from "./adminAnalyticsModel";

test("analytics labels distinguish collecting data from real zeroes", () => {
  assert.equal(analyticsPercent(null), "Collecting");
  assert.equal(analyticsPercent(0), "0%");
  assert.equal(analyticsMinutes(null), "Collecting");
  assert.equal(analyticsMinutes(0), "<1 min");
  assert.equal(analyticsMinutes(12.6), "13 min");
});

test("analytics freshness handles missing and malformed timestamps", () => {
  assert.equal(analyticsFreshness(null), "Waiting for first event");
  assert.equal(analyticsDateTime("not-a-date"), "Unknown time");
  assert.equal(analyticsFreshness("not-a-date"), "Data through Unknown time");
});

test("wait chart includes only stages backed by visits", () => {
  const stages: ClientAnalyticsSnapshot["waitStages"] = [
    {
      key: "check_in_to_room",
      label: "Check-in to room",
      description: "Room wait",
      medianMinutes: 4.5,
      p90Minutes: 12,
      sampleSize: 8
    },
    {
      key: "care_time",
      label: "With care team",
      description: "Care time",
      medianMinutes: null,
      p90Minutes: null,
      sampleSize: 0
    }
  ];

  assert.deepEqual(waitTimeChartData(stages), [
    {
      stage: "Check-in to room",
      median: 4.5,
      p90: 12
    }
  ]);
});
