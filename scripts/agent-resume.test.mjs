import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { evaluateResumeRequest, ownerFollowUpForComment } from "./agent-resume.mjs";

const config = {
  repo: { owner: "repo-owner" },
  labels: { blocked: "agent:blocked" },
  comments: { triage: "<!-- agent-triage:v1 -->" }
};

function decision(overrides = {}) {
  return {
    value: "medium",
    priority: "medium",
    risk: "medium",
    alignment: "yes",
    implementationScope: "Implement after the owner answers.",
    proofNeeded: "none",
    automationDecision: "blocked",
    humanQuestion: "Which behavior should be used?",
    issueSnapshotSha256: "a".repeat(64),
    ...overrides
  };
}

function triageComment(overrides = {}) {
  return {
    id: "TRIAGE_NODE",
    database_id: 100,
    body: `${config.comments.triage}\n## Agent Triage\n\nStructured decision:\n\`\`\`json\n${JSON.stringify(decision())}\n\`\`\`\n`,
    created_at: "2026-07-23T10:00:00Z",
    updated_at: "2026-07-23T10:00:00Z",
    user: { login: "github-actions[bot]" },
    ...overrides
  };
}

function ownerComment(overrides = {}) {
  return {
    id: "OWNER_NODE",
    database_id: 200,
    body: "You choose the safest reasonable behavior.",
    created_at: "2026-07-23T10:01:00Z",
    updated_at: "2026-07-23T10:01:00Z",
    user: { login: "repo-owner" },
    ...overrides
  };
}

function issue(overrides = {}) {
  return {
    number: 42,
    state: "open",
    labels: [{ name: "agent:blocked" }],
    ...overrides
  };
}

test("exact latest owner answer resumes a trusted triage question", () => {
  const result = evaluateResumeRequest(config, issue(), [triageComment(), ownerComment()], 200);

  assert.equal(result.shouldResume, true);
  assert.equal(result.followUp.id, 200);
  assert.equal(result.followUp.body, "You choose the safest reasonable behavior.");
  assert.match(result.followUp.sha256, /^[a-f0-9]{64}$/);
});

test("duplicate, stale, non-owner, unblocked, and pull-request replies do not resume", () => {
  const newest = ownerComment({
    id: "NEWEST_NODE",
    database_id: 201,
    body: "Use the current repo convention.",
    created_at: "2026-07-23T10:02:00Z",
    updated_at: "2026-07-23T10:02:00Z"
  });
  const cases = [
    evaluateResumeRequest(config, issue(), [triageComment(), ownerComment(), newest], 200),
    evaluateResumeRequest(
      config,
      issue(),
      [triageComment(), ownerComment({ user: { login: "someone-else" } })],
      200
    ),
    evaluateResumeRequest(config, issue({ labels: [] }), [triageComment(), ownerComment()], 200),
    evaluateResumeRequest(
      config,
      issue({ pull_request: { url: "https://api.github.test/pulls/42" } }),
      [triageComment(), ownerComment()],
      200
    ),
    evaluateResumeRequest(
      config,
      issue(),
      [
        triageComment({ updated_at: "2026-07-23T10:03:00Z" }),
        ownerComment()
      ],
      200
    )
  ];

  assert.ok(cases.every((result) => result.shouldResume === false));
});

test("only unresolved trusted triage decisions can resume", () => {
  const ready = triageComment({
    body: `${config.comments.triage}\n\`\`\`json\n${JSON.stringify(
      decision({ automationDecision: "implement", humanQuestion: "" })
    )}\n\`\`\`\n`
  });
  const malformed = triageComment({ body: `${config.comments.triage}\nstate: failed\n` });
  const blockedWithoutQuestion = triageComment({
    body: `${config.comments.triage}\n\`\`\`json\n${JSON.stringify(
      decision({ automationDecision: "blocked", humanQuestion: "" })
    )}\n\`\`\`\n`
  });

  assert.equal(evaluateResumeRequest(config, issue(), [ready, ownerComment()], 200).shouldResume, false);
  assert.equal(evaluateResumeRequest(config, issue(), [malformed, ownerComment()], 200).shouldResume, false);
  assert.equal(
    evaluateResumeRequest(config, issue(), [blockedWithoutQuestion, ownerComment()], 200).shouldResume,
    false
  );
});

test("owner follow-up lookup can revalidate an exact frozen reply", () => {
  const comment = ownerFollowUpForComment([ownerComment()], 200, "REPO-OWNER", false);

  assert.equal(comment.id, 200);
  assert.equal(comment.body, "You choose the safest reasonable behavior.");
});

test("resume workflow serializes per issue and calls zero-model triage", () => {
  const workflow = readFileSync(new URL("../.github/workflows/agent-resume.yml", import.meta.url), "utf8");

  assert.match(workflow, /group: agent-resume-\$\{\{ inputs\.issue-number \}\}/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /node scripts\/agent-resume\.mjs/);
  assert.match(
    workflow,
    /triage:\n[\s\S]*?permissions:\n      actions: write\n      contents: read\n      issues: write\n[\s\S]*?uses: \.\/\.github\/workflows\/agent-triage\.yml/
  );
  assert.match(workflow, /resume-comment-id:/);
  assert.doesNotMatch(workflow, /openai\/codex-action|model:|effort:/);
});
