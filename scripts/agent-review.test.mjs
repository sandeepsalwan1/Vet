import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  MAX_REVIEW_DIFF_BYTES,
  MAX_REVIEW_REPAIR_ATTEMPTS,
  REVIEW_WORKFLOW_FAILURE_MARKER,
  assertReviewedHead,
  assertReviewDiffFits,
  blankLineAtEofPaths,
  buildReviewPrompt,
  classifyReviewWorkflowFailure,
  dispatchPullSecurity,
  markReviewWorkflowFailure,
  normalizeReviewPolicy,
  normalizeTrailingBlankLines,
  privilegedPatchPaths,
  requireManagedTriageComment,
  resolveSourceIssueNumber,
  reviewCycleDecision,
  reviewCycleLabelChanges,
  reviewFailureOwnedBlockedLabel,
  reviewLabelChanges,
  reviewPolicyOutcome,
  reviewReplayNextGate,
  summarizeRequiredChecks,
  validateReviewRemoteRecord,
  waitForRequiredChecks,
  validateReviewResult
} from "./agent-review.mjs";
import { implementationCommitMessage, issueSnapshotSha256 } from "./agent-lib.mjs";
import { emptyRepairLedger } from "./agent-repair-ledger.mjs";

const config = {
  repo: { owner: "sandeepsalwan1", name: "Vet", defaultBranch: "main" },
  labels: {
    proof: "agent:proof",
    automerge: "agent:automerge",
    blocked: "agent:blocked",
    priorityTrivial: "priority:trivial"
  },
  automerge: { requiredChecks: ["quality", "build"] },
  cost: { status: "agent-cost" },
  crabbox: { nonVisualProviders: ["vercel-sandbox", "hetzner"] },
  comments: { review: "<!-- agent-review:v1 -->" }
};

function review(overrides = {}) {
  return {
    bugsFound: [],
    fixesMade: [],
    checksRun: ["npm test"],
    remainingRisk: "low",
    proofNeeded: "none",
    mergeRecommendation: "ready",
    humanQuestion: "",
    unifiedDiff: "",
    ...overrides
  };
}

function implementationBody(sourceIssue = 42) {
  return `<!-- agent-implementation:v1 -->
Agent implementation metadata:
\`\`\`json
${JSON.stringify({
  sourceIssue,
  sourceLabels: ["agent:automerge"],
  automergeEligible: true,
  issueSnapshotSha256: "a".repeat(64)
})}
\`\`\``;
}

test("cached passing review resumes the correct final gate", () => {
  const metadata = {
    automergeEligible: true,
    sourceLabels: ["agent:automerge"],
  };
  assert.equal(
    reviewReplayNextGate({
      config,
      evaluation: { outcome: "ready" },
      metadata,
      pullLabels: [],
      sourceLabels: [],
    }),
    "no-mistakes",
  );
  const trivialMetadata = {
    ...metadata,
    sourceLabels: ["agent:automerge", "priority:trivial"],
  };
  assert.equal(
    reviewReplayNextGate({
      config,
      evaluation: { outcome: "ready" },
      metadata: trivialMetadata,
      pullLabels: ["priority:trivial"],
      sourceLabels: ["priority:trivial"],
    }),
    "automerge",
  );
  assert.equal(
    reviewReplayNextGate({
      config,
      evaluation: { outcome: "blocked" },
      metadata,
      pullLabels: [],
      sourceLabels: [],
    }),
    "",
  );
});

test("source issue metadata must exactly match the closing reference", () => {
  const pull = {
    body: implementationBody(42)
  };

  assert.equal(resolveSourceIssueNumber(pull, [{ number: 42 }], config), 42);
  assert.throws(
    () => resolveSourceIssueNumber(pull, [{ number: 17 }], config),
    /must exactly match implementation metadata/
  );
});

test("only the same-repository closing reference enters source authorization", () => {
  const pull = { body: implementationBody(17) };
  const references = [
    { number: 9, url: "https://github.com/example/Elsewhere/issues/9" },
    { number: 17, url: "https://github.com/sandeepsalwan1/Vet/issues/17" }
  ];

  assert.equal(resolveSourceIssueNumber(pull, references, config), 17);
});

