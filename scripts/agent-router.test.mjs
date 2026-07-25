import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { routeEvent } from "./agent-router.mjs";

const config = {
  repo: {
    owner: "repo-owner"
  },
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

function commentEvent({
  author = "repo-owner",
  body = "Use the safest reasonable default.",
  blocked = true,
  pullRequest = false,
  number = 42,
  commentId = 9001
} = {}) {
  return {
    action: "created",
    issue: {
      number,
      labels: blocked ? [{ name: "agent:blocked" }] : [],
      ...(pullRequest ? { pull_request: { url: "https://api.github.test/pulls/42" } } : {})
    },
    comment: {
      id: commentId,
      body,
      user: { login: author }
    }
  };
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

test("repository owner answer routes a blocked issue through resume", () => {
  assert.deepEqual(routeEvent(commentEvent(), config), {
    lane: "resume",
    kind: "issue",
    issueNumber: 42,
    commentId: 9001,
    reason: "repository owner answered a blocked issue"
  });
});

test("non-owner, pull request, unblocked, and empty comments remain inert", () => {
  for (const event of [
    commentEvent({ author: "someone-else" }),
    commentEvent({ pullRequest: true }),
    commentEvent({ blocked: false }),
    commentEvent({ body: " " })
  ]) {
    assert.deepEqual(routeEvent(event, config), {
      lane: "none",
      reason: "comment does not qualify for blocked-issue resume"
    });
  }
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
  assert.match(workflow, /issue_comment:\n    types:\n      - created/);
  assert.match(workflow, /gh workflow run agent-resume\.yml[\s\S]*?-f comment-id="\$COMMENT_ID"/);
  assert.doesNotMatch(workflow, /      - opened/);
});
