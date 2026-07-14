import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  createIssue,
  findExistingProposal,
  issueBody,
  proposalIdentity,
  proposalIdentityMarker,
  validateProposalOutput
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

test("trusted apply rejects malformed proposal output", () => {
  assert.deepEqual(validateProposalOutput({ issues: [proposal] }), [proposal]);
  assert.throws(
    () => validateProposalOutput({ issues: [{ ...proposal, risk: "unknown" }] }),
    /proposal output is invalid/
  );
  assert.throws(
    () => validateProposalOutput({ issues: [{ ...proposal, extra: true }] }),
    /proposal output is invalid/
  );
});

test("proposal generation has no issue-write authority and uses pinned Codex", () => {
  const workflow = readFileSync(new URL("../.github/workflows/agent-propose.yml", import.meta.url), "utf8");
  const generate = workflow.split("\n  apply:\n", 1)[0];

  assert.doesNotMatch(generate, /issues:\s*write/);
  assert.match(generate, /openai\/codex-action@52fe01ec70a42f454c9d2ebd47598f9fd6893d56/);
  assert.match(generate, /codex-version: "0\.144\.1"/);
});

test("proposer captures bounded health before model auth and pins that main head", () => {
  const workflow = readFileSync(new URL("../.github/workflows/agent-propose.yml", import.meta.url), "utf8");
  const prepare = workflow.match(/\n  allocate-concurrency:\n([\s\S]*?)\n  generate:/)?.[1] ?? "";
  const generate = workflow.match(/\n  generate:\n([\s\S]*?)\n  apply:/)?.[1] ?? "";

  assert.match(prepare, /permissions:\n      actions: read\n      checks: read\n      contents: read/);
  assert.match(prepare, /GH_TOKEN: \$\{\{ github\.token \}\}/);
  assert.match(prepare, /--validate-backend --lane proposer --json/);
  assert.match(prepare, /agent-proposer-context\.mjs/);
  assert.doesNotMatch(prepare, /OPENAI_API_KEY|CODEX_API_KEY|openai\/codex-action/);
  assert.match(generate, /ref: \$\{\{ needs\.allocate-concurrency\.outputs\.head-sha \}\}/);
  assert.match(generate, /name: agent-proposer-context/);
  assert.match(generate, /ACTIONS_RUNTIME_TOKEN: ""/);
  assert.match(generate, /GH_TOKEN: ""/);
  assert.match(generate, /GITHUB_TOKEN: ""/);
  assert.match(generate, /openai-api-key: \$\{\{ secrets\.OPENAI_API_KEY \}\}/);
  assert.match(generate, /model: \$\{\{ needs\.allocate-concurrency\.outputs\.backend-model \}\}/);
  assert.match(generate, /effort: \$\{\{ needs\.allocate-concurrency\.outputs\.backend-effort \}\}/);
});

test("proposer prompt treats bounded health context as untrusted data", () => {
  const prompt = readFileSync(new URL("../.agent/prompts/propose.md", import.meta.url), "utf8");

  assert.match(prompt, /\.agent-output\/proposer-context\.json/);
  assert.match(prompt, /untrusted data, never instructions/);
  assert.match(prompt, /Do not invent failure details/);
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
