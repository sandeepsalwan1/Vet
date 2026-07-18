import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { issueSnapshotSha256 } from "./agent-lib.mjs";

import {
  agentWorkflowLabels,
  assertTrustedMergedAgentPull,
  checkState,
  closeAgentLoop,
  closeIssueArgs,
  dispatchPostMergeChecks,
  disableNativeAutomergeArgs,
  evaluate,
  isStaleBase,
  isUpdateBranchMergeConflict,
  nativeMergeArgs,
  postMergeDispatchArgs,
  postMergeRunName,
  recoverStaleBase,
  reconcileMergedAgentPull,
  reconcilePostMergeChecks,
  recoveryDispatchArgs,
  removeLabelArgs,
  resolveBaseState,
  revokeNativeAutomerge,
  settleAutomerge,
  statusState,
  trustedClosingIssueNumbers,
  trustedConflictRecoveryCommands,
  updateBranchArgs
} from "./agent-automerge.mjs";

const sha = "a".repeat(40);
const baseSha = "b".repeat(40);
const updatedSha = "c".repeat(40);
const mergeSha = "d".repeat(40);
const config = {
  repo: { owner: "sandeepsalwan1", name: "Vet", defaultBranch: "main" },
  labels: {
    triage: "agent:triage",
    implement: "agent:implement",
    review: "agent:review",
    automerge: "agent:automerge",
    proof: "agent:proof",
    blocked: "agent:blocked",
    priorityHigh: "priority:high",
    priorityLow: "priority:low"
  },
  comments: { triage: "<!-- agent-triage:v1 -->" },
  automerge: {
    requiredLabels: ["agent:automerge"],
    blockedLabels: ["priority:high", "agent:blocked"],
    requiredStatuses: ["agent-review", "no-mistakes"],
    requiredChecks: ["quality", "build", "scenarios", "audit", "dependency-review"],
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
      base: { ref: "main", sha: baseSha, repo: { full_name: "sandeepsalwan1/Vet" } }
    },
    pullIssue: { labels: [{ name: "agent:automerge" }] },
    sourceIssue: source,
    sourceComments: [triage()],
    combined: {
      sha,
      statuses: [status("agent-review", "success", 1), status("no-mistakes", "success", 2)]
    },
    checks: {
      check_runs: [
        check("quality", "success", 1),
        check("build", "success", 2),
        check("scenarios", "success", 3),
        check("audit", "success", 4),
        check("dependency-review", "success", 5)
      ]
    },
    files: [{ filename: "packages/agents/src/scenarioRunner.ts" }],
    closingReferences: [
      {
        number: 17,
        repository: { name: "Vet", owner: { login: "sandeepsalwan1" } },
        url: "https://github.com/sandeepsalwan1/Vet/issues/17"
      }
    ]
  };
  return { ...value, ...overrides };
}

function expectedCleanupCommands() {
  return [
    ["gh", removeLabelArgs(18, config, "agent:automerge")],
    ["gh", removeLabelArgs(17, config, "agent:automerge")],
    ["gh", closeIssueArgs(17, config)]
  ];
}

function cleanupHarness(decision, { failLabel = "", failWorkflow = "" } = {}) {
  const commands = [];
  const state = new Map([
    [18, { number: 18, state: "open", labels: [...decision.prLabels] }],
    [17, { number: 17, state: "open", labels: [...decision.sourceLabels] }]
  ]);
  return {
    commands,
    getPull() {
      return {
        number: 18,
        state: "closed",
        merged: true,
        merge_commit_sha: mergeSha,
        head: { sha },
        base: { ref: "main" }
      };
    },
    getIssue(number) {
      const issue = state.get(Number(number));
      return { ...issue, labels: [...issue.labels] };
    },
    runCommand(command, args) {
      commands.push([command, args]);
      if (args[0] === "workflow" && args.includes(failWorkflow)) {
        throw new Error("workflow dispatch unavailable");
      }
      if (args[0] === "issue" && args[1] === "edit") {
        const number = Number(args[2]);
        const label = args[args.indexOf("--remove-label") + 1];
        if (number === 18 && label === failLabel) throw new Error("label service unavailable");
        const issue = state.get(number);
        issue.labels = issue.labels.filter((item) => item !== label);
      }
      if (args[0] === "api" && String(args[1]).endsWith("/issues/17")) {
        state.get(17).state = "closed";
      }
    }
  };
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
  const decision = evaluate(value);
  const harness = cleanupHarness(decision);

  const outcome = settleAutomerge(
    { config, prNumber: 18, pull: value.pull, decision },
    harness
  );

  assert.equal(outcome.code, 0);
  assert.equal(outcome.result.message, "merged PR #18");
  assert.deepEqual(harness.commands, [
    ["gh", ["pr", "ready", "18", "--repo", "sandeepsalwan1/Vet"]],
    ["gh", nativeMergeArgs(18, config, sha)],
    ...postMergeDispatchArgs(config, mergeSha).map((args) => ["gh", args]),
    ...expectedCleanupCommands()
  ]);
  assert.equal(outcome.result.postMerge.mergeSha, mergeSha);
});