test("review prompt contains sealed intent, addendum, CI state, and complete diff", () => {
  const diff = "diff --git a/example.js b/example.js\n+const fixed = true;";
  const intentCapsule = {
    sourceIssue: 17,
    title: "Fix the flow",
    acceptanceCriteria: ["The flow works."],
    intentDigest: "a".repeat(64)
  };
  const implementationAddendum = {
    version: 1,
    intentAddendum: {
      decisions: ["Reused the flow module."],
      assumptions: [],
      scopeClarifications: [],
      verificationDecisions: ["Ran the focused test."],
      unresolvedQuestions: []
    },
    digest: "b".repeat(64)
  };
  const prompt = buildReviewPrompt({
    template: "Review policy",
    pull: {
      number: 8,
      title: "Agent change",
      body: "Closes #17",
      head: { ref: "agent/issue-17-change", sha: "abc123" },
      base: { ref: "main" }
    },
    pullIssue: { labels: [{ name: "agent:review" }] },
    intentCapsule,
    implementationAddendum,
    repairLedger: emptyRepairLedger(intentCapsule.intentDigest),
    ciChecks: [
      { name: "quality", state: "success", detailsUrl: "https://github.com/sandeepsalwan1/Vet/actions/runs/1" },
      { name: "build", state: "failure", detailsUrl: "https://github.com/sandeepsalwan1/Vet/actions/runs/2" }
    ],
    diff
  });

  assert.match(prompt, /## Sealed Intent Capsule/);
  assert.match(prompt, /Fix the flow/);
  assert.match(prompt, /Reused the flow module/);
  assert.match(prompt, /quality: success/);
  assert.match(prompt, /build: failure/);
  assert.match(prompt, /build: `npm run build`/);
  assert.ok(prompt.includes(diff));
});

test("required check summaries use the newest exact-head GitHub Actions result", () => {
  const head = "a".repeat(40);
  const checks = summarizeRequiredChecks(config, head, [
    {
      name: "quality",
      head_sha: head,
      status: "completed",
      conclusion: "failure",
      started_at: "2026-07-17T00:00:00Z",
      details_url: "https://github.com/sandeepsalwan1/Vet/actions/runs/1",
      app: { slug: "github-actions" }
    },
    {
      name: "quality",
      head_sha: head,
      status: "completed",
      conclusion: "success",
      started_at: "2026-07-17T00:01:00Z",
      details_url: "https://github.com/sandeepsalwan1/Vet/actions/runs/2/job/20",
      app: { slug: "github-actions" }
    },
    {
      name: "quality",
      head_sha: head,
      status: "completed",
      conclusion: "failure",
      started_at: "2026-07-17T00:02:00Z",
      details_url: "https://github.com/sandeepsalwan1/Vet/actions/runs/2evil",
      app: { slug: "github-actions" }
    },
    {
      name: "build",
      head_sha: head,
      status: "in_progress",
      conclusion: null,
      started_at: "2026-07-17T00:01:00Z",
      details_url: "https://github.com/sandeepsalwan1/Vet/actions/runs/3",
      app: { slug: "github-actions" }
    }
  ]);

  assert.deepEqual(checks.map(({ name, state }) => ({ name, state })), [
    { name: "quality", state: "success" },
    { name: "build", state: "in_progress" }
  ]);
});

test("deterministic whitespace repair recognizes only extra blank lines at EOF", () => {
  const output = [
    "README.md:78: new blank line at EOF.",
    "src/example.ts:9: trailing whitespace.",
    "README.md:79: new blank line at EOF."
  ].join("\n");

  assert.deepEqual(blankLineAtEofPaths(output), ["README.md"]);
  assert.equal(normalizeTrailingBlankLines("hello\n\n"), "hello\n");
  assert.equal(normalizeTrailingBlankLines("hello\r\n\r\n"), "hello\r\n");
  assert.equal(normalizeTrailingBlankLines("hello\n"), "hello\n");
});

test("nonterminal CI times out without consuming a review repair attempt", async () => {
  await assert.rejects(
    waitForRequiredChecks(config, 20, "a".repeat(40), {
      fetchSnapshot: () => ({ pull: { head: { sha: "a".repeat(40) } } }),
      fetchChecks: () => [
        { name: "quality", state: "in_progress" },
        { name: "build", state: "missing" },
      ],
      maxAttempts: 1,
      wait: async () => {},
    }),
    /required exact-head CI did not reach a terminal state/,
  );
});

test("missing managed triage context blocks prompt construction", () => {
  assert.throws(
    () => requireManagedTriageComment([], "<!-- agent-triage:v1 -->", 17),
    (error) => error.code === 1 && /no managed triage context/.test(error.message)
  );
});

test("managed triage rejects marker squatters and accepts the repo owner", () => {
  const marker = "<!-- agent-triage:v1 -->";
  const squatter = { id: 2, body: `${marker}\nspoof`, user: { login: "someone" } };
  const owner = { id: 1, body: `${marker}\ntrusted`, user: { login: "sandeepsalwan1" } };

  assert.equal(requireManagedTriageComment([squatter, owner], marker, 17, "sandeepsalwan1"), owner);
  assert.throws(
    () => requireManagedTriageComment([squatter], marker, 17, "sandeepsalwan1"),
    /no managed triage context/
  );
});

test("review patches cannot change automation control-plane files", () => {
  assert.deepEqual(
    privilegedPatchPaths([
      "src/safe.ts",
      "scripts/agent-review.mjs",
      "scripts/agent-review.test.mjs",
      "scripts/agent-new-control-plane.js",
      ".no-mistakes.yaml",
      "packages/agents/AGENTS.md",
      "packages/widget/package.json",
      ".agents/skills/reviewer/SKILL.md"
    ]),
    [
      "scripts/agent-review.mjs",
      "scripts/agent-review.test.mjs",
      "scripts/agent-new-control-plane.js",
      ".no-mistakes.yaml",
      "packages/agents/AGENTS.md",
      "packages/widget/package.json",
      ".agents/skills/reviewer/SKILL.md"
    ]
  );
});

test("review result is bound to the exact generated head", () => {
  const pull = { head: { sha: "reviewed123" } };

  assert.equal(assertReviewedHead(pull, "reviewed123"), "reviewed123");
  assert.throws(() => assertReviewedHead(pull, "newer456"), /head changed after agent review generation/);
  assert.throws(() => assertReviewedHead(pull, ""), /missing reviewed head SHA/);
});

test("review provenance reports the actual validated Crabbox provider and lease", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "vet-review-provenance-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "record.json");
  writeFileSync(path, JSON.stringify({
    ok: true,
    attempted: true,
    lane: "reviewRemote",
    provider: "vercel-sandbox",
    leaseId: "vsbx_review_123",
    reason: "",
    timing: {
      provider: "vercel-sandbox",
      leaseId: "vsbx_review_123",
      totalMs: 1234,
      exitCode: 0,
    },
  }));

  assert.deepEqual(validateReviewRemoteRecord(config, path), {
    provider: "vercel-sandbox",
    leaseId: "vsbx_review_123",
    totalMs: 1234,
  });
  writeFileSync(path, JSON.stringify({
    ok: true,
    attempted: true,
    lane: "reviewRemote",
    provider: "github-actions",
    leaseId: "fake",
    reason: "",
    timing: {
      provider: "github-actions",
      leaseId: "fake",
      totalMs: 1,
      exitCode: 0,
    },
  }));
  assert.throws(
    () => validateReviewRemoteRecord(config, path),
    /provenance is invalid/,
  );
});

