import assert from "node:assert/strict";
import test from "node:test";

import { triageLabelChanges } from "./agent-triage.mjs";

const config = {
  labels: {
    triage: "agent:triage",
    implement: "agent:implement",
    review: "agent:review",
    proof: "agent:proof",
    automerge: "agent:automerge",
    blocked: "agent:blocked",
    priorityHigh: "priority:high",
    priorityLow: "priority:low"
  }
};

function decision(overrides = {}) {
  return {
    value: "medium",
    priority: "medium",
    risk: "medium",
    alignment: "yes",
    implementationScope: "Focused change",
    proofNeeded: "CI",
    automationDecision: "implement",
    humanQuestion: "",
    ...overrides
  };
}

test("manual review blocks and removes stale implementation labels", () => {
  const changes = triageLabelChanges(config, decision({ automationDecision: "manual-review" }));

  assert.equal(changes.blocked, true);
  assert.ok(changes.add.includes(config.labels.blocked));
  assert.ok(changes.remove.includes(config.labels.implement));
  assert.ok(changes.remove.includes(config.labels.automerge));
});

test("safe implementation does not clear a shared blocked label", () => {
  const changes = triageLabelChanges(config, decision());

  assert.equal(changes.blocked, false);
  assert.ok(changes.add.includes(config.labels.implement));
  assert.ok(changes.add.includes(config.labels.automerge));
  assert.ok(!changes.remove.includes(config.labels.blocked));
});
