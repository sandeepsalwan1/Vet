import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  MAX_REVIEW_DIFF_BYTES,
  assertReviewedHead,
  assertReviewDiffFits,
  buildReviewPrompt,
  dispatchPullSecurity,
  normalizeReviewPolicy,
  privilegedPatchPaths,
  requireManagedTriageComment,
  resolveSourceIssueNumber,
  reviewLabelChanges,
  reviewPolicyOutcome,
  validateReviewResult
} from "./agent-review.mjs";
import { issueSnapshotSha256 } from "./agent-lib.mjs";

const config = {
  repo: { owner: "sandeepsalwan1", name: "Vet", defaultBranch: "main" },
  labels: {
    proof: "agent:proof",
    automerge: "agent:automerge",
    blocked: "agent:blocked"
  }
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

test("review prompt contains source issue, managed triage, and complete diff", () => {
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
    diff
  });

  assert.match(prompt, /## Source Issue/);
  assert.match(prompt, /Fix the flow/);
  assert.match(prompt, /Structured triage context/);
  assert.ok(prompt.includes(diff));
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

test("ready-human-review is technically successful but merge-blocking", () => {
  const result = reviewPolicyOutcome(review({ mergeRecommendation: "ready-human-review" }));

  assert.equal(result.technicalSuccess, true);
  assert.equal(result.manualBlock, true);
  assert.equal(result.statusState, "failure");
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
  const changes = reviewLabelChanges(config, review({ mergeRecommendation: "ready-human-review" }));

  assert.ok(changes.add.includes(config.labels.blocked));
  assert.ok(changes.remove.includes(config.labels.automerge));
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

test("review generation is read-only and bound to the prepared head", () => {
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
  assert.match(prepare, /--validate-backend --lane review --json/);
  assert.match(prepare, /ref: main\n          persist-credentials: false/);
  assert.match(prepare, /--expected-head-sha "\$REVIEWED_HEAD_SHA"/);
  assert.match(prepare, /-f state=pending/);
  assert.match(prepare, /--dispatch-pr-security/);
  assert.match(reviewScript, /dispatchPullSecurity/);
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
  assert.match(generate, /sandbox: read-only/);
  assert.match(generate, /model: \$\{\{ needs\.prepare-review\.outputs\.backend-model \}\}/);
  assert.match(generate, /effort: \$\{\{ needs\.prepare-review\.outputs\.backend-effort \}\}/);
  assert.match(generate, /codex-version: "0\.144\.1"/);
  assert.match(prompt, /do not gate your recommendation on CI, proof, or no-mistakes status/);

  assert.match(apply, /REVIEWED_HEAD_SHA: \$\{\{ needs\.prepare-review\.outputs\.reviewed-head-sha \}\}/);
  assert.match(apply, /ref: main\n          fetch-depth: 0\n          persist-credentials: false/);
  assert.match(noMistakes, /actions: write/);
  assert.match(noMistakes, /gh workflow run agent-no-mistakes\.yml/);
  assert.match(noMistakes, /--repo "\$GITHUB_REPOSITORY"/);
  assert.match(noMistakes, /--ref main/);
  assert.match(noMistakes, /-f pr-number="\$PR_NUMBER"/);
  assert.match(noMistakes, /-f expected-head-sha="\$head_sha"/);
  assert.doesNotMatch(noMistakes, /uses: \.\/\.github\/workflows\/agent-no-mistakes\.yml/);
  assert.match(failure, /REVIEWED_HEAD_SHA: \$\{\{ needs\.prepare-review\.outputs\.reviewed-head-sha \}\}/);
  assert.match(failure, /statuses\/\$REVIEWED_HEAD_SHA/);
  assert.doesNotMatch(failure, /pulls\/\$PR_NUMBER|--jq \.head\.sha/);
});