function trustedSecurityDispatchFixture() {
  const sourceIssue = {
    number: 42,
    state: "open",
    title: "Fix flow",
    body: "Do the work"
  };
  const metadata = {
    sourceIssue: sourceIssue.number,
    sourceLabels: ["agent:automerge"],
    automergeEligible: true,
    issueSnapshotSha256: issueSnapshotSha256(sourceIssue)
  };
  const pull = {
    number: 8,
    state: "open",
    merged: false,
    merged_at: null,
    changed_files: 1,
    user: { login: "github-actions[bot]" },
    body: `<!-- agent-implementation:v1 -->\nAgent implementation metadata:\n\`\`\`json\n${JSON.stringify(metadata)}\n\`\`\``,
    head: {
      ref: "agent/issue-42-fix-flow",
      sha: "b".repeat(40),
      repo: { full_name: "sandeepsalwan1/Vet" }
    },
    base: {
      ref: "main",
      repo: { full_name: "sandeepsalwan1/Vet" }
    }
  };
  return {
    commitMessage: implementationCommitMessage("chore: implement agent issue #42", metadata),
    pull,
    sourceIssue,
    snapshot: {
      pull,
      files: [{ filename: "src/safe.ts" }],
      trust: { sourceIssue: sourceIssue.number }
    }
  };
}

test("trusted security dispatch uses the main workflow for the validated SHA", () => {
  const fixture = trustedSecurityDispatchFixture();
  const calls = [];
  const result = dispatchPullSecurity(config, 8, fixture.pull.head.sha, {
    fetchSnapshot: () => fixture.snapshot,
    fetchSourceIssue: () => fixture.sourceIssue,
    ghApiJson: () => [{ commit: { message: fixture.commitMessage } }],
    getWorkflowRuns: () => [],
    dispatchWorkflow: (...args) => {
      calls.push(args);
      return { ok: true };
    }
  });

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(calls, [
    [
      config,
      "codeql.yml",
      {
        "candidate-ref": `refs/heads/${fixture.pull.head.ref}`,
        "candidate-sha": fixture.pull.head.sha
      },
      false,
      config.repo.defaultBranch
    ]
  ]);
});