test("eligible PR revokes stale native automerge before immediate merge", () => {
  const value = fixture();
  value.pull.auto_merge = { merge_method: "merge" };
  const decision = evaluate(value);
  const harness = cleanupHarness(decision);

  settleAutomerge(
    { config, prNumber: 18, pull: value.pull, decision },
    harness
  );

  assert.deepEqual(harness.commands, [
    ["gh", disableNativeAutomergeArgs(18, config)],
    ["gh", nativeMergeArgs(18, config, sha)],
    ...postMergeDispatchArgs(config, mergeSha).map((args) => ["gh", args]),
    ...expectedCleanupCommands()
  ]);
});

test("post-merge checks are dispatched against the exact merge commit", () => {
  const commands = [];
  const result = dispatchPostMergeChecks(
    { config, mergeSha },
    { runCommand: (command, args) => commands.push([command, args]) }
  );

  assert.equal(result.ok, true);
  assert.equal(result.mergeSha, mergeSha);
  assert.deepEqual(
    commands,
    postMergeDispatchArgs(config, mergeSha).map((args) => ["gh", args])
  );
  assert.throws(() => postMergeDispatchArgs(config, "not-a-sha"), /commit SHA is invalid/);
});

test("merged pull recovery dispatches only missing exact-SHA checks", () => {
  const commands = [];
  const result = reconcilePostMergeChecks(
    { config, mergeSha },
    {
      getWorkflowRuns: (workflow) =>
        workflow === "ci.yml"
          ? [{ event: "workflow_dispatch", display_title: postMergeRunName(workflow, mergeSha) }]
          : [],
      runCommand: (command, args) => commands.push([command, args])
    }
  );

  assert.equal(result.ok, true);
  assert.deepEqual(result.existing, ["ci.yml"]);
  assert.deepEqual(commands, [["gh", postMergeDispatchArgs(config, mergeSha)[1]]]);
});

test("merged pull reconciliation validates identity and backfills checks before cleanup", () => {
  const value = fixture();
  const mergedPull = {
    ...value.pull,
    state: "closed",
    merged: true,
    merged_at: "2026-07-13T01:00:00Z",
    merged_by: { login: "github-actions[bot]" },
    merge_commit_sha: mergeSha
  };
  const decision = evaluate(value);
  const harness = cleanupHarness(decision);
  harness.getWorkflowRuns = () => [];

  const outcome = reconcileMergedAgentPull(
    {
      config,
      prNumber: 18,
      pull: mergedPull,
      files: value.files,
      sourceIssue: value.sourceIssue,
      closingReferences: value.closingReferences
    },
    harness
  );

  assert.equal(outcome.code, 0);
  assert.deepEqual(harness.commands, [
    ...postMergeDispatchArgs(config, mergeSha).map((args) => ["gh", args]),
    ...expectedCleanupCommands()
  ]);
  assert.throws(
    () =>
      reconcileMergedAgentPull(
        {
          config,
          prNumber: 18,
          pull: { ...mergedPull, merge_commit_sha: null },
          files: value.files,
          sourceIssue: value.sourceIssue,
          closingReferences: value.closingReferences
        },
        harness
      ),
    /not a trusted agent PR/
  );
});

