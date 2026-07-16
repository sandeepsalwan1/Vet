import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { routeEvent } from "./agent-router.mjs";

const config = {
  labels: {
    triage: "agent:triage",
    implement: "agent:implement",
    review: "agent:review",
    proof: "agent:proof",
    automerge: "agent:automerge",
    blocked: "agent:blocked"
  }
};

function issueEvent(label, number = 42) {
  return { label: { name: label }, issue: { number } };
}

test("agent:implement enters trusted triage before implementation", () => {
  assert.deepEqual(routeEvent(issueEvent("agent:implement"), config), {
    lane: "triage",
    kind: "issue",
    issueNumber: 42,
    reason: "implementation request requires trusted triage"
  });
  assert.deepEqual(routeEvent(issueEvent("agent:triage"), config), {
    lane: "triage",
    kind: "issue",
    issueNumber: 42
  });
});

test("unrelated labels remain inert", () => {
  assert.deepEqual(routeEvent(issueEvent("bug"), config), {
    lane: "none",
    reason: "ignored label bug"
  });
});

test("default AFK issue form starts the one-label path", () => {
  const form = readFileSync(new URL("../.github/ISSUE_TEMPLATE/afk-implementation.yml", import.meta.url), "utf8");
  const workflow = readFileSync(new URL("../.github/workflows/agent-router.yml", import.meta.url), "utf8");

  assert.match(form, /labels:\n  - "agent:implement"/);
  assert.match(form, /id: outcome[\s\S]*?required: true/);
  assert.match(form, /id: acceptance[\s\S]*?required: true/);
  assert.match(workflow, /issues:\n    types:\n      - labeled/);
  assert.doesNotMatch(workflow, /      - opened/);
});