test("trusted security dispatch reuses an active or successful exact run", () => {
  const fixture = trustedSecurityDispatchFixture();
  let dispatched = false;
  const result = dispatchPullSecurity(config, 8, fixture.pull.head.sha, {
    fetchSnapshot: () => fixture.snapshot,
    fetchSourceIssue: () => fixture.sourceIssue,
    ghApiJson: () => [{ commit: { message: fixture.commitMessage } }],
    getWorkflowRuns: () => [
      {
        id: 99,
        event: "workflow_dispatch",
        display_title: `CodeQL ${fixture.pull.head.sha}`,
        status: "in_progress",
        conclusion: null,
      },
    ],
    dispatchWorkflow: () => {
      dispatched = true;
    },
  });

  assert.equal(dispatched, false);
  assert.deepEqual(result, {
    ok: true,
    skipped: true,
    reason: "exact security run already active or successful",
    runId: 99,
  });
});

test("trusted security dispatch retries a failed exact run", () => {
  const fixture = trustedSecurityDispatchFixture();
  let dispatched = false;
  dispatchPullSecurity(config, 8, fixture.pull.head.sha, {
    fetchSnapshot: () => fixture.snapshot,
    fetchSourceIssue: () => fixture.sourceIssue,
    ghApiJson: () => [{ commit: { message: fixture.commitMessage } }],
    getWorkflowRuns: () => [
      {
        event: "workflow_dispatch",
        display_title: `CodeQL ${fixture.pull.head.sha}`,
        status: "completed",
        conclusion: "failure",
      },
    ],
    dispatchWorkflow: () => {
      dispatched = true;
      return { ok: true };
    },
  });

  assert.equal(dispatched, true);
});

test("trusted security dispatch rejects stale or changed authorization", () => {
  const fixture = trustedSecurityDispatchFixture();
  let dispatched = false;
  const dependencies = {
    fetchSnapshot: () => fixture.snapshot,
    fetchSourceIssue: () => fixture.sourceIssue,
    ghApiJson: () => [{ commit: { message: fixture.commitMessage } }],
    getWorkflowRuns: () => [],
    dispatchWorkflow: () => {
      dispatched = true;
    }
  };

  assert.throws(
    () => dispatchPullSecurity(config, 8, "c".repeat(40), dependencies),
    /head changed after agent review generation/
  );
  assert.throws(
    () =>
      dispatchPullSecurity(config, 8, fixture.pull.head.sha, {
        ...dependencies,
        fetchSourceIssue: () => ({ ...fixture.sourceIssue, body: "changed" })
      }),
    /source issue changed after trusted triage/
  );
  assert.throws(
    () =>
      dispatchPullSecurity(config, 8, fixture.pull.head.sha, {
        ...dependencies,
        fetchSnapshot: () => ({
          ...fixture.snapshot,
          files: [{ filename: ".github/workflows/codeql.yml" }]
        })
      }),
    /privileged candidate paths/
  );
  assert.equal(dispatched, false);
});

test("review workflow failures publish one actionable owned blocker", () => {
  const fixture = trustedSecurityDispatchFixture();
  const failure = classifyReviewWorkflowFailure(
    "Quota exceeded. Check your plan and billing details.",
  );
  const result = markReviewWorkflowFailure(
    config,
    8,
    fixture.pull.head.sha,
    failure,
    true,
    {
      fetchSnapshot: () => fixture.snapshot,
      fetchSourceIssue: () => fixture.sourceIssue,
      fetchPullIssue: () => ({ labels: [] }),
      fetchComments: () => [],
      ghApiJson: () => [{ commit: { message: fixture.commitMessage } }],
    },
  );

  assert.equal(result.blocker.kind, "model-quota");
  assert.equal(result.ownsBlockedLabel, true);
  assert.match(result.comment.body, /OpenAI API project quota is exhausted/);
  assert.match(result.comment.body, /"ownsBlockedLabel": true/);
  assert.deepEqual(result.labels.added, [config.labels.blocked]);
  assert.deepEqual(result.labels.removed, [config.labels.automerge]);
  assert.equal(result.costStatus.context, "agent-cost");
  assert.equal(result.costStatus.state, "failure");
});

test("repeated review failures retain ownership of the blocker label", () => {
  const fixture = trustedSecurityDispatchFixture();
  const result = markReviewWorkflowFailure(
    config,
    8,
    fixture.pull.head.sha,
    classifyReviewWorkflowFailure("Quota exceeded."),
    true,
    {
      fetchSnapshot: () => fixture.snapshot,
      fetchSourceIssue: () => fixture.sourceIssue,
      fetchPullIssue: () => ({ labels: [{ name: config.labels.blocked }] }),
      fetchComments: () => [
        {
          id: 1,
          user: { login: "github-actions[bot]" },
          body: `${config.comments.review}\n${REVIEW_WORKFLOW_FAILURE_MARKER}\n{"ownsBlockedLabel": true}`,
        },
      ],
      ghApiJson: () => [{ commit: { message: fixture.commitMessage } }],
    },
  );

  assert.equal(result.ownsBlockedLabel, true);
  assert.match(result.comment.body, /"ownsBlockedLabel": true/);
});