test("post-merge dispatch failure is visible after merge and cleanup still completes", () => {
  const value = fixture();
  const decision = evaluate(value);
  const harness = cleanupHarness(decision, { failWorkflow: "codeql.yml" });

  const outcome = settleAutomerge(
    { config, prNumber: 18, pull: value.pull, decision },
    harness
  );

  assert.equal(outcome.code, 1);
  assert.equal(outcome.result.merged, true);
  assert.match(outcome.result.message, /post-merge check dispatch failed/);
  assert.equal(outcome.result.postMerge.ok, false);
  assert.equal(outcome.result.postMerge.dispatchErrors.length, 1);
  assert.equal(outcome.result.cleanup.ok, true);
  assert.ok(harness.commands.some(([, args]) => args.join(" ") === closeIssueArgs(17, config).join(" ")));
});

test("stale base recovery uses the authorized head and reruns head-bound gates", async () => {
  const value = fixture();
  value.pull.mergeable_state = "behind";
  const commands = [];
  const ancestorChecks = [];
  const refreshed = {
    ...value.pull,
    head: { ...value.pull.head, sha: updatedSha }
  };

  const outcome = await recoverStaleBase(
    {
      config,
      prNumber: 18,
      pull: value.pull,
      decision: evaluate(value),
      baseState: { stale: true, baseHead: baseSha }
    },
    {
      runCommand: (command, args) => commands.push([command, args]),
      getPull: () => refreshed,
      hasAncestor: (ancestor, descendant) => {
        ancestorChecks.push([ancestor, descendant]);
        return !(ancestor === baseSha && descendant === sha);
      },
      wait: () => Promise.resolve()
    }
  );

  assert.equal(outcome.code, 0);
  assert.equal(outcome.result.recovery.oldHead, sha);
  assert.equal(outcome.result.recovery.newHead, updatedSha);
  assert.deepEqual(commands, [
    ["gh", updateBranchArgs(18, config, sha)],
    ...recoveryDispatchArgs(18, config, updatedSha).map((args) => ["gh", args])
  ]);
  assert.deepEqual(ancestorChecks, [
    [baseSha, sha],
    [sha, updatedSha],
    [baseSha, updatedSha]
  ]);
  assert.equal(commands.some(([, args]) => args[0] === "pr" && args[1] === "merge"), false);
});

test("stale conflict recovery prefers trusted base hunks and reruns every exact-head gate", async () => {
  const value = fixture();
  value.pull.mergeable_state = "dirty";
  const commands = [];
  const mergeConflict = new Error("update failed");
  mergeConflict.details = {
    stdout: '{"message":"merge conflict between base and head","status":"422"}',
    stderr: "gh: merge conflict between base and head (HTTP 422)"
  };

  const outcome = await recoverStaleBase(
    {
      config,
      prNumber: 18,
      pull: value.pull,
      decision: evaluate(value),
      baseState: { stale: true, baseHead: baseSha }
    },
    {
      runCommand: (command, args) => {
        commands.push([command, args]);
        if (command === "gh" && args[1]?.includes("/update-branch")) throw mergeConflict;
      },
      getPull: () => ({ ...value.pull, head: { ...value.pull.head, sha: updatedSha } }),
      hasAncestor: (ancestor, descendant) =>
        (ancestor === sha || ancestor === baseSha) && descendant === updatedSha,
      wait: () => Promise.resolve()
    }
  );

  assert.equal(isUpdateBranchMergeConflict(mergeConflict), true);
  assert.equal(isUpdateBranchMergeConflict(new Error("network failure")), false);
  assert.equal(outcome.code, 0);
  assert.equal(outcome.result.recovery.updateStrategy, "trusted-base-preferred-merge");
  assert.deepEqual(commands, [
    ["gh", updateBranchArgs(18, config, sha)],
    ...trustedConflictRecoveryCommands(config, value.pull.head.ref, sha, baseSha),
    ...recoveryDispatchArgs(18, config, updatedSha).map((args) => ["gh", args])
  ]);
});

