import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { concurrencySlot, validateConcurrencyConfig } from "./agent-concurrency-slot.mjs";
import { loadConfig } from "./agent-lib.mjs";

const config = loadConfig();

test("configured lanes fit the low default and hard global caps", () => {
  const validated = validateConcurrencyConfig(config);

  assert.equal(validated.allocated, 8);
  assert.equal(validated.maxGlobal, 8);
  assert.equal(validated.hardMaxGlobal, 15);
});

test("the same lane and target always receive the same slot", () => {
  assert.deepEqual(concurrencySlot(config, "triage", "42"), concurrencySlot(config, "triage", "42"));
});

test("lane allocations are disjoint and never exceed lane or global caps", () => {
  const validated = validateConcurrencyConfig(config);
  const allGroups = new Set();

  for (const lane of validated.lanes) {
    const laneGroups = new Set();
    for (let key = 1; key <= 2_000; key += 1) {
      const slot = concurrencySlot(config, lane.name, String(key));
      assert.ok(slot.globalSlot >= 1 && slot.globalSlot <= validated.maxGlobal);
      laneGroups.add(slot.group);
      allGroups.add(slot.group);
    }
    assert.equal(laneGroups.size, lane.capacity);
  }

  assert.equal(allGroups.size, validated.allocated);
  assert.ok(allGroups.size <= validated.maxGlobal);
  assert.ok(allGroups.size <= validated.hardMaxGlobal);
});

test("invalid or overcommitted configurations fail closed", () => {
  const base = structuredClone(config);

  assert.throws(
    () => validateConcurrencyConfig({ ...base, concurrency: { ...base.concurrency, maxGlobal: 16 } }),
    /cannot exceed concurrency\.hardMaxGlobal/
  );
  assert.throws(
    () =>
      validateConcurrencyConfig({
        ...base,
        concurrency: {
          ...base.concurrency,
          lanes: { ...base.concurrency.lanes, proof: 2 }
        }
      }),
    /lane capacity 9 exceeds concurrency\.maxGlobal 8/
  );
  assert.throws(() => concurrencySlot(base, "missing", "1"), /unknown concurrency lane missing/);
  assert.throws(() => concurrencySlot(base, "proof", ""), /missing concurrency key/);
});

test("every costly agent job uses its configured global slot with queued admission", () => {
  const expectations = [
    [".github/workflows/agent-propose.yml", "proposer", 1],
    [".github/workflows/agent-triage.yml", "triage", 1],
    [".github/workflows/agent-implement.yml", "implement", 2],
    [".github/workflows/agent-review.yml", "review", 1],
    [".github/workflows/agent-no-mistakes.yml", "review", 1],
    [".github/workflows/agent-proof.yml", "proof", 2]
  ];
  const wiredLanes = new Set();

  for (const [path, lane, expectedAdmissions] of expectations) {
    const workflow = readFileSync(join(process.cwd(), path), "utf8");
    wiredLanes.add(lane);
    assert.match(workflow, new RegExp(`agent-concurrency-slot\\.mjs --lane ${lane} `));
    assert.equal(workflow.match(/^    concurrency:$/gm)?.length ?? 0, expectedAdmissions);
    assert.equal(workflow.match(/^      queue: max$/gm)?.length ?? 0, expectedAdmissions);
  }

  assert.deepEqual(wiredLanes, new Set(Object.keys(config.concurrency.lanes)));
});

test("actionlint ignores only its stale concurrency queue schema error", () => {
  const workflow = readFileSync(
    join(process.cwd(), ".github/workflows/ci.yml"),
    "utf8"
  );

  assert.match(
    workflow,
    /flags: '-ignore "unexpected key \.[*]queue\.[*] for \.[*]concurrency\.[*] section"'/
  );
});
