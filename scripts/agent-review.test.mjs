import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_REVIEW_DIFF_BYTES,
  assertReviewDiffFits,
  buildReviewPrompt,
  normalizeReviewPolicy,
  requireManagedTriageComment,
  resolveSourceIssueNumber,
  reviewLabelChanges,
  reviewPolicyOutcome
} from "./agent-review.mjs";

const config = {
  repo: { owner: "sandeepsalwan1", name: "Vet" },
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

test("source issue metadata takes precedence over closing references", () => {
  const pull = {
    body: `<!-- agent-implementation:v1 -->
Agent implementation metadata:
\`\`\`json
{"sourceIssue":42}
\`\`\``
  };

  assert.equal(resolveSourceIssueNumber(pull, [{ number: 17 }], config), 42);
});

test("same-repository closing reference resolves source issue", () => {
  const pull = { body: "Closes #17" };
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
