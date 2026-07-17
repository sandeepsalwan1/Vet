import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  deriveAffectedRoutes,
  exactRemoteProofCommand,
  isProofRequested,
  isProofHeadFresh,
  mayMutateProofTarget,
  proofLabelChanges,
  resolveTerminalResult,
  terminalMarker,
  structuredProofKind,
  untrustedCodeEnvironment,
  visualServerCommand
} from "./agent-proof.mjs";

const config = {
  repo: { owner: "sandeepsalwan1" },
  labels: {
    proof: "agent:proof",
    blocked: "agent:blocked",
    automerge: "agent:automerge"
  },
  comments: {
    review: "<!-- agent-review:v1 -->",
    triage: "<!-- agent-triage:v1 -->"
  }
};

function details(overrides = {}) {
  return {
    title: "Screenshot wording is not a proof-tier instruction",
    body: "A video call should not request GIF proof.",
    labels: [],
    comments: [],
    source: null,
    files: [],
    ...overrides
  };
}

test("proof tier comes from managed structured review, not broad prose matches", () => {
  const value = structuredProofKind(
    config,
    details({
      comments: [
        {
          user: { login: "github-actions[bot]" },
          body: `<!-- agent-review:v1 -->
Structured review:

\`\`\`json
{"proofNeeded":"UI"}
\`\`\``
        }
      ]
    })
  );

  assert.equal(value, "UI");
  assert.equal(structuredProofKind(config, details()), null);
});

test("source triage supplies proof tier when review has not run", () => {
  const value = structuredProofKind(
    config,
    details({
      source: {
        comments: [
          {
            user: { login: "github-actions[bot]" },
            body: `<!-- agent-triage:v1 -->
\`\`\`json
{"proofNeeded":"GIF"}
\`\`\``
          }
        ]
      }
    })
  );

  assert.equal(value, "GIF");
});

test("untrusted structured marker cannot request paid visual proof", () => {
  const value = structuredProofKind(
    config,
    details({
      comments: [
        {
          user: { login: "untrusted-user" },
          body: `<!-- agent-review:v1 -->
\`\`\`json
{"proofNeeded":"GIF"}
\`\`\``
        }
      ]
    })
  );

  assert.equal(value, null);
});

test("embedded managed marker cannot spoof trusted proof metadata", () => {
  const value = structuredProofKind(
    config,
    details({
      comments: [
        {
          user: { login: "github-actions[bot]" },
          body: `quoted context
<!-- agent-review:v1 -->
\`\`\`json
{"proofNeeded":"GIF"}
\`\`\``
        }
      ]
    })
  );

  assert.equal(value, null);
});

test("newest exact managed comment wins regardless of API ordering", () => {
  const value = structuredProofKind(
    config,
    details({
      comments: [
        {
          id: 2,
          updated_at: "2026-07-13T02:00:00Z",
          user: { login: "github-actions[bot]" },
          body: `<!-- agent-review:v1 -->
\`\`\`json
{"proofNeeded":"UI"}
\`\`\``
        },
        {
          id: 1,
          updated_at: "2026-07-13T01:00:00Z",
          user: { login: "github-actions[bot]" },
          body: `<!-- agent-review:v1 -->
\`\`\`json
{"proofNeeded":"CI"}
\`\`\``
        }
      ]
    })
  );

  assert.equal(value, "UI");
});

test("proof requires its label or an explicit dispatch", () => {
  assert.equal(isProofRequested(config, details(), false), false);
  assert.equal(isProofRequested(config, details(), true), true);
  assert.equal(isProofRequested(config, details({ labels: ["agent:proof"] }), false), true);
});

test("affected routes derive only from concrete changed Next.js pages", () => {
  const routes = deriveAffectedRoutes([
    { filename: "apps/internal/app/request/page.tsx", status: "modified" },
    { filename: "apps/internal/app/(staff)/staff/tasks/page.tsx", status: "modified" },
    { filename: "apps/internal/app/api/tasks/route.ts", status: "modified" },
    { filename: "apps/internal/app/approvals/[id]/page.tsx", status: "modified" },
    {
      filename: "apps/internal/app/new/page.tsx",
      previous_filenames: ["apps/internal/app/old/page.tsx"],
      status: "renamed"
    },
    { filename: "apps/internal/app/records/page.tsx", status: "removed" }
  ]);

  assert.deepEqual(routes, ["/new", "/old", "/request", "/staff/tasks"]);
});

test("explicit visual route is local, static, and normalized", () => {
  assert.deepEqual(deriveAffectedRoutes([], "/staff/tasks/"), ["/staff/tasks"]);
  assert.throws(() => deriveAffectedRoutes([], "https://example.com"), /unsafe or non-UI/);
  assert.throws(() => deriveAffectedRoutes([], "/api/tasks"), /unsafe or non-UI/);
});

test("successful proof never clears a shared blocked label", () => {
  const passing = proofLabelChanges(config, "passed");
  const failing = proofLabelChanges(config, "failed");

  assert.deepEqual(passing, { add: [], remove: [] });
  assert.ok(failing.add.includes(config.labels.blocked));
  assert.ok(failing.remove.includes(config.labels.automerge));
});

