import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  READINESS_MARKER,
  collectReadinessSnapshot,
  evaluateReadiness,
  exactHeadCheckState,
  publishReadiness,
  readinessSummary,
  waitForBaselineChecks,
  waitForPreflightReadiness
} from "./agent-readiness.mjs";

const headSha = "a".repeat(40);
const details = "https://github.com/owner/repo/actions/runs/12/job/34";
const config = {
  repo: { owner: "owner", name: "repo", defaultBranch: "main" },
  automerge: { requiredChecks: ["quality", "build", "scenarios", "audit", "dependency-review"] },
  crabbox: { nonVisualProviders: ["vercel-sandbox", "hetzner"] },
  readiness: {
    status: "agent-readiness",
    workflow: "agent-readiness.yml",
    maxAgeHours: 26,
    baselineChecks: ["quality", "build", "scenarios", "audit"],
    primaryProvider: "vercel-sandbox",
    fallbackProvider: "local-container",
    alertTitle: "AFK automation readiness drift"
  }
};

function check(name, conclusion = "success", overrides = {}) {
  return {
    id: name.length,
    name,
    head_sha: headSha,
    status: "completed",
    conclusion,
    details_url: details,
    app: { slug: "github-actions" },
    started_at: "2026-07-24T10:00:00Z",
    ...overrides
  };
}

function snapshot() {
  return {
    headSha,
    checks: config.readiness.baselineChecks.map((name) => check(name)),
    branch: {
      protected: true,
      protection: {
        required_status_checks: {
          enforcement_level: "non_admins",
          contexts: config.automerge.requiredChecks
        }
      }
    },
    credentials: { agentAuth: true, primaryProvider: true, render: true },
    providerRecord: {
      ok: true,
      attempted: true,
      provider: "vercel-sandbox",
      leaseId: "vsbx_123",
      timing: {
        provider: "vercel-sandbox",
        leaseId: "vsbx_123",
        totalMs: 1200,
        exitCode: 0
      }
    },
    fallbackProviderRecord: {
      ok: true,
      attempted: true,
      provider: "local-container",
      leaseId: "local_123",
      timing: {
        provider: "local-container",
        leaseId: "local_123",
        totalMs: 800,
        exitCode: 0
      }
    },
    staticAgentTests: true,
    audit: { ok: true },
    renderRecord: {
      status: "passed",
      deployStatus: "live",
      health: [{ passed: true }]
    },
    readinessRuns: [
      {
        id: 1,
        status: "completed",
        conclusion: "success",
        event: "schedule",
        head_branch: "main",
        head_sha: headSha,
        updated_at: "2026-07-24T09:00:00Z"
      }
    ]
  };
}

test("scheduled readiness requires exact baseline, policy, credentials, audit, and live provider provenance", () => {
  const result = evaluateReadiness(config, snapshot(), {
    mode: "scheduled",
    now: new Date("2026-07-24T10:00:00Z")
  });

  assert.equal(result.ready, true);
  assert.equal(result.provider, "vercel-sandbox");
  assert.equal(result.leaseId, "vsbx_123");
  assert.equal(result.fallbackProvider, "local-container");
  assert.equal(result.fallbackLeaseId, "local_123");

  const alternative = snapshot();
  alternative.providerRecord = {
    ok: true,
    attempted: true,
    provider: "hetzner",
    leaseId: "hcloud_123",
    timing: {
      provider: "hetzner",
      leaseId: "hcloud_123",
      totalMs: 1200,
      exitCode: 0
    }
  };
  assert.equal(
    evaluateReadiness(config, alternative, {
      mode: "scheduled",
      now: new Date("2026-07-24T10:00:00Z")
    }).ready,
    true
  );

  const broken = snapshot();
  broken.checks = broken.checks.map((item) => (item.name === "audit" ? { ...item, conclusion: "failure" } : item));
  broken.branch.protection.required_status_checks.contexts = ["quality"];
  broken.providerRecord.leaseId = "";
  broken.fallbackProviderRecord.ok = false;
  broken.renderRecord.health[0].passed = false;
  const failed = evaluateReadiness(config, broken, {
    mode: "scheduled",
    now: new Date("2026-07-24T10:00:00Z")
  });

  assert.equal(failed.ready, false);
  assert.ok(failed.findings.some((item) => item.code === "check-audit"));
  assert.ok(failed.findings.some((item) => item.code === "branch-check-build"));
  assert.ok(failed.findings.some((item) => item.code === "primary-lifecycle"));
  assert.ok(failed.findings.some((item) => item.code === "fallback-lifecycle"));
  assert.ok(failed.findings.some((item) => item.code === "render-health"));
});