test("review recovery removes only the blocker label owned by review failure", () => {
  const owned = [
    {
      id: 1,
      user: { login: "github-actions[bot]" },
      body: `${config.comments.review}\n${REVIEW_WORKFLOW_FAILURE_MARKER}\n{"ownsBlockedLabel": true}`,
    },
  ];
  const unowned = [
    {
      id: 2,
      user: { login: "github-actions[bot]" },
      body: `${config.comments.review}\n${REVIEW_WORKFLOW_FAILURE_MARKER}\n{"ownsBlockedLabel": false}`,
    },
  ];

  assert.equal(reviewFailureOwnedBlockedLabel(owned, config), true);
  assert.equal(reviewFailureOwnedBlockedLabel(unowned, config), false);
  assert.equal(
    classifyReviewWorkflowFailure("provider returned status code: 429").kind,
    "model-capacity",
  );
});

test("oversized diff blocks instead of truncating", () => {
  assert.throws(
    () => assertReviewDiffFits("x".repeat(MAX_REVIEW_DIFF_BYTES + 1)),
    (error) => error.code === 1 && /too large for complete automated review/.test(error.message)
  );
});

test("ready-human-review with a real question is technically successful but merge-blocking", () => {
  const result = reviewPolicyOutcome(
    review({
      mergeRecommendation: "ready-human-review",
      humanQuestion: "Choose the product behavior?"
    })
  );

  assert.equal(result.technicalSuccess, true);
  assert.equal(result.manualBlock, true);
  assert.equal(result.statusState, "failure");
});

test("low-risk ready-human-review without a question continues automatically", () => {
  const normalized = normalizeReviewPolicy(
    review({
      mergeRecommendation: "ready-human-review",
      proofNeeded: "GIF"
    })
  );
  const decision = reviewCycleDecision(normalized, {
    repairAttempt: 0,
    patchApplied: false,
    ciPassed: true
  });

  assert.equal(normalized.mergeRecommendation, "ready");
  assert.equal(decision.state, "ready");
  assert.equal(decision.continueToNoMistakes, true);
});

test("high risk ready result is normalized to human review", () => {
  const normalized = normalizeReviewPolicy(review({ remainingRisk: "high" }));

  assert.equal(normalized.mergeRecommendation, "ready-human-review");
  assert.ok(normalized.humanQuestion);
});

test("passing review does not clear a shared blocked label", () => {
  const changes = reviewLabelChanges(config, review());

  assert.equal(changes.technicalSuccess, true);
  assert.equal(changes.manualBlock, false);
  assert.ok(!changes.remove.includes(config.labels.blocked));
});

test("human review adds blocked and removes automerge", () => {
  const changes = reviewLabelChanges(
    config,
    review({
      mergeRecommendation: "ready-human-review",
      humanQuestion: "Choose the product behavior?"
    })
  );

  assert.ok(changes.add.includes(config.labels.blocked));
  assert.ok(changes.remove.includes(config.labels.automerge));
});

test("only material review patches continue the shared repair cycle", () => {
  const technical = reviewCycleDecision(
    review({ bugsFound: ["Fix formatting"], mergeRecommendation: "blocked" }),
    { repairAttempt: 0, patchApplied: false, ciPassed: true }
  );
  const patched = reviewCycleDecision(review(), {
    repairAttempt: 1,
    patchApplied: true,
    ciPassed: true
  });
  const failedCi = reviewCycleDecision(review(), {
    repairAttempt: 0,
    patchApplied: false,
    ciPassed: false
  });
  const exhausted = reviewCycleDecision(
    review({ bugsFound: ["Still broken"], mergeRecommendation: "blocked" }),
    {
      repairAttempt: MAX_REVIEW_REPAIR_ATTEMPTS,
      patchApplied: false,
      patchRejectedByBudget: true,
      ciPassed: true
    }
  );
  const human = reviewCycleDecision(
    review({
      mergeRecommendation: "ready-human-review",
      humanQuestion: "Choose the product behavior?"
    }),
    { repairAttempt: 0, patchApplied: false, ciPassed: true }
  );

  assert.equal(technical.state, "unchanged-blocked");
  assert.equal(technical.nextAttempt, null);
  assert.equal(patched.state, "retry");
  assert.equal(patched.nextAttempt, 1);
  assert.equal(failedCi.state, "deterministic-blocked");
  assert.equal(exhausted.state, "repair-exhausted");
  assert.equal(human.state, "human-blocked");
});

