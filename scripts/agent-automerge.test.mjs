import assert from "node:assert/strict";
import test from "node:test";
import { issueSnapshotSha256 } from "./agent-lib.mjs";

import {
  checkState,
  disableNativeAutomergeArgs,
  evaluate,
  nativeMergeArgs,
  revokeNativeAutomerge,
  settleAutomerge,
  statusState
} from "./agent-automerge.mjs";

const sha = "a".repeat(40);
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

function status(context, state = "success", id = 1) {
  return {
    id,
    context,
    state,
    creator: { login: "github-actions[bot]" },
    target_url: `https://github.com/sandeepsalwan1/Vet/actions/runs/${id}`,
    created_at: `2026-07-13T00:00:${String(id).padStart(2, "0")}Z`
  };
}

function check(name, conclusion = "success", id = 1, headSha = sha) {
  return {
    id,
    name,
    conclusion,
    head_sha: headSha,
    app: { slug: "github-actions" },
    details_url: `https://github.com/sandeepsalwan1/Vet/actions/runs/${id}/job/${id}`,
    started_at: `2026-07-13T00:00:${String(id).padStart(2, "0")}Z`
  };
}

function sourceIssue() {
  return {
    number: 17,
    state: "open",
    title: "Focused change",
    body: "Apply the focused change.",
    labels: [{ name: "agent:automerge" }]
  };
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
    issueSnapshotSha256: issueSnapshotSha256(sourceIssue()),
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
  const source = sourceIssue();
  const metadata = {
    sourceIssue: 17,
    sourceLabels: ["agent:automerge"],
    automergeEligible: true,
    issueSnapshotSha256: issueSnapshotSha256(source)
  };
  const value = {
    config,
    pull: {
      number: 18,
      state: "open",
      merged: false,
      merged_at: null,
      draft: false,
      changed_files: 1,
      user: { login: "github-actions[bot]" },
      body: `Closes #17\n\n<!-- agent-implementation:v1 -->\nAgent implementation metadata:\n\`\`\`json\n${JSON.stringify(metadata)}\n\`\`\``,
      head: { ref: "agent/issue-17-focused-change", sha, repo: { full_name: "sandeepsalwan1/Vet" } },
      base: { ref: "main", repo: { full_name: "sandeepsalwan1/Vet" } }
    },
    pullIssue: { labels: [{ name: "agent:automerge" }] },
    sourceIssue: source,
    sourceComments: [triage()],
    combined: {
      sha,
      statuses: [status("agent-review", "success", 1), status("no-mistakes", "success", 2)]
    },
    checks: {
      check_runs: [check("quality", "success", 1), check("build", "success", 2), check("scenarios", "success", 3)]
    },
    files: [{ filename: "packages/agents/src/scenarioRunner.ts" }],
    closingReferences: [{ number: 17 }]
  };
  return { ...value, ...overrides };
}

test("safe same-repository agent PR is eligible for immediate merge", () => {
  const result = evaluate(fixture());

  assert.equal(result.allowed, true);
  assert.equal(result.proofRequested, false);
  const args = nativeMergeArgs(18, config, sha);
  assert.equal(args.includes("--auto"), false);
  assert.ok(args.includes("--merge"));
  assert.ok(args.includes("--delete-branch"));
  assert.deepEqual(args.slice(-2), ["--match-head-commit", sha]);
});

test("eligible PR is merged immediately after making a draft ready", () => {
  const value = fixture();
  value.pull.draft = true;
  const commands = [];

  const outcome = settleAutomerge(
    { config, prNumber: 18, pull: value.pull, decision: evaluate(value) },
    { runCommand: (command, args) => commands.push([command, args]) }
  );

  assert.equal(outcome.code, 0);
  assert.equal(outcome.result.message, "merged PR #18");
  assert.deepEqual(commands, [
    ["gh", ["pr", "ready", "18", "--repo", "sandeepsalwan1/Vet"]],
    ["gh", nativeMergeArgs(18, config, sha)]
  ]);
});

test("eligible PR revokes stale native automerge before immediate merge", () => {
  const value = fixture();
  value.pull.auto_merge = { merge_method: "merge" };
  const commands = [];

  settleAutomerge(
    { config, prNumber: 18, pull: value.pull, decision: evaluate(value) },
    { runCommand: (command, args) => commands.push([command, args]) }
  );

  assert.deepEqual(commands, [
    ["gh", disableNativeAutomergeArgs(18, config)],
    ["gh", nativeMergeArgs(18, config, sha)]
  ]);
});

