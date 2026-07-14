import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  assertTrustedAgentPull,
  composeEffectiveIntent,
  gateEnvironment,
  gateCommentBody,
  noMistakesCommentMarker,
  normalizeGateArtifact,
  parseAxiResult,
  sanitizedGateArtifact,
  selectTrustedManagedTriageComment,
  validatedHeadMatches,
} from "./agent-no-mistakes-gate.mjs";

const HEAD = "abcdef1234567890abcdef1234567890abcdef12";
const config = {
  repo: { owner: "owner", name: "repo", defaultBranch: "main" },
  comments: { gate: "<!-- agent-gate:v1 -->" },
};
const safeFiles = [{ filename: "apps/internal/src/app/page.tsx" }];

test("authenticated reviewer is read-only and all source changes fail closed", () => {
  const workflow = readFileSync(new URL("../.github/workflows/agent-no-mistakes.yml", import.meta.url), "utf8");
  const automergeWorkflow = readFileSync(new URL("../.github/workflows/agent-automerge.yml", import.meta.url), "utf8");
  const repoConfig = readFileSync(new URL("../.no-mistakes.yaml", import.meta.url), "utf8");
  const gate = readFileSync(new URL("./agent-no-mistakes-gate.mjs", import.meta.url), "utf8");

  assert.match(workflow, /- --sandbox\s+- read-only/);
  assert.match(workflow, /- 'approval_policy="never"'/);
  assert.doesNotMatch(workflow, /- --ask-for-approval/);
  assert.match(workflow, /codex exec \\\n\s+--sandbox read-only/);
  assert.match(workflow, /NM_TEST_START_DAEMON: "1"/);
  assert.match(workflow, /if: \$\{\{ always\(\) \}\}\n\s+continue-on-error: true\n[\s\S]*?run: no-mistakes daemon stop/);
  assert.doesNotMatch(workflow, /- workspace-write/);
  assert.doesNotMatch(workflow, /tar -C \/source/);
  assert.match(workflow, /npm rebuild --offline/);
  assert.match(workflow, /npm_config_nodedir=\/usr\/local/);
  assert.match(workflow, /--user "\$\(id -u\):\$\(id -g\)"/);
  assert.match(workflow, /src=\$PWD,dst=\/workspace,readonly/);
  assert.match(workflow, /--read-only/);
  assert.match(workflow, /gh workflow run agent-automerge\.yml/);
  assert.match(workflow, /--repo "\$GITHUB_REPOSITORY"/);
  assert.match(workflow, /-f pr-number="\$\{\{ inputs\.pr-number \}\}"/);
  assert.doesNotMatch(automergeWorkflow, /- Agent no-mistakes/);
  assert.equal([...repoConfig.matchAll(/tar --no-same-owner -xf/g)].length, 2);
  assert.match(gate, /"--untracked-files=all"/);
});

function trustedPull(overrides = {}) {
  return {
    number: 12,
    state: "open",
    changed_files: 1,
    body: `<!-- agent-implementation:v1 -->
Agent implementation metadata:
\`\`\`json
{"sourceIssue":42,"sourceLabels":["agent:automerge"],"automergeEligible":true,"issueSnapshotSha256":"${"a".repeat(64)}"}
\`\`\``,
    user: { login: "github-actions[bot]" },
    head: {
      ref: "agent/issue-42-fix-flow",
      sha: HEAD,
      repo: { full_name: "owner/repo" },
    },
    base: { ref: "main", repo: { full_name: "owner/repo" } },
    ...overrides,
  };
}

test("exact checks-passed outcome wins over misleading help prose", () => {
  const output = `run:
  id: run-1
  head: abcdef12
outcome: checks-passed
help[1]:
  If a later gate failed, rerun it`;
  const result = parseAxiResult(output, 0);

  assert.equal(result.status, "passed");
  assert.equal(result.outcome, "checks-passed");
  assert.equal(validatedHeadMatches(result, HEAD), true);
  assert.equal(validatedHeadMatches({ run: { head: "a" } }, HEAD), false);
  assert.equal(
    validatedHeadMatches({ run: { head: "ABCDEF12" } }, HEAD),
    false,
  );
});