test("a clean exact-head review continues to no-mistakes", () => {
  const decision = reviewCycleDecision(review(), {
    repairAttempt: 1,
    patchApplied: false,
    ciPassed: true
  });
  const labels = reviewCycleLabelChanges(config, review(), decision, {
    automergeEligible: true
  });

  assert.equal(decision.state, "ready");
  assert.equal(decision.continueToNoMistakes, true);
  assert.ok(labels.add.includes(config.labels.automerge));
  assert.ok(!labels.remove.includes(config.labels.blocked));
});

test("unchanged and exhausted repair cycles both fail closed", () => {
  const unchanged = reviewCycleDecision(
    review({ mergeRecommendation: "blocked", bugsFound: ["Fix me"] }),
    { repairAttempt: 0, patchApplied: false, ciPassed: true }
  );
  const unchangedLabels = reviewCycleLabelChanges(config, review(), unchanged, {
    automergeEligible: true
  });
  const exhausted = reviewCycleDecision(
    review({ mergeRecommendation: "blocked", bugsFound: ["Fix me"] }),
    {
      repairAttempt: MAX_REVIEW_REPAIR_ATTEMPTS,
      patchApplied: false,
      patchRejectedByBudget: true,
      ciPassed: true
    }
  );
  const exhaustedLabels = reviewCycleLabelChanges(config, review(), exhausted, {
    automergeEligible: true
  });

  assert.ok(unchangedLabels.add.includes(config.labels.blocked));
  assert.ok(unchangedLabels.remove.includes(config.labels.automerge));
  assert.ok(exhaustedLabels.add.includes(config.labels.blocked));
  assert.ok(exhaustedLabels.remove.includes(config.labels.automerge));
});

test("review schema and unresolved questions fail closed", () => {
  assert.throws(
    () => validateReviewResult(review({ remainingRisk: "unknown" })),
    /agent review result is invalid/
  );
  assert.throws(
    () => validateReviewResult({ ...review(), unexpected: true }),
    /agent review result is invalid/
  );
  const normalized = normalizeReviewPolicy(review({ humanQuestion: "Choose behavior?" }));
  assert.equal(normalized.mergeRecommendation, "ready-human-review");
});