test("readiness collection uses only workflow-token-readable repository APIs", () => {
  const calls = [];
  const collected = collectReadinessSnapshot(config, {
    api(path) {
      calls.push(path);
      if (path === "commits/main") return { sha: headSha };
      if (path.startsWith(`commits/${headSha}/check-runs`)) {
        return { check_runs: [] };
      }
      if (path.startsWith("actions/workflows/")) {
        return { workflow_runs: [] };
      }
      if (path === "branches/main") return snapshot().branch;
      throw new Error(`unexpected API path ${path}`);
    },
  });
  assert.equal(collected.branch.protected, true);
  assert.deepEqual(calls, [
    "commits/main",
    `commits/${headSha}/check-runs?per_page=100`,
    "actions/workflows/agent-readiness.yml/runs?branch=main&per_page=20",
    "branches/main",
  ]);
  const source = readFileSync(
    new URL("./agent-readiness.mjs", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /actions\/permissions|branches\/\$\{config\.repo\.defaultBranch\}\/protection/);
});

test("preflight accepts only a fresh successful readiness run", () => {
  const current = snapshot();
  const ready = evaluateReadiness(config, current, {
    mode: "preflight",
    now: new Date("2026-07-24T10:00:00Z")
  });
  assert.equal(ready.ready, true);

  current.readinessRuns[0].updated_at = "2026-07-22T01:00:00Z";
  const stale = evaluateReadiness(config, current, {
    mode: "preflight",
    now: new Date("2026-07-24T10:00:00Z")
  });
  assert.equal(stale.ready, false);
  assert.ok(stale.findings.some((item) => item.code === "health-stale"));

  const wrongHead = snapshot();
  wrongHead.readinessRuns[0].head_sha = "b".repeat(40);
  const mismatched = evaluateReadiness(config, wrongHead, {
    mode: "preflight",
    now: new Date("2026-07-24T10:00:00Z")
  });
  assert.equal(mismatched.ready, false);
  assert.ok(mismatched.findings.some((item) => item.code === "health-missing"));
});

test("preflight waits for readiness on the exact current main head", async () => {
  let time = Date.parse("2026-07-24T10:00:00Z");
  let attempts = 0;
  const result = await waitForPreflightReadiness(config, {
    timeoutMs: 30_000,
    pollMs: 1_000,
    clock: () => time,
    sleep: async (milliseconds) => {
      time += milliseconds;
    },
    collect: () => {
      attempts += 1;
      const current = snapshot();
      if (attempts === 1) current.readinessRuns[0].head_sha = "b".repeat(40);
      return current;
    }
  });
  assert.equal(result.ready, true);
  assert.equal(attempts, 2);
});

test("scheduled readiness waits for exact-head baseline checks to finish", async () => {
  let time = Date.parse("2026-07-24T10:00:00Z");
  let attempts = 0;
  const result = await waitForBaselineChecks(config, {
    timeoutMs: 30_000,
    pollMs: 1_000,
    clock: () => time,
    sleep: async (milliseconds) => {
      time += milliseconds;
    },
    collect: () => {
      attempts += 1;
      const current = snapshot();
      if (attempts === 1) {
        current.checks = current.checks.filter(
          (item) => item.name !== "build"
        );
      }
      return current;
    }
  });

  assert.equal(result.ready, true);
  assert.equal(result.headSha, headSha);
  assert.equal(attempts, 2);
});

test("scheduled readiness stops waiting on a terminal baseline failure", async () => {
  const current = snapshot();
  current.checks = current.checks.map((item) =>
    item.name === "audit" ? { ...item, conclusion: "failure" } : item
  );
  const result = await waitForBaselineChecks(config, {
    timeoutMs: 30_000,
    pollMs: 1_000,
    collect: () => current
  });

  assert.equal(result.ready, false);
  assert.equal(result.terminalFailure, true);
  assert.equal(result.states.audit, "failure");
});

test("baseline ignores forged or stale check runs", () => {
  assert.equal(exactHeadCheckState([check("quality")], "quality", headSha, config), "success");
  assert.equal(
    exactHeadCheckState([check("quality", "success", { app: { slug: "foreign" } })], "quality", headSha, config),
    "missing"
  );
  assert.equal(
    exactHeadCheckState([check("quality", "success", { head_sha: "b".repeat(40) })], "quality", headSha, config),
    "missing"
  );
});

test("readiness publication reconciles one actionable issue and one exact-head check", () => {
  const result = evaluateReadiness(config, snapshot(), { mode: "scheduled" });
  result.ready = false;
  result.findings = [{ category: "provider", code: "primary-lifecycle", message: "provider unavailable" }];
  const calls = [];
  const publication = publishReadiness(config, result, { detailsUrl: details }, {
    findIssue() {
      return { number: 7, state: "open" };
    },
    withTempJson(payload, callback) {
      return callback(`/payload/${calls.push(payload)}`);
    },
    ghJson(args) {
      calls.at(-1).args = args;
      return { number: 7 };
    }
  });

  assert.equal(publication.issue, "updated");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].head_sha, headSha);
  assert.equal(calls[0].conclusion, "failure");
  assert.equal(calls[1].body.includes(READINESS_MARKER), true);
  assert.equal(calls[1].state, "open");
  assert.match(readinessSummary(result), /provider\/primary-lifecycle/);
});