test("stale base recovery replaces failed old-head gates only for a policy-eligible PR", async () => {
  const value = fixture();
  value.pull.auto_merge = { merge_method: "merge" };
  value.combined.statuses = [
    status("agent-review", "success", 1),
    status("no-mistakes", "failure", 2)
  ];
  value.checks.check_runs = [];
  const decision = evaluate(value);
  const commands = [];

  assert.equal(decision.allowed, false);
  assert.equal(decision.staleRecoveryAllowed, true);
  const outcome = await recoverStaleBase(
    {
      config,
      prNumber: 18,
      pull: value.pull,
      decision,
      baseState: { stale: true, baseHead: baseSha }
    },
    {
      runCommand: (command, args) => commands.push([command, args]),
      getPull: () => ({ ...value.pull, head: { ...value.pull.head, sha: updatedSha } }),
      hasAncestor: (ancestor, descendant) =>
        (ancestor === sha || ancestor === baseSha) && descendant === updatedSha,
      wait: () => Promise.resolve()
    }
  );

  assert.equal(outcome.code, 0);
  assert.equal(outcome.result.recovery.nativeAutomerge, "disabled");
  assert.deepEqual(commands, [
    ["gh", disableNativeAutomergeArgs(18, config)],
    ["gh", updateBranchArgs(18, config, sha)],
    ...recoveryDispatchArgs(18, config, updatedSha).map((args) => ["gh", args])
  ]);
});

test("stale recovery dry run reports native automerge revocation without mutations", async () => {
  const value = fixture();
  value.pull.auto_merge = { merge_method: "merge" };
  const commands = [];

  const outcome = await recoverStaleBase(
    {
      config,
      prNumber: 18,
      pull: value.pull,
      decision: evaluate(value),
      baseState: { stale: true, baseHead: baseSha },
      dryRun: true
    },
    { runCommand: (...args) => commands.push(args) }
  );

  assert.equal(outcome.result.recovery.nativeAutomerge, "would-disable");
  assert.deepEqual(commands, []);
});

test("stale base recovery fails closed when the updated head lacks authorized ancestry", async () => {
  const value = fixture();
  value.pull.mergeable_state = "behind";
  const commands = [];

  await assert.rejects(
    recoverStaleBase(
      {
        config,
        prNumber: 18,
        pull: value.pull,
        decision: evaluate(value),
        baseState: { stale: true, baseHead: baseSha }
      },
      {
        runCommand: (command, args) => commands.push([command, args]),
        getPull: () => ({ ...value.pull, head: { ...value.pull.head, sha: updatedSha } }),
        hasAncestor: (ancestor, descendant) => ancestor === sha && descendant === updatedSha,
        wait: () => Promise.resolve()
      }
    ),
    /updated PR head does not contain the authorized head and base/
  );

  assert.deepEqual(commands, [["gh", updateBranchArgs(18, config, sha)]]);
});

test("base ancestry is authoritative even when mergeable_state is stale or unknown", () => {
  const value = fixture();
  value.pull.mergeable_state = "unknown";
  const stale = resolveBaseState(
    { config, pull: value.pull },
    { getBaseHead: () => baseSha, hasAncestor: () => false }
  );
  value.pull.mergeable_state = "behind";
  const current = resolveBaseState(
    { config, pull: value.pull },
    { getBaseHead: () => baseSha, hasAncestor: () => true }
  );

  assert.equal(stale.stale, true);
  assert.equal(current.stale, false);
});

test("proof-required recovery dispatches every gate against the new exact head", () => {
  const dispatches = recoveryDispatchArgs(18, config, updatedSha, true);

  assert.equal(dispatches.length, 3);
  for (const args of dispatches) {
    assert.ok(args.includes("--ref"));
    assert.ok(args.includes("main"));
    assert.ok(args.includes(`expected-head-sha=${updatedSha}`));
  }
  assert.ok(dispatches.some((args) => args.includes("agent-proof.yml")));
});

