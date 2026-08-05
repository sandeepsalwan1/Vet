import assert from "node:assert/strict";
import test from "node:test";
import { taskDateText } from "./taskRows";

test("task date projection stays deterministic across supported inputs", () => {
  const cases = [
    {
      input: "2026-05-31",
      expected: "2026-05-31",
      note: "calendar date stays unchanged"
    },
    {
      input: "2026-05-31T23:30:00-02:00",
      expected: "2026-06-01",
      note: "timestamp normalizes to UTC date"
    },
    {
      input: new Date("2026-05-31T00:00:00.000Z"),
      expected: "2026-05-31",
      note: "Date normalizes to UTC date"
    },
    {
      input: null,
      expected: null,
      note: "null stays absent"
    },
    {
      input: "not-a-date",
      expected: null,
      note: "malformed input fails safely"
    }
  ] as const;

  for (const { input, expected, note } of cases) {
    assert.equal(taskDateText(input), expected, note);
  }
});