test("review fixes stay credential-free and bound to the prepared head", () => {
  const workflow = readFileSync(new URL("../.github/workflows/agent-review.yml", import.meta.url), "utf8");
  const reviewScript = readFileSync(new URL("./agent-review.mjs", import.meta.url), "utf8");
  const ciWorkflow = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
  const codeqlWorkflow = readFileSync(new URL("../.github/workflows/codeql.yml", import.meta.url), "utf8");
  const prompt = readFileSync(new URL("../.agent/prompts/review.md", import.meta.url), "utf8");
  const prepare = workflow.match(/\n  prepare-review:\n([\s\S]*?)\n  generate-review:/)?.[1] ?? "";
  const generate = workflow.match(/\n  generate-review:\n([\s\S]*?)\n  apply-review:/)?.[1] ?? "";
  const apply = workflow.match(/\n  apply-review:\n([\s\S]*?)\n  dispatch-no-mistakes:/)?.[1] ?? "";
  const noMistakes = workflow.match(/\n  dispatch-no-mistakes:\n([\s\S]*?)\n  report-review-failure:/)?.[1] ?? "";
  const failure = workflow.match(/\n  report-review-failure:\n([\s\S]*)$/)?.[1] ?? "";

  assert.match(prepare, /statuses: write/);
  assert.match(prepare, /actions: write/);
  assert.match(prepare, /checks: read/);
  assert.match(prepare, /BACKEND_LANE: \$\{\{ inputs\.repair-attempt > 0 && 'no-mistakes' \|\| 'review' \}\}/);
  assert.match(prepare, /--validate-backend --lane "\$BACKEND_LANE" --json/);
  assert.match(prepare, /ref: main\n          persist-credentials: false/);
  assert.match(prepare, /--expected-head-sha "\$REVIEWED_HEAD_SHA"/);
  assert.match(prepare, /-f state=pending/);
  assert.match(prepare, /--dispatch-pr-security/);
  assert.match(prepare, /reviewed-base-sha: \$\{\{ steps\.mark-pending\.outputs\.base-sha \}\}/);
  assert.match(reviewScript, /dispatchPullSecurity/);
  assert.match(reviewScript, /allowEmptyFiles: true/);
  assert.match(reviewScript, /implementationCommitMessage/);
  assert.match(reviewScript, /cycle\.state === "ready" && proofRequested && !dryRun/);
  assert.match(codeqlWorkflow, /workflow_dispatch:/);
  assert.match(codeqlWorkflow, /candidate-sha:/);
  assert.match(codeqlWorkflow, /candidate-ref:/);
  assert.match(codeqlWorkflow, /ref: \$\{\{ inputs\.candidate-sha \|\| github\.sha \}\}/);
  assert.match(codeqlWorkflow, /sha: \$\{\{ inputs\.candidate-sha \}\}/);
  assert.match(ciWorkflow, /github\.event_name == 'pull_request' \|\| github\.event_name == 'workflow_dispatch'/);
  assert.match(ciWorkflow, /base-ref:/);
  assert.match(ciWorkflow, /head-ref:/);
  assert.match(
    ciWorkflow,
    /publish-candidate-checks:\n[\s\S]*?if: always\(\) && github\.event_name == 'workflow_dispatch' && inputs\.main-sha == ''/
  );
  assert.match(
    ciWorkflow,
    /dispatch-automerge:\n[\s\S]*?if: always\(\) && github\.event_name == 'workflow_dispatch' && inputs\.main-sha == ''/
  );

  assert.match(generate, /needs: prepare-review/);
  assert.match(generate, /ref: \$\{\{ needs\.prepare-review\.outputs\.reviewed-head-sha \}\}/);
  assert.match(generate, /ref: \$\{\{ github\.workflow_sha \}\}[\s\S]*?path: trusted/);
  assert.match(generate, /permissions:\n      contents: read\n      pull-requests: read\n      issues: read/);
  assert.doesNotMatch(generate, /(?:actions|contents|issues|pull-requests|statuses): write/);
  assert.match(generate, /uses: \.\/trusted\/\.github\/actions\/setup-crabbox/);
  assert.match(generate, /node trusted\/scripts\/agent-crabbox-run\.mjs/);
  assert.match(generate, /export AGENT_TARGET_ROOT="\$PWD"/);
  assert.match(generate, /node \.\.\/trusted\/scripts\/agent-skill-discovery\.mjs/);
  assert.match(generate, /node \.\.\/trusted\/scripts\/agent-worker\.mjs/);
  assert.match(generate, /node \.\.\/trusted\/scripts\/agent-review\.mjs/);
  assert.match(generate, /--lane reviewRemote/);
  assert.match(generate, /--stage-input-lane reviewRemote/);
  assert.match(
    generate,
    /--prepare-delegated-workspace "\$RUNNER_TEMP\/agent-review-workspace"/
  );
  assert.match(generate, /--restore-input-lane reviewRemote/);
  assert.match(generate, /name: Capture exact review tree/);
  assert.match(generate, /--seed-exact-repository/);
  assert.match(
    generate,
    /--expected-tree "\$\{\{ steps\.candidate-tree\.outputs\.tree \}\}"/
  );
  assert.match(generate, /REMOTE_COMMAND: >-\n\s+set -e;/);
  assert.ok(
    generate.indexOf("--restore-input-lane reviewRemote") <
      generate.indexOf("cd candidate")
  );
  assert.match(generate, /--sandbox danger-full-access/);
  assert.match(generate, /--schema \.agent-output\/review\.schema\.json/);
  assert.match(
    generate,
    /--workdir "\$RUNNER_TEMP\/agent-review-workspace"/
  );
  assert.match(
    generate,
    /--delegated-workdir "\$RUNNER_TEMP\/agent-review-workspace\/candidate"/
  );
  assert.match(generate, /--remote-harness trusted\/scripts\/agent-crabbox-run\.mjs/);
  assert.match(
    generate,
    /--record-file "\$RUNNER_TEMP\/agent-review-workspace\/candidate\/\.agent-output\/review-remote\.json"/
  );
  assert.doesNotMatch(generate, /openai\/codex-action/);
  assert.match(generate, /--create-patch \.agent-output\/review\.patch/);
  assert.match(
    generate,
    /path: \|\n\s+\$\{\{ runner\.temp \}\}\/agent-review-workspace\/candidate\/\.agent-output\/review\.json\n\s+\$\{\{ runner\.temp \}\}\/agent-review-workspace\/candidate\/\.agent-output\/review\.patch\n\s+\$\{\{ runner\.temp \}\}\/agent-review-workspace\/candidate\/\.agent-output\/model-usage\.json\n\s+\$\{\{ runner\.temp \}\}\/agent-review-workspace\/candidate\/\.agent-output\/review-remote\.json/,
  );
  assert.match(generate, /--model "\$\{\{ needs\.prepare-review\.outputs\.backend-model \}\}"/);
  assert.match(generate, /--effort "\$\{\{ needs\.prepare-review\.outputs\.backend-effort \}\}"/);
  assert.match(generate, /@openai\/codex@0\.144\.1/);
  assert.match(prompt, /do not gate your recommendation on CI, proof, or no-mistakes status/);
  assert.match(prompt, /Apply every clearly safe, in-scope fix directly/);
  assert.match(prompt, /post-fix checkout/);
  assert.match(prompt, /every source-issue acceptance criterion into an explicit checklist/);
  assert.match(prompt, /one separate concrete verification in `checksRun` for every acceptance criterion/);
  assert.match(prompt, /literal text, line counts, blank lines, ordering, and file placement/);
  assert.match(prompt, /terminal newline is not an empty line/);

  assert.match(apply, /REVIEWED_HEAD_SHA: \$\{\{ needs\.prepare-review\.outputs\.reviewed-head-sha \}\}/);
  assert.match(apply, /AGENT_GITHUB_TOKEN: \$\{\{ secrets\.AGENT_GITHUB_TOKEN \}\}/);
  assert.match(apply, /--apply-patch \.agent-output\/review\.patch/);
  assert.match(apply, /--remote-record \.agent-output\/review-remote\.json/);
  assert.match(apply, /--repair-attempt "\$\{\{ inputs\.repair-attempt \}\}"/);
  assert.match(apply, /outputs:\n\s+next-gate: \$\{\{ steps\.apply\.outputs\.next-gate \}\}/);
  assert.match(apply, /id: apply/);
  assert.match(apply, /checks: read/);
  assert.match(apply, /ref: main\n          fetch-depth: 0\n          persist-credentials: false/);
  assert.match(reviewScript, /publisherEnvironment/);
  assert.match(noMistakes, /actions: write/);
  assert.match(noMistakes, /checks: read/);
  assert.match(noMistakes, /statuses: read/);
  assert.match(noMistakes, /gh workflow run agent-no-mistakes\.yml/);
  assert.match(noMistakes, /APPLIED_NEXT_GATE: \$\{\{ needs\.apply-review\.outputs\.next-gate \}\}/);
  assert.match(noMistakes, /REPLAY_NEXT_GATE: \$\{\{ needs\.prepare-review\.outputs\.replay-next-gate \}\}/);
  assert.match(noMistakes, /needs\.prepare-review\.outputs\.skip-model == 'true'/);
  assert.match(noMistakes, /NEXT_GATE="\$REPLAY_NEXT_GATE"/);
  assert.match(noMistakes, /case "\$NEXT_GATE" in/);
  assert.match(noMistakes, /gh workflow run agent-automerge\.yml/);
  assert.match(noMistakes, /--repo "\$GITHUB_REPOSITORY"/);
  assert.match(noMistakes, /--ref main/);
  assert.match(noMistakes, /-f pr-number="\$PR_NUMBER"/);
  assert.match(noMistakes, /-f expected-head-sha="\$head_sha"/);
  assert.match(noMistakes, /-f repair-attempt="\$\{\{ inputs\.repair-attempt \}\}"/);
  assert.match(noMistakes, /review_state/);
  assert.match(noMistakes, /commits\/\$head_sha\/statuses\?per_page=100/);
  assert.doesNotMatch(noMistakes, /commits\/\$head_sha\/status"/);
  assert.match(noMistakes, /required_checks=\(quality build scenarios audit dependency-review\)/);
  assert.match(noMistakes, /needs\.apply-review\.result == 'success'/);
  assert.doesNotMatch(noMistakes, /uses: \.\/\.github\/workflows\/agent-no-mistakes\.yml/);
  assert.match(failure, /REVIEWED_HEAD_SHA: \$\{\{ needs\.prepare-review\.outputs\.reviewed-head-sha \}\}/);
  assert.match(failure, /--mark-failed/);
  assert.match(failure, /--failure-evidence \.agent-output\/review-failure/);
  assert.match(failure, /review-remote\.json/);
  assert.match(failure, /agent-review-result-\$\{\{ inputs\.pr-number \}\}/);
  assert.match(failure, /--usage-file "\$usage_file"/);
  assert.ok(
    failure.indexOf("review-result/review-remote.json") <
      failure.indexOf("review-failure/review-remote.json")
  );
  assert.match(failure, /--terminal-failure/);
  assert.match(failure, /if \[ -n "\$backend_model" \]/);
  assert.match(failure, /if \[ -n "\$backend_effort" \]/);
  assert.doesNotMatch(failure, /pulls\/\$PR_NUMBER|--jq \.head\.sha/);
});