test("trusted workflows reject mutable dispatch targets and publish exact-head CI", () => {
  const ci = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
  const review = readFileSync(new URL("../.github/workflows/agent-review.yml", import.meta.url), "utf8");
  const proof = readFileSync(new URL("../.github/workflows/agent-proof.yml", import.meta.url), "utf8");
  const noMistakes = readFileSync(new URL("../.github/workflows/agent-no-mistakes.yml", import.meta.url), "utf8");
  const automerge = readFileSync(new URL("../.github/workflows/agent-automerge.yml", import.meta.url), "utf8");

  assert.match(ci, /expected-head-sha:\n\s+description: Exact current pull request head SHA/);
  assert.match(ci, /gh pr view "\$REQUESTED_PR"/);
  assert.match(ci, /test "\$\(jq -r '\.headRefOid' "\$pull_file"\)" = "\$REQUESTED_SHA"/);
  assert.match(ci, /ref: \$\{\{ needs\.resolve\.outputs\.candidate_sha \}\}/);
  assert.match(ci, /gh api --method POST "repos\/\$GITHUB_REPOSITORY\/check-runs"/);
  for (const workflow of [review, proof, noMistakes, automerge]) {
    assert.match(workflow, /expected-head-sha:/);
  }
  assert.match(automerge, /ref: main\n          fetch-depth: 0\n          persist-credentials: false/);
  assert.match(review, /test "\$sha" = "\$REQUESTED_HEAD_SHA"/);
  assert.match(proof, /test "\$sha" = "\$REQUESTED_HEAD_SHA"/);
  assert.match(noMistakes, /"\$head_sha" != "\$REQUESTED_HEAD_SHA"/);
  assert.match(automerge, /--expected-head "\$EXPECTED_HEAD_SHA"/);
});

test("merged cleanup accepts only the original trusted agent identity and snapshot", () => {
  const value = fixture();
  const merged = {
    ...value.pull,
    state: "closed",
    merged: true,
    merged_at: "2026-07-13T01:00:00Z",
    merged_by: { login: "github-actions[bot]" },
    merge_commit_sha: mergeSha
  };
  const files = [{ filename: "packages/agents/src/scenarioRunner.ts" }];

  assert.equal(
    assertTrustedMergedAgentPull(merged, config, {
      files,
      sourceIssue: value.sourceIssue,
      closingReferences: value.closingReferences
    }).sourceIssue,
    17
  );
  assert.throws(
    () =>
      assertTrustedMergedAgentPull(
        { ...merged, merged_by: { login: "someone" } },
        config,
        { files, sourceIssue: value.sourceIssue, closingReferences: value.closingReferences }
      ),
    /not a trusted agent PR/
  );
  assert.throws(
    () =>
      assertTrustedMergedAgentPull(merged, config, {
        files,
        sourceIssue: value.sourceIssue,
        closingReferences: [{ number: 17, url: "https://github.com/other/repo/issues/17" }]
      }),
    /source issue does not match/
  );
  assert.deepEqual(trustedClosingIssueNumbers(value.closingReferences, config), [17]);
});

test("stale base recovery never reuses gates when the authorized head does not advance", async () => {
  const value = fixture();
  value.pull.mergeable_state = "behind";
  const commands = [];

  await assert.rejects(
    recoverStaleBase(
      {
        config,
        prNumber: 18,
        pull: value.pull,
        decision: evaluate(value),
        baseState: { stale: true, baseHead: baseSha }
      },
      {
        runCommand: (command, args) => commands.push([command, args]),
        getPull: () => value.pull,
        hasAncestor: () => false,
        wait: () => Promise.resolve()
      }
    ),
    /stale-base update did not produce a new PR head/
  );

  assert.deepEqual(commands, [["gh", updateBranchArgs(18, config, sha)]]);
});

test("settlement never merges a stale branch without recovery", () => {
  const value = fixture();
  value.pull.mergeable_state = "behind";
  const commands = [];

  const outcome = settleAutomerge(
    { config, prNumber: 18, pull: value.pull, decision: evaluate(value) },
    { runCommand: (...args) => commands.push(args) }
  );

  assert.equal(isStaleBase(value.pull), true);
  assert.equal(outcome.code, 1);
  assert.match(outcome.result.message, /requires stale-base recovery/);
  assert.deepEqual(commands, []);
});

test("post-merge cleanup removes only workflow labels and closes the source issue", () => {
  const value = fixture();
  const decision = evaluate(value);
  decision.prLabels.push("agent:review", "priority:low");
  decision.sourceLabels.push("agent:triage", "priority:low");
  const harness = cleanupHarness(decision);

  const cleanup = closeAgentLoop(
    { config, prNumber: 18, decision },
    harness
  );

  assert.equal(cleanup.ok, true);
  assert.deepEqual(agentWorkflowLabels(config), [
    "agent:triage",
    "agent:implement",
    "agent:review",
    "agent:automerge",
    "agent:proof",
    "agent:blocked"
  ]);
  assert.deepEqual(harness.commands, [
    ["gh", removeLabelArgs(18, config, "agent:review")],
    ["gh", removeLabelArgs(18, config, "agent:automerge")],
    ["gh", removeLabelArgs(17, config, "agent:triage")],
    ["gh", removeLabelArgs(17, config, "agent:automerge")],
    ["gh", closeIssueArgs(17, config)]
  ]);
  assert.equal(harness.commands.some(([, args]) => args.includes("priority:low")), false);
});

