import assert from "node:assert/strict";
import test from "node:test";

import {
  checkState,
  evaluate,
  nativeAutomergeArgs,
  statusState
} from "./agent-automerge.mjs";

const sha = "abc123";
const config = {
  repo: { owner: "sandeepsalwan1", name: "Vet", defaultBranch: "main" },
  labels: {
    automerge: "agent:automerge",
    proof: "agent:proof"
  },
  comments: { triage: "<!-- agent-triage:v1 -->" },
  automerge: {
    requiredLabels: ["agent:automerge"],
    blockedLabels: ["priority:high", "agent:blocked"],
    requiredStatuses: ["agent-review", "no-mistakes"],
    requiredChecks: ["quality", "build", "scenarios"],
    proofStatus: "agent-proof"
  }
};

function status(context, state = "success", id = 1, itemSha = sha) {
  return { id, context, state, sha: itemSha, created_at: `2026-07-13T00:00:${String(id).padStart(2, "0")}Z` };
}

function check(name, conclusion = "success", id = 1, headSha = sha) {
  return { id, name, conclusion, head_sha: headSha, started_at: `2026-07-13T00:00:${String(id).padStart(2, "0")}Z` };
}

function triage(overrides = {}) {
  const decision = {
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
  return {
    id: 1,
    updated_at: "2026-07-13T00:00:00Z",
    user: { login: "github-actions[bot]" },
    body: `<!-- agent-triage:v1 -->\nStructured decision:\n\`\`\`json\n${JSON.stringify(decision)}\n\`\`\``
  };
}

function fixture(overrides = {}) {
  const metadata = {
    sourceIssue: 17,
    sourceLabels: ["agent:automerge"],
    automergeEligible: true
  };
  const value = {
    config,
    pull: {
      number: 18,
      state: "open",
      merged: false,
      draft: false,
      body: `Closes #17\n\n<!-- agent-implementation:v1 -->\n\`\`\`json\n${JSON.stringify(metadata)}\n\`\`\``,
      head: { ref: "agent/issue-17-focused-change", sha, repo: { full_name: "sandeepsalwan1/Vet" } },
      base: { ref: "main", repo: { full_name: "sandeepsalwan1/Vet" } }
    },
    pullIssue: { labels: [{ name: "agent:automerge" }] },
    sourceIssue: { number: 17, state: "open", labels: [{ name: "agent:automerge" }] },
    sourceComments: [triage()],
    combined: {
      sha,
      statuses: [status("agent-review", "success", 1), status("no-mistakes", "success", 2)]
    },
    checks: {
      check_runs: [check("quality", "success", 1), check("build", "success", 2), check("scenarios", "success", 3)]
    }
  };
  return { ...value, ...overrides };
}

test("safe same-repository agent PR is eligible for native automerge", () => {
  const result = evaluate(fixture());

  assert.equal(result.allowed, true);
  assert.equal(result.proofRequested, false);
  const args = nativeAutomergeArgs(18, config, sha);
  assert.ok(args.includes("--auto"));
  assert.deepEqual(args.slice(-2), ["--match-head-commit", sha]);
});

test("newest status and check run win while stale or foreign SHA data is ignored", () => {
  assert.equal(
    statusState(
      [status("agent-review", "success", 1), status("agent-review", "failure", 2), status("agent-review", "success", 3, "old")],
      "agent-review",
      sha
    ),
    "failure"
  );
  assert.equal(
    checkState(
      [check("quality", "success", 1), check("quality", "in_progress", 2), check("quality", "success", 3, "old")],
      "quality",
      sha
    ),
    "in_progress"
  );
});

test("source issue and branch authorization fail closed", () => {
  const value = fixture();
  value.pull.head.repo.full_name = "attacker/Vet";
  value.pull.head.ref = "agent/issue-99-focused-change";
  value.sourceIssue.labels.push({ name: "agent:blocked" });

  const result = evaluate(value);

  assert.equal(result.allowed, false);
  assert.ok(result.blockers.includes("PR must use a same-repository branch"));
  assert.ok(result.blockers.includes("PR branch does not match implementation source issue"));
  assert.ok(result.blockers.includes("source issue blocked by label agent:blocked"));
});

test("high-risk triage or a human question blocks automerge", () => {
  const value = fixture({ sourceComments: [triage({ risk: "high", humanQuestion: "Which behavior is intended?" })] });

  const result = evaluate(value);

  assert.equal(result.allowed, false);
  assert.ok(result.blockers.includes("source triage risk is high"));
  assert.ok(result.blockers.includes("source triage has an unresolved human question"));
});

test("proof status is required only when proof was requested", () => {
  const withoutProof = evaluate(fixture());
  const requested = fixture();
  requested.pullIssue.labels.push({ name: "agent:proof" });
  const missingProof = evaluate(requested);
  requested.combined.statuses.push(status("agent-proof", "success", 3));
  const passedProof = evaluate(requested);

  assert.equal(withoutProof.allowed, true);
  assert.equal(missingProof.allowed, false);
  assert.ok(missingProof.blockers.includes("agent-proof status missing"));
  assert.equal(passedProof.allowed, true);
});

test("untrusted or malformed managed triage cannot authorize automerge", () => {
  const untrusted = fixture({ sourceComments: [{ ...triage(), user: { login: "someone" } }] });
  const malformed = fixture({ sourceComments: [{ ...triage(), body: "<!-- agent-triage:v1 -->\nnot json" }] });

  assert.ok(evaluate(untrusted).blockers.includes("source issue has no trusted managed triage"));
  assert.ok(evaluate(malformed).blockers.includes("managed triage JSON is missing"));
});