test("blocked PR disables existing native automerge before commenting", () => {
  const value = fixture();
  value.pull.auto_merge = { merge_method: "merge" };
  const decision = evaluate({ ...value, sourceIssue: { ...value.sourceIssue, state: "closed" } });
  const events = [];

  const outcome = settleAutomerge(
    { config, prNumber: 18, pull: value.pull, decision },
    {
      runCommand: (command, args) => events.push(["command", command, args]),
      upsertManagedComment: (input) => {
        events.push(["comment", input]);
        return { ok: true };
      }
    }
  );

  assert.equal(outcome.code, 1);
  assert.equal(outcome.result.nativeAutomerge, "disabled");
  assert.deepEqual(events[0], ["command", "gh", disableNativeAutomergeArgs(18, config)]);
  assert.equal(events[1][0], "comment");
});

test("dry run never mutates merge state", () => {
  const allowedValue = fixture();
  const blockedValue = fixture();
  blockedValue.pull.auto_merge = { merge_method: "merge" };
  const blockedDecision = evaluate({
    ...blockedValue,
    sourceIssue: { ...blockedValue.sourceIssue, state: "closed" }
  });
  const commands = [];
  const comments = [];
  const dependencies = {
    runCommand: (...args) => commands.push(args),
    upsertManagedComment: (input) => {
      comments.push(input);
      return { ok: true, dryRun: input.dryRun };
    }
  };

  const allowed = settleAutomerge(
    { config, prNumber: 18, pull: allowedValue.pull, decision: evaluate(allowedValue), dryRun: true },
    dependencies
  );
  const blocked = settleAutomerge(
    { config, prNumber: 18, pull: blockedValue.pull, decision: blockedDecision, dryRun: true },
    dependencies
  );

  assert.equal(allowed.result.message, "would merge PR #18");
  assert.equal(blocked.result.nativeAutomerge, "would-disable");
  assert.deepEqual(commands, []);
  assert.equal(comments.length, 1);
  assert.equal(comments[0].dryRun, true);
});

test("stale native automerge revocation is dry-run safe", () => {
  const commands = [];
  const pull = { auto_merge: { merge_method: "merge" } };

  const dryRun = revokeNativeAutomerge(
    { config, prNumber: 18, pull, dryRun: true },
    { runCommand: (...args) => commands.push(args) }
  );
  const disabled = revokeNativeAutomerge(
    { config, prNumber: 18, pull },
    { runCommand: (...args) => commands.push(args) }
  );

  assert.equal(dryRun, "would-disable");
  assert.equal(disabled, "disabled");
  assert.deepEqual(commands, [["gh", disableNativeAutomergeArgs(18, config)]]);
});

test("newest API-shaped status and current-head check run win", () => {
  assert.equal(
    statusState(
      [status("agent-review", "success", 1), status("agent-review", "failure", 2)],
      "agent-review",
      config
    ),
    "failure"
  );
  assert.equal(
    checkState(
      [check("quality", "success", 1), check("quality", "in_progress", 2), check("quality", "success", 3, "old")],
      "quality",
      sha,
      config
    ),
    "in_progress"
  );

  const staleCombined = fixture();
  staleCombined.combined = { ...staleCombined.combined, sha: "b".repeat(40) };
  assert.ok(evaluate(staleCombined).blockers.includes("commit statuses are not for the current PR head"));
});

test("custom statuses and checks require GitHub Actions provenance", () => {
  const forgedStatus = {
    ...status("agent-review"),
    creator: { login: "integration-bot" }
  };
  const foreignStatus = {
    ...status("agent-review"),
    target_url: "https://github.com/attacker/repo/actions/runs/1"
  };
  const forgedCheck = { ...check("quality"), app: { slug: "custom-ci" } };

  assert.equal(statusState([forgedStatus, foreignStatus], "agent-review", config), "missing");
  assert.equal(checkState([forgedCheck], "quality", sha, config), "missing");
});

test("non-bot PR authors cannot authorize or mutate automerge", () => {
  const value = fixture();
  value.pull.user.login = "contributor";
  value.pull.auto_merge = { merge_method: "merge" };
  const decision = evaluate(value);
  const commands = [];

  const outcome = settleAutomerge(
    { config, prNumber: 18, pull: value.pull, decision },
    { runCommand: (...args) => commands.push(args) }
  );

  assert.equal(decision.trustedPull, false);
  assert.ok(decision.blockers.includes("agent PR author must be github-actions[bot]"));
  assert.equal(outcome.result.nativeAutomerge, "not-touched");
  assert.deepEqual(commands, []);
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
  assert.ok(evaluate(malformed).blockers.includes("managed triage must contain exactly one decision JSON block"));
});

test("repo-owner managed triage can authorize automerge", () => {
  const ownerTriage = { ...triage(), user: { login: "sandeepsalwan1" } };

  assert.equal(evaluate(fixture({ sourceComments: [ownerTriage] })).allowed, true);
});
