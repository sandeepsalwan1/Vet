import assert from "node:assert/strict";
import test from "node:test";
import {
  createIssue,
  findExistingProposal,
  issueBody,
  proposalIdentity,
  proposalIdentityMarker
} from "./agent-propose.mjs";

const config = {
  repo: { owner: "owner", name: "repo" },
  labels: { triage: "agent:triage" },
  comments: { propose: "<!-- agent-propose:v1 -->" }
};

const proposal = {
  title: "Prevent duplicate intake tasks",
  body: "Detect an existing intake task before creating another one.",
  value: "high",
  priority: "medium",
  risk: "low",
  proof: "CI"
};

test("proposal identity is stable across harmless casing and whitespace changes", () => {
  const equivalent = {
    ...proposal,
    title: "  PREVENT   duplicate intake tasks ",
    body: "Detect an existing intake task before creating another one.\r\n"
  };

  assert.equal(proposalIdentity(equivalent), proposalIdentity(proposal));
  assert.match(proposalIdentityMarker(proposal), /^<!-- agent-proposal-id:v1:[a-f0-9]{64} -->$/);
});

test("issueBody records both the managed marker and stable proposal identity", () => {
  const body = issueBody(config, proposal);

  assert.match(body, /<!-- agent-propose:v1 -->/);
  assert.match(body, new RegExp(proposalIdentity(proposal)));
  assert.match(body, /"proof": "CI"/);
});

test("createIssue reuses an open proposal and restores its triage label", () => {
  const existing = {
    number: 12,
    state: "open",
    html_url: "https://example.test/issues/12",
    title: proposal.title,
    body: issueBody(config, proposal),
    labels: []
  };
  let labeled;
  const result = createIssue(config, proposal, [existing], false, {
    ghJson() {
      assert.fail("duplicate proposal must not call issue creation API");
    },
    addLabels(_config, number, labels) {
      labeled = { number, labels };
      return labels;
    }
  });

  assert.equal(findExistingProposal([existing], proposal).number, 12);
  assert.equal(result.action, "reused");
  assert.deepEqual(labeled, { number: 12, labels: ["agent:triage"] });
});

test("createIssue uses REST JSON and embeds the identity for a new proposal", () => {
  let payload;
  let apiArgs;
  const result = createIssue(config, proposal, [], false, {
    withTempJson(value, callback) {
      payload = value;
      return callback("/tmp/issue.json");
    },
    ghJson(args) {
      apiArgs = args;
      return { number: 13, html_url: "https://example.test/issues/13" };
    }
  });

  assert.deepEqual(apiArgs, ["api", "repos/owner/repo/issues", "-X", "POST", "--input", "/tmp/issue.json"]);
  assert.deepEqual(payload.labels, ["agent:triage"]);
  assert.match(payload.body, new RegExp(proposalIdentity(proposal)));
  assert.equal(result.action, "created");
});