test("effective intent includes caller policy, full source issue, and managed triage", () => {
  const intent = composeEffectiveIntent({
    callerIntent: "Require every automated gate to pass.",
    sourceIssue: {
      number: 42,
      title: "Preserve the complete user request",
      body: "Acceptance criterion one.\n\nAcceptance criterion two.",
    },
    triageComment: {
      body: "<!-- agent-triage:v1 -->\nRisk: medium\nDo not remove the fallback.",
    },
  });

  assert.match(intent, /Require every automated gate to pass/);
  assert.match(intent, /Authoritative source issue #42/);
  assert.match(
    intent,
    /Acceptance criterion one\.\n\nAcceptance criterion two\./,
  );
  assert.match(intent, /Do not remove the fallback/);
});

test("newest exact-prefix triage must come from Actions or the repo owner", () => {
  const marker = "<!-- agent-triage:v1 -->";
  const comments = [
    {
      id: 1,
      body: `${marker}\nold bot result`,
      user: { login: "github-actions[bot]" },
      updated_at: "2026-07-01T00:00:00Z",
    },
    {
      id: 2,
      body: `prefix ${marker}\nspoofed`,
      user: { login: "github-actions[bot]" },
      updated_at: "2026-07-04T00:00:00Z",
    },
    {
      id: 3,
      body: `${marker}\nunauthorized`,
      user: { login: "contributor" },
      updated_at: "2026-07-05T00:00:00Z",
    },
    {
      id: 4,
      body: `${marker}\nowner result`,
      user: { login: "OWNER" },
      updated_at: "2026-07-03T00:00:00Z",
    },
  ];

  assert.equal(
    selectTrustedManagedTriageComment(comments, marker, "owner")?.id,
    4,
  );
});

test("no-mistakes uses its own composite managed-comment marker", () => {
  assert.equal(
    noMistakesCommentMarker(config),
    "<!-- agent-gate:v1 -->\n<!-- agent-gate-no-mistakes:v1 -->",
  );
});

test("authenticated gate child receives no GitHub or Actions credentials", () => {
  const env = gateEnvironment({
    CODEX_API_KEY: "model-key",
    GH_TOKEN: "github-key",
    GITHUB_TOKEN: "github-key",
    ACTIONS_RUNTIME_TOKEN: "runtime-key",
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: "oidc-key",
    ACTIONS_ID_TOKEN_REQUEST_URL: "https://oidc.invalid",
    ACTIONS_CACHE_URL: "https://cache.invalid",
    ACTIONS_RESULTS_URL: "https://results.invalid",
    NM_TEST_START_DAEMON: "1",
  });

  assert.equal(env.CODEX_API_KEY, "model-key");
  assert.equal(env.NM_TEST_START_DAEMON, "1");
  for (const name of [
    "GH_TOKEN",
    "GITHUB_TOKEN",
    "ACTIONS_RUNTIME_TOKEN",
    "ACTIONS_ID_TOKEN_REQUEST_TOKEN",
    "ACTIONS_ID_TOKEN_REQUEST_URL",
    "ACTIONS_CACHE_URL",
    "ACTIONS_RESULTS_URL",
  ]) {
    assert.equal(Object.hasOwn(env, name), false, name);
  }
});

test("nonzero AXI exit produces a finalizable sanitized failure", () => {
  const parsed = parseAxiResult(
    "run:\n  id: run-1\n  head: abcdef12\noutcome: passed\n",
    1,
  );
  const artifact = sanitizedGateArtifact(parsed, HEAD);

  assert.equal(artifact.status, "failed");
  assert.equal(normalizeGateArtifact(artifact, HEAD).status, "failed");
});

test("quoted TOON run fields normalize before head validation", () => {
  const parsed = parseAxiResult(
    'run:\n  id: "run-quoted"\n  head: "abcdef12"\noutcome: passed\n',
    0,
  );

  assert.equal(parsed.run.id, "run-quoted");
  assert.equal(parsed.run.head, "abcdef12");
  assert.equal(validatedHeadMatches(parsed, HEAD), true);
});

test("ask-user gate blocks and exposes only safe finding metadata", () => {
  const secret = "sk-example-secret-value";
  const output = `run:
  id: run-2
  head: abcdef12
gate:
  step: review
  status: awaiting_approval
  findings[1]{id,severity,file,action,description}:
    r1,error,src/auth.ts,ask-user,"Leaked ${secret}, requires a decision"`;
  const parsed = parseAxiResult(output, 0);
  const artifact = sanitizedGateArtifact(parsed, HEAD);
  const comment = gateCommentBody({
    artifact,
    branch: "agent/issue-42-fix-flow",
    sha: HEAD,
  });

  assert.equal(artifact.status, "blocked");
  assert.equal(artifact.outcome, "ask-user");
  assert.deepEqual(artifact.findings, [
    { id: "r1", severity: "error", file: "src/auth.ts", action: "ask-user" },
  ]);
  assert.doesNotMatch(comment, new RegExp(secret));
  assert.match(
    comment,
    /source intent, and process output are intentionally omitted/,
  );
});

test("unknown decision gate fails closed", () => {
  const result = parseAxiResult(
    "run:\n  id: run-3\n  head: abcdef12\ngate:\n  step: review\n",
    0,
  );

  assert.equal(result.status, "blocked");
  assert.equal(result.outcome, "decision-gate");
});

test("trusted gate scope rejects forks, manual branches, and policy changes", () => {
  const trust = assertTrustedAgentPull(trustedPull(), config, safeFiles);
  assert.equal(trust.sourceIssue, 42);

  assert.throws(
    () =>
      assertTrustedAgentPull(
        trustedPull({
          head: {
            ref: "agent/issue-42-fix-flow",
            sha: HEAD,
            repo: { full_name: "fork/repo" },
          },
        }),
        config,
        safeFiles,
      ),
    /same-repository/,
  );
  assert.throws(
    () =>
      assertTrustedAgentPull(
        trustedPull({
          head: {
            ref: "feature/manual",
            sha: HEAD,
            repo: { full_name: "owner/repo" },
          },
        }),
        config,
        safeFiles,
      ),
    /branch does not match implementation source issue/,
  );
  assert.throws(
    () =>
      assertTrustedAgentPull(trustedPull(), config, [
        { filename: ".no-mistakes.yaml" },
      ]),
    /privileged candidate paths/,
  );
  assert.throws(
    () =>
      assertTrustedAgentPull(trustedPull(), config, [
        {
          filename: "docs/new.md",
          previous_filename: ".no-mistakes.yaml",
        },
      ]),
    /privileged candidate paths/,
  );
});

test("no-mistakes refuses non-bot agent PR authors", () => {
  assert.throws(
    () => assertTrustedAgentPull({ ...trustedPull(), user: { login: "contributor" } }, config, safeFiles),
    /author must be github-actions\[bot\]/,
  );
});

test("unpublished no-mistakes changes cannot produce a passing artifact", () => {
  const parsed = parseAxiResult(
    "run:\n  id: run-4\n  head: 99999999\noutcome: passed\n",
    0,
  );
  const artifact = sanitizedGateArtifact(parsed, HEAD);

  assert.equal(artifact.status, "failed");
  assert.equal(artifact.outcome, "unpublished-changes");
  assert.equal(artifact.validatedHead, "");

  const dirtyArtifact = sanitizedGateArtifact(
    parseAxiResult("run:\n  id: run-4\n  head: abcdef12\noutcome: passed\n", 0),
    HEAD,
    { unpublishedChanges: true },
  );
  assert.equal(dirtyArtifact.status, "failed");
  assert.equal(dirtyArtifact.outcome, "unpublished-changes");
});

test("sanitized artifact cannot prove a different head", () => {
  const parsed = parseAxiResult(
    "run:\n  id: run-5\n  head: abcdef12\noutcome: passed\n",
    0,
  );
  const artifact = sanitizedGateArtifact(parsed, HEAD);

  assert.throws(
    () =>
      normalizeGateArtifact(
        artifact,
        "1111111111111111111111111111111111111111",
      ),
    /targets another head/,
  );
  assert.throws(
    () =>
      normalizeGateArtifact(
        { ...artifact, validatedHead: "", status: "passed" },
        HEAD,
      ),
    /cannot prove this head/,
  );
});
