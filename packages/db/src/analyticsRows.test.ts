import assert from "node:assert/strict";
import test from "node:test";
import { normalizeWaitStages, ratePercent } from "./analyticsRows";

test("analytics keeps every visit stage visible while data is collecting", () => {
  const stages = normalizeWaitStages([
    {
      key: "total_visit",
      median_minutes: "61.25",
      p90_minutes: 94.76,
      sample_size: "8"
    },
    {
      key: "check_in_to_room",
      median_minutes: 4,
      p90_minutes: 13,
      sample_size: 12
    }
  ]);

  assert.deepEqual(stages.map((stage) => stage.key), [
    "check_in_to_room",
    "room_to_care",
    "care_time",
    "ready_to_checkout",
    "total_visit"
  ]);
  assert.deepEqual(stages[0], {
    key: "check_in_to_room",
    label: "Check-in to room",
    description: "Time after completed check-in before room placement.",
    medianMinutes: 4,
    p90Minutes: 13,
    sampleSize: 12
  });
  assert.equal(stages[1].medianMinutes, null);
  assert.equal(stages[1].sampleSize, 0);
  assert.equal(stages[4].medianMinutes, 61.3);
  assert.equal(stages[4].p90Minutes, 94.8);
});

test("analytics rates avoid invented percentages without a denominator", () => {
  assert.equal(ratePercent(0, 0), null);
  assert.equal(ratePercent(7, 9), 77.8);
  assert.equal(ratePercent(1, -1), null);
});
