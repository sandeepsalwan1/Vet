import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  assertTrustedAgentPull,
  composeEffectiveIntent,
  gateGhShimScript,
  gateCommentBody,
  noMistakesCommentMarker,
  parseAxiResult,
  validatedHeadMatches,
} from "./agent-no-mistakes-gate.mjs";

const config = {
  repo: { owner: "owner", name: "repo", defaultBranch: "main" },
};

function trustedPull(overrides = {}) {
  return {
    number: 12,
    body: `<!-- agent-implementation:v1 -->
\`\`\`json
{"sourceIssue":42,"automergeEligible":true}
\`\`\``,
    head: {
      ref: "agent/issue-42-fix-flow",
      sha: "abcdef123456",
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
  assert.equal(validatedHeadMatches(result, "abcdef123456"), true);
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

test("gate gh shim preserves PR metadata while delegating read commands", () => {
  const directory = mkdtempSync(join(tmpdir(), "vet-gate-shim-"));
  const realGh = join(directory, "real-gh");
  const shim = join(directory, "gh");
  try {
    writeFileSync(realGh, '#!/bin/sh\nprintf "%s\\n" "$*"\n', { mode: 0o700 });
    writeFileSync(shim, gateGhShimScript(realGh), { mode: 0o700 });

    const delegated = spawnSync(shim, ["issue", "view", "42"], {
      encoding: "utf8",
    });
    const edit = spawnSync(shim, ["pr", "edit", "12", "--body-file", "-"], {
      encoding: "utf8",
    });
    const create = spawnSync(shim, ["pr", "create", "--body-file", "-"], {
      encoding: "utf8",
    });

    assert.equal(delegated.status, 0);
    assert.equal(delegated.stdout.trim(), "issue view 42");
    assert.equal(edit.status, 0);
    assert.equal(edit.stdout, "");
    assert.equal(create.status, 1);
    assert.match(create.stderr, /PR creation disabled/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("no-mistakes uses its own composite managed-comment marker", () => {
  assert.equal(
    noMistakesCommentMarker({ comments: { gate: "<!-- agent-gate:v1 -->" } }),
    "<!-- agent-gate:v1 -->\n<!-- agent-gate-no-mistakes:v1 -->",
  );
});

test("nonzero exit cannot turn a passing word into a passing gate", () => {
  const result = parseAxiResult(
    "run:\n  id: run-1\n  head: abcdef12\noutcome: passed\n",
    1,
  );

  assert.equal(result.status, "failed");
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
  const result = parseAxiResult(output, 0);
  const comment = gateCommentBody({
    status: result.status,
    branch: "agent/issue-42-fix-flow",
    sha: "abcdef123456",
    runId: result.run.id,
    findings: result.findings,
    blocker: "decision required",
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.outcome, "ask-user");
  assert.deepEqual(result.findings, [
    { id: "r1", severity: "error", file: "src/auth.ts", action: "ask-user" },
  ]);
  assert.doesNotMatch(comment, new RegExp(secret));
  assert.match(
    comment,
    /Finding descriptions and process output are intentionally omitted/,
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

test("trusted gate scope requires same-repo agent implementation metadata and branch", () => {
  const trust = assertTrustedAgentPull(trustedPull(), config);

  assert.equal(trust.sourceIssue, 42);
  assert.throws(
    () =>
      assertTrustedAgentPull(
        trustedPull({
          head: {
            ref: "agent/issue-42-fix-flow",
            sha: "abcdef",
            repo: { full_name: "fork/repo" },
          },
        }),
        config,
      ),
    /cross-repository/,
  );
  assert.throws(
    () =>
      assertTrustedAgentPull(
        trustedPull({
          head: {
            ref: "feature/manual",
            sha: "abcdef",
            repo: { full_name: "owner/repo" },
          },
        }),
        config,
      ),
    /untrusted same-repository/,
  );
});

test("validated head mismatch fails the freshness guard", () => {
  const result = parseAxiResult(
    "run:\n  id: run-4\n  head: abcdef12\noutcome: checks-passed\n",
    0,
  );

  assert.equal(validatedHeadMatches(result, "999999999999"), false);
});
