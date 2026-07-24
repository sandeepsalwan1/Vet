import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  MAX_REVIEW_DIFF_BYTES,
  MAX_REVIEW_REPAIR_ATTEMPTS,
  assertReviewedHead,
  assertReviewDiffFits,
  blankLineAtEofPaths,
  buildReviewPrompt,
  dispatchPullSecurity,
  normalizeReviewPolicy,
  normalizeTrailingBlankLines,
  privilegedPatchPaths,
  requireManagedTriageComment,
  resolveSourceIssueNumber,
  reviewCycleDecision,
  reviewCycleLabelChanges,
  reviewLabelChanges,
  reviewPolicyOutcome,
  summarizeRequiredChecks,
  waitForRequiredChecks,
  validateReviewResult
} from "./agent-review.mjs";
import { implementationCommitMessage, issueSnapshotSha256 } from "./agent-lib.mjs";

const config = {
  repo: { owner: "sandeepsalwan1", name: "Vet", defaultBranch: "main" },
  labels: {
    proof: "agent:proof",
    automerge: "agent:automerge",
    blocked: "agent:blocked"
  },
  automerge: { requiredChecks: ["quality", "build"] }
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

test("review prompt contains source issue, managed triage, CI state, and complete diff", () => {
  const diff = "diff --git a/example.js b/example.js\n+const fixed = true;";
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
    pullComments: [{ id: 1, body: "PR comment" }],
    sourceIssue: {
      number: 17,
      title: "Fix the flow",
      body: "Source issue body",
      labels: [{ name: "agent:implement" }]
    },
    triageComment: { body: "<!-- agent-triage:v1 -->\nStructured triage context" },
    ciChecks: [
      { name: "quality", state: "success", detailsUrl: "https://github.com/sandeepsalwan1/Vet/actions/runs/1" },
      { name: "build", state: "failure", detailsUrl: "https://github.com/sandeepsalwan1/Vet/actions/runs/2" }
    ],
    diff
  });

  assert.match(prompt, /## Source Issue/);
  assert.match(prompt, /Fix the flow/);
  assert.match(prompt, /Structured triage context/);
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

test("trusted security dispatch rejects stale or changed authorization", () => {
  const fixture = trustedSecurityDispatchFixture();
  let dispatched = false;
  const dependencies = {
    fetchSnapshot: () => fixture.snapshot,
    fetchSourceIssue: () => fixture.sourceIssue,
    ghApiJson: () => [{ commit: { message: fixture.commitMessage } }],
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

test("technical review findings retry while real decisions block", () => {
  const technical = reviewCycleDecision(
    review({ bugsFound: ["Fix formatting"], mergeRecommendation: "blocked" }),
    { repairAttempt: 0, patchApplied: false, ciPassed: true }
  );
  const patched = reviewCycleDecision(review(), {
    repairAttempt: 0,
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

  assert.equal(technical.state, "retry");
  assert.equal(technical.nextAttempt, 1);
  assert.equal(patched.state, "retry");
  assert.equal(failedCi.state, "retry");
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

test("repair cycles preserve shared blockers while exhausted cycles fail closed", () => {
  const retry = reviewCycleDecision(
    review({ mergeRecommendation: "blocked", bugsFound: ["Fix me"] }),
    { repairAttempt: 0, patchApplied: false, ciPassed: true }
  );
  const retryLabels = reviewCycleLabelChanges(config, review(), retry, {
    automergeEligible: true
  });
  const exhausted = reviewCycleDecision(
    review({ mergeRecommendation: "blocked", bugsFound: ["Fix me"] }),
    {
      repairAttempt: MAX_REVIEW_REPAIR_ATTEMPTS,
      patchApplied: false,
      ciPassed: true
    }
  );
  const exhaustedLabels = reviewCycleLabelChanges(config, review(), exhausted, {
    automergeEligible: true
  });

  assert.ok(retryLabels.add.includes(config.labels.automerge));
  assert.ok(!retryLabels.remove.includes(config.labels.blocked));
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
  assert.match(generate, /permissions:\n      contents: read\n      pull-requests: read\n      issues: read/);
  assert.doesNotMatch(generate, /(?:actions|contents|issues|pull-requests|statuses): write/);
  assert.match(generate, /sandbox: workspace-write/);
  assert.match(generate, /--base-sha "\$\{\{ needs\.prepare-review\.outputs\.reviewed-base-sha \}\}"/);
  assert.match(generate, /--repair-whitespace/);
  assert.ok(generate.indexOf("--repair-whitespace") > generate.indexOf("Run Codex reviewer"));
  assert.ok(generate.indexOf("--repair-whitespace") < generate.indexOf("--create-patch"));
  assert.match(generate, /--create-patch \.agent-output\/review\.patch/);
  assert.match(generate, /path: \|\n\s+\.agent-output\/review\.json\n\s+\.agent-output\/review\.patch/);
  assert.match(generate, /model: \$\{\{ needs\.prepare-review\.outputs\.backend-model \}\}/);
  assert.match(generate, /effort: \$\{\{ needs\.prepare-review\.outputs\.backend-effort \}\}/);
  assert.match(generate, /codex-version: "0\.144\.1"/);
  assert.match(prompt, /do not gate your recommendation on CI, proof, or no-mistakes status/);
  assert.match(prompt, /Apply every clearly safe, in-scope fix directly/);
  assert.match(prompt, /post-fix checkout/);
  assert.match(prompt, /every source-issue acceptance criterion into an explicit checklist/);
  assert.match(prompt, /one separate concrete verification in `checksRun` for every acceptance criterion/);
  assert.match(prompt, /literal text, line counts, blank lines, ordering, and file placement/);
  assert.match(prompt, /terminal newline is not an empty line/);

  assert.match(apply, /REVIEWED_HEAD_SHA: \$\{\{ needs\.prepare-review\.outputs\.reviewed-head-sha \}\}/);
  assert.match(apply, /--apply-patch \.agent-output\/review\.patch/);
  assert.match(apply, /--repair-attempt "\$\{\{ inputs\.repair-attempt \}\}"/);
  assert.match(apply, /outputs:\n\s+next-gate: \$\{\{ steps\.apply\.outputs\.next-gate \}\}/);
  assert.match(apply, /id: apply/);
  assert.match(apply, /checks: read/);
  assert.match(apply, /ref: main\n          fetch-depth: 0\n          persist-credentials: false/);
  assert.match(noMistakes, /actions: write/);
  assert.match(noMistakes, /checks: read/);
  assert.match(noMistakes, /statuses: read/);
  assert.match(noMistakes, /gh workflow run agent-no-mistakes\.yml/);
  assert.match(noMistakes, /NEXT_GATE: \$\{\{ needs\.apply-review\.outputs\.next-gate \}\}/);
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
  assert.doesNotMatch(noMistakes, /needs\.apply-review\.result == 'failure'/);
  assert.doesNotMatch(noMistakes, /uses: \.\/\.github\/workflows\/agent-no-mistakes\.yml/);
  assert.match(failure, /REVIEWED_HEAD_SHA: \$\{\{ needs\.prepare-review\.outputs\.reviewed-head-sha \}\}/);
  assert.match(failure, /statuses\/\$REVIEWED_HEAD_SHA/);
  assert.doesNotMatch(failure, /pulls\/\$PR_NUMBER|--jq \.head\.sha/);
});
