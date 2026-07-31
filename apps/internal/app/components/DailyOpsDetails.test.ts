import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./DailyOpsDetails.tsx", import.meta.url), "utf8");

test("daily ops details share local item and date helpers", () => {
  assert.match(source, /function formatOpsDetailDate\(value: string\)/);
  assert.match(source, /const OPS_DETAIL_DATE_OPTIONS = \{/);
  assert.match(source, /function OpsDetailItem\(/);
  assert.match(source, /<OpsDetailItem\n\s+key=\{a.id\}/);
  assert.match(source, /<OpsDetailItem\n\s+key=\{f.id\}/);
  assert.match(source, /<OpsDetailItem\n\s+key=\{t.id\}/);
  assert.match(source, /<OpsDetailItem\n\s+key=\{r.id\}/);
});

test("daily ops details preserve visible empty states and labels", () => {
  assert.match(source, /No pending approvals\./);
  assert.match(source, /No open follow-ups\./);
  assert.match(source, /No high-priority tasks pending\./);
  assert.match(source, /No recent pricing reports\./);
  assert.match(source, /opsDetailItem--approval/);
  assert.match(source, /opsDetailItem--followup/);
  assert.match(source, /opsDetailItem--task/);
  assert.match(source, /opsDetailItem--pricing/);
  assert.match(source, /opsDetailBadge--pending/);
  assert.match(source, /opsDetailBadge--open/);
  assert.match(source, /opsDetailBadge--urgent/);
  assert.match(source, /opsDetailBadge--pricing/);
  assert.match(source, /BellRing size=\{13\}/);
  assert.match(source, /Calendar size=\{13\}/);
  assert.match(source, /AlertTriangle size=\{13\}/);
  assert.match(source, /Search size=\{13\}/);
  assert.match(source, /<Clock size=\{11\}/);
  assert.match(source, /date=\{`Due \$\{f\.dueDate\}`\}/);
  assert.match(source, /new Date\(value\)\.toLocaleDateString\("en-US", OPS_DETAIL_DATE_OPTIONS\)/);
});