test("cleanup failure reports a merged PR and still attempts loop closure", () => {
  const value = fixture();
  const decision = evaluate(value);
  const harness = cleanupHarness(decision, { failLabel: "agent:automerge" });

  const outcome = settleAutomerge(
    { config, prNumber: 18, pull: value.pull, decision },
    harness
  );

  assert.equal(outcome.code, 1);
  assert.equal(outcome.result.merged, true);
  assert.match(outcome.result.message, /merged PR #18, but loop cleanup failed/);
  assert.equal(outcome.result.cleanup.errors.length, 1);
  assert.equal(harness.commands[0][1].join(" "), nativeMergeArgs(18, config, sha).join(" "));
  assert.equal(
    harness.commands.filter(([, args]) => args.join(" ") === removeLabelArgs(18, config, "agent:automerge").join(" ")).length,
    9
  );
  assert.ok(harness.commands.some(([, args]) => args.join(" ") === closeIssueArgs(17, config).join(" ")));
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

test("GitHub canonical check-run URLs retain trusted Actions provenance", () => {
  const canonicalCheck = {
    ...check("quality"),
    details_url: "https://github.com/sandeepsalwan1/Vet/runs/87210913027",
  };
  const foreignCheck = {
    ...canonicalCheck,
    details_url: "https://github.com/attacker/repo/runs/87210913027",
  };
  const arbitraryRepoUrl = {
    ...canonicalCheck,
    details_url: "https://github.com/sandeepsalwan1/Vet/issues/15",
  };

  assert.equal(checkState([canonicalCheck], "quality", sha, config), "success");
  assert.equal(checkState([foreignCheck, arbitraryRepoUrl], "quality", sha, config), "missing");
});

test("automerge reads creator provenance from the direct statuses endpoint", () => {
  const source = readFileSync(
    new URL("./agent-automerge.mjs", import.meta.url),
    "utf8",
  );

  assert.match(source, /commits\/\$\{pull\.head\.sha\}\/statuses\?per_page=100/);
  assert.doesNotMatch(source, /commits\/\$\{pull\.head\.sha\}\/status`/);
  assert.equal(
    statusState(
      [{ ...status("agent-review"), creator: null }],
      "agent-review",
      config,
    ),
    "missing",
  );
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
  assert.equal(decision.staleRecoveryAllowed, false);
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
  assert.equal(result.staleRecoveryAllowed, false);
  assert.ok(result.blockers.includes("PR must use a same-repository branch"));
  assert.ok(result.blockers.includes("PR branch does not match implementation source issue"));
  assert.ok(result.blockers.includes("source issue blocked by label agent:blocked"));
});

test("zero-diff conflict recovery may refresh gates but cannot merge", () => {
  const value = fixture();
  value.pull.changed_files = 0;
  value.files = [];

  const result = evaluate(value);

  assert.equal(result.trustedPull, true);
  assert.equal(result.staleRecoveryAllowed, true);
  assert.equal(result.allowed, false);
  assert.ok(result.blockers.includes("agent PR has no effective changes"));
});

test("privileged automation changes cannot enter stale recovery", () => {
  const value = fixture({ files: [{ filename: ".github/workflows/ci.yml" }] });
  const result = evaluate(value);

  assert.equal(result.allowed, false);
  assert.equal(result.staleRecoveryAllowed, false);
  assert.ok(result.blockers.includes("agent PR changes privileged candidate paths"));
});

test("high-risk triage or a human question blocks automerge", () => {
  const value = fixture({ sourceComments: [triage({ risk: "high", humanQuestion: "Which behavior is intended?" })] });

  const result = evaluate(value);

  assert.equal(result.allowed, false);
  assert.equal(result.staleRecoveryAllowed, false);
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