test("readiness workflow is scheduled, zero-model, pinned, and publishes even after provider failure", () => {
  const workflow = readFileSync(new URL("../.github/workflows/agent-readiness.yml", import.meta.url), "utf8");
  const crabboxAction = readFileSync(
    new URL("../.github/actions/setup-crabbox/action.yml", import.meta.url),
    "utf8"
  );
  const renderAction = readFileSync(
    new URL("../.github/actions/setup-render/action.yml", import.meta.url),
    "utf8"
  );

  assert.match(workflow, /schedule:\n\s+- cron: "17 14 \* \* \*"/);
  assert.match(workflow, /push:\n\s+branches:\n\s+- main/);
  assert.match(workflow, /ref: \$\{\{ github\.sha \}\}/);
  assert.match(workflow, /uses: \.\/\.github\/actions\/setup-crabbox/);
  assert.match(crabboxAction, /openclaw\/crabbox.*v0\.40\.0|gh release download v0\.40\.0/);
  assert.match(workflow, /--lane readinessRemote/);
  assert.match(
    workflow,
    /--wait-baseline\n\s+--wait-seconds 900\n\s+--expected-head "\$\{\{ github\.sha \}\}"/
  );
  assert.ok(
    workflow.indexOf("--wait-baseline") <
      workflow.indexOf("--lane readinessRemote")
  );
  assert.match(workflow, /--lane fallbackReadinessRemote/);
  assert.match(workflow, /HCLOUD_TOKEN: \$\{\{ secrets\.HCLOUD_TOKEN \}\}/);
  assert.match(workflow, /HETZNER_TOKEN: \$\{\{ secrets\.HETZNER_TOKEN \}\}/);
  assert.match(workflow, /CRABBOX_HETZNER_READY: \$\{\{ vars\.CRABBOX_HETZNER_READY \}\}/);
  assert.match(
    workflow,
    /PRIMARY_PROVIDER_AUTH_PRESENT:[^\n]*CRABBOX_HETZNER_READY[^\n]*HCLOUD_TOKEN/
  );
  assert.match(workflow, /agent-render-proof\.mjs/);
  assert.match(workflow, /uses: \.\/\.github\/actions\/setup-render/);
  assert.match(renderAction, /cli_2\.22\.0_linux_amd64\.zip/);
  assert.match(workflow, /--publish --json/);
  assert.match(workflow, /if: always\(\)/);
  assert.doesNotMatch(workflow, /CODEX_API_KEY|OPENAI_API_KEY:\s*\$\{\{\s*secrets/);
  assert.doesNotMatch(workflow, /openai\/codex-action|agent-worker/);
});

test("implementation preflight blocks before any model-authenticated job", () => {
  const workflow = readFileSync(new URL("../.github/workflows/agent-implement.yml", import.meta.url), "utf8");
  const prepare = workflow.match(/\n  prepare-prompt:\n([\s\S]*?)\n  generate-patch-remote:/)?.[1] ?? "";

  assert.match(prepare, /--preflight\n\s+--wait-seconds 900\n\s+--json/);
  assert.match(prepare, /checks: read/);
  assert.match(prepare, /actions: read/);
  assert.doesNotMatch(prepare, /CODEX_API_KEY|openai\/codex-action/);
});
