import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveAffectedRoutes,
  isProofRequested,
  isProofHeadFresh,
  proofLabelChanges,
  structuredProofKind
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
    { filename: "apps/internal/app/records/page.tsx", status: "removed" }
  ]);

  assert.deepEqual(routes, ["/request", "/staff/tasks"]);
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
});