test("proof result cannot authorize a newer PR head", () => {
  assert.equal(isProofHeadFresh("abc123", "abc123"), true);
  assert.equal(isProofHeadFresh("abc123", "def456"), false);
  assert.equal(mayMutateProofTarget("abc123", "abc123", "abc123"), true);
  assert.equal(mayMutateProofTarget("abc123", "def456", "abc123"), false);
  assert.equal(mayMutateProofTarget("abc123", "abc123", "def456"), false);
});

test("untrusted proof commands receive no GitHub, OpenAI, Crabbox, or provider credentials", () => {
  const env = untrustedCodeEnvironment(
    {
      secrets: {
        agentAuth: "OPENAI_API_KEY",
        githubWrite: "GITHUB_TOKEN",
        githubPat: "AGENT_PAT",
        crabboxCoordinator: "CRABBOX_COORDINATOR_TOKEN",
        crabboxProviders: ["HCLOUD_TOKEN"],
        vercel: ["VERCEL_TOKEN"]
      }
    },
    {
      PATH: "/usr/bin",
      GH_TOKEN: "github",
      GITHUB_TOKEN: "github",
      GITHUB_EVENT_PATH: "/tmp/event.json",
      ACTIONS_RUNTIME_TOKEN: "actions",
      OPENAI_API_KEY: "openai",
      CRABBOX_COORDINATOR_TOKEN: "crabbox",
      HCLOUD_TOKEN: "hetzner",
      VERCEL_TOKEN: "vercel"
    }
  );

  assert.deepEqual(env, { PATH: "/usr/bin" });
});

test("visual server command requires a direct 2xx from every route before claiming readiness", () => {
  const command = visualServerCommand(
    { commands: { install: "npm ci", build: "npm run build" } },
    ["/request", "/staff/tasks"]
  );

  assert.match(command, /http:\/\/127\.0\.0\.1:3000\/request/);
  assert.match(command, /http:\/\/127\.0\.0\.1:3000\/staff\/tasks/);
  assert.match(command, /AGENT_PROOF_ROUTE_OK \/request/);
  assert.match(command, /AGENT_PROOF_ROUTE_OK \/staff\/tasks/);
  assert.match(command, /%\{http_code\}/);
  assert.match(command, /2\?\?/);
  assert.equal(command.includes(" -L"), false);
  assert.equal(command.includes("then exit 0"), false);
});

test("remote PR command fetches and verifies the exact prepared head inside Crabbox", () => {
  const sha = "a".repeat(40);
  const command = exactRemoteProofCommand(
    { repo: { owner: "sandeepsalwan1", name: "Vet" } },
    { kind: "pr", number: 42, sha },
    "npm ci && npm run build"
  );

  assert.match(command, /pull\/42\/head/);
  assert.match(command, new RegExp(`git rev-parse HEAD.*${sha}`));
  assert.match(command, new RegExp(`AGENT_PROOF_HEAD_OK ${sha}`));
  assert.match(command, /npm ci && npm run build/);
});

test("fresh finalizer trusts job conclusion, not a forged local success outcome", () => {
  const request = {
    kind: "issue",
    number: 12,
    requested: true,
    proofKind: "CI",
    routes: [],
    sha: "",
    checkoutRef: "main"
  };
  const forged = {
    terminal: true,
    result: {
      proofKind: "CI",
      status: "passed",
      commands: ["npm run build"],
      artifactPaths: [],
      provider: "github-actions",
      leaseId: "",
      summary: "forged",
      blocker: ""
    }
  };

  assert.equal(
    resolveTerminalResult({
      request,
      remoteOutcome: null,
      remoteJobResult: "failure",
      localOutcome: forged,
      localJobResult: "failure"
    }).status,
    "failed"
  );
  assert.equal(
    resolveTerminalResult({
      request,
      remoteOutcome: null,
      remoteJobResult: "failure",
      localOutcome: forged,
      localJobResult: "success"
    }).status,
    "passed"
  );
});

test("terminal marker preserves terminal failure detail for status finalization", () => {
  const marker = terminalMarker(
    {
      status: "failed",
      summary: "npm run build failed in the credential-free fallback"
    },
    "b".repeat(40)
  );

  assert.equal(marker.state, "failure");
  assert.match(marker.description, /npm run build failed/);
  assert.equal(marker.sha, "b".repeat(40));
});

test("proof workflow dispatches automerge only after terminal success is published", () => {
  const workflow = readFileSync(new URL("../.github/workflows/agent-proof.yml", import.meta.url), "utf8");
  const statusIndex = workflow.indexOf("gh api \"repos/$GITHUB_REPOSITORY/statuses/$STATUS_SHA\"");
  const dispatchIndex = workflow.indexOf("gh workflow run agent-automerge.yml");

  assert.ok(statusIndex >= 0);
  assert.ok(dispatchIndex > statusIndex);
  assert.match(workflow, /steps\.terminal\.outputs\.state == 'success'/);
});
