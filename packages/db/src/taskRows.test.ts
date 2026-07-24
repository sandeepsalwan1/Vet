import assert from "node:assert/strict";
import test from "node:test";
import { taskDateText } from "./taskRows";

test("task dates stay compatible with date and time inputs", () => {
  assert.equal(taskDateText("2026-05-31T00:00:00.000Z"), "2026-05-31");
  assert.equal(taskDateText(new Date("2026-05-31T00:00:00.000Z")), "2026-05-31");
});
