import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { commandBehaviorReport } from "./agent-behavior-report.mjs";

import {
  combineProofResults,
  deriveAffectedRoutes,
  exactRemoteProofCommand,
  isProofRequested,
  isProofHeadFresh,
  mayMutateProofTarget,
  proofBody,
  proofLabelChanges,
  proofLabelUpdates,
  proofRepairEligible,
  preparationFailureRecord,
  resolveTerminalResult,
  terminalMarker,
  structuredProofKind,
  untrustedCodeEnvironment,
  validateArtifactUrl,
  validatePublishedMedia,
  validatePublishedMediaOutcome,
  validateVisualBehaviorPlan,
  visualRoutes,
  visualServerCommand
} from "./agent-proof.mjs";

const config = {
  repo: { owner: "sandeepsalwan1" },
  labels: {
    proof: "agent:proof",
    proofFailed: "agent:proof-failed",
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

test("review proof cannot downgrade the sealed source tier", () => {
  const value = structuredProofKind(
    config,
    details({
      comments: [
        {
          user: { login: "github-actions[bot]" },
          body: `<!-- agent-review:v1 -->
\`\`\`json
{"proofNeeded":"none"}
\`\`\``
        }
      ],
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

test("incomparable service and browser proof requests fail closed", () => {
  assert.throws(
    () =>
      structuredProofKind(
        config,
        details({
          comments: [
            {
              user: { login: "github-actions[bot]" },
              body: `<!-- agent-review:v1 -->
\`\`\`json
{"proofNeeded":"UI"}
\`\`\``
            }
          ],
          source: {
            comments: [
              {
                user: { login: "github-actions[bot]" },
                body: `<!-- agent-triage:v1 -->
\`\`\`json
{"proofNeeded":"service"}
\`\`\``
              }
            ]
          }
        })
      ),
    /conflicting service and browser proof requests/
  );
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

  assert.deepEqual(routes, ["/new", "/old", "/request", "/staff"]);
});

test("explicit visual route is local, static, and normalized", () => {
  assert.deepEqual(deriveAffectedRoutes([], "/staff/tasks/"), ["/staff"]);
  assert.throws(() => deriveAffectedRoutes([], "https://example.com"), /unsafe or non-UI/);
  assert.throws(() => deriveAffectedRoutes([], "/api/tasks"), /unsafe or non-UI/);
});

test("visual execution follows the proof plan instead of unrelated shared-file routes", () => {
  const proofPlan = {
    version: 1,
    tasks: [
      {
        clauseIds: ["AC1"],
        route: "/staff",
        actions: [{ type: "navigate", path: "/staff" }],
        intermediateAssertions: [{ type: "hidden", selector: ".miniConfetti" }],
        finalAssertions: [{ type: "visible", selector: ".miniConfetti" }],
        session: "demo-admin"
      }
    ]
  };
  const proofDetails = details({
    files: [
      {
        filename: "apps/internal/app/globals.css",
        status: "modified"
      }
    ],
    intentCapsule: {
      behaviorContract: {
        routes: []
      }
    },
    implementationAddendum: {
      intentAddendum: {
        proofPlan
      }
    }
  });

  assert.deepEqual(deriveAffectedRoutes(proofDetails.files), ["/"]);
  assert.deepEqual(visualRoutes(proofDetails), ["/staff"]);
  assert.deepEqual(visualRoutes(proofDetails, "/staff"), ["/staff"]);
  assert.throws(
    () => visualRoutes(proofDetails, "/proof/loading"),
    /explicit proof route \/proof\/loading does not match the implementation browser plan/
  );
});

test("visual execution falls back to sealed and affected routes without a plan", () => {
  assert.deepEqual(
    visualRoutes(
      details({
        files: [
          {
            filename: "apps/internal/app/globals.css",
            status: "modified"
          }
        ],
        intentCapsule: {
          behaviorContract: {
            routes: ["/proof/loading"]
          }
        }
      })
    ),
    ["/", "/proof/loading"]
  );
});

test("visual behavior plan covers every sealed clause and GIF transition", () => {
  const behaviorContract = {
    target: { kind: "web" },
    captureBeforeAction: true,
    checks: [
      { id: "AC1", statement: "Loading is visible." },
      { id: "AC2", statement: "The page completes." }
    ]
  };
  const proofPlan = {
    version: 1,
    tasks: [
      {
        clauseIds: ["AC1", "AC2"],
        route: "/proof/loading",
        actions: [
          { type: "navigate", path: "/proof/loading" },
          { type: "click", selector: "[data-agent-proof='start']" }
        ],
        intermediateAssertions: [
          { type: "visible", selector: "[data-agent-proof-state='loading']" }
        ],
        finalAssertions: [
          { type: "visible", selector: "[data-agent-proof-state='complete']" }
        ]
      }
    ]
  };

  assert.deepEqual(
    validateVisualBehaviorPlan({
      proofKind: "GIF",
      routes: ["/proof/loading"],
      behaviorContract,
      proofPlan
    }),
    {
      ...proofPlan,
      tasks: [{ ...proofPlan.tasks[0], session: "none" }]
    }
  );
  assert.throws(
    () =>
      validateVisualBehaviorPlan({
        proofKind: "GIF",
        routes: ["/proof/loading"],
        behaviorContract,
        proofPlan: {
          ...proofPlan,
          tasks: [
            {
              ...proofPlan.tasks[0],
              clauseIds: ["AC1"]
            }
          ]
        }
      }),
    /does not cover sealed clauses: AC2/
  );
  assert.throws(
    () =>
      validateVisualBehaviorPlan({
        proofKind: "GIF",
        routes: ["/proof/loading"],
        behaviorContract,
        proofPlan: {
          ...proofPlan,
          tasks: [
            {
              ...proofPlan.tasks[0],
              intermediateAssertions: []
            }
          ]
        }
      }),
    /no intermediate assertion/
  );
});

test("browser clauses that name a sealed route cannot use another page", () => {
  const behaviorContract = {
    target: { kind: "web" },
    captureBeforeAction: true,
    routes: ["/", "/proof/loading"],
    checks: [
      {
        id: "AC1",
        statement: "Normal `/` navigation keeps its current timing."
      }
    ]
  };
  const task = {
    clauseIds: ["AC1"],
    route: "/proof/loading",
    actions: [
      { type: "navigate", path: "/proof/loading" },
      { type: "click", selector: "[data-agent-proof='start']" }
    ],
    intermediateAssertions: [{ type: "visible", selector: "main" }],
    finalAssertions: [{ type: "visible", selector: "main" }]
  };

  assert.throws(
    () =>
      validateVisualBehaviorPlan({
        proofKind: "GIF",
        routes: ["/", "/proof/loading"],
        behaviorContract,
        proofPlan: { version: 1, tasks: [task] }
      }),
    /AC1 uses \/proof\/loading instead of sealed route \//
  );
  assert.equal(
    validateVisualBehaviorPlan({
      proofKind: "GIF",
      routes: ["/", "/proof/loading"],
      behaviorContract,
      proofPlan: {
        version: 1,
        tasks: [
          {
            ...task,
            route: "/",
            actions: [
              { type: "navigate", path: "/" },
              { type: "click", selector: "[data-agent-proof='start']" }
            ]
          }
        ]
      }
    }).tasks[0].route,
    "/"
  );

  assert.throws(
    () =>
      validateVisualBehaviorPlan({
        proofKind: "GIF",
        routes: ["/proof/loading", "/settings"],
        behaviorContract: {
          ...behaviorContract,
          routes: ["/proof/loading", "/settings"],
          checks: [
            {
              id: "AC1",
              statement: "The `/settings/` page keeps its current timing."
            }
          ]
        },
        proofPlan: { version: 1, tasks: [task] }
      }),
    /AC1 uses \/proof\/loading instead of sealed route \/settings/
  );

  assert.equal(
    validateVisualBehaviorPlan({
      proofKind: "GIF",
      routes: ["/", "/experiment"],
      behaviorContract: {
        ...behaviorContract,
        routes: ["/", "/experiment"],
        checks: [
          {
            id: "AC1",
            statement:
              "An A / B test calls `/api/tasks` and renders on `/experiment`."
          }
        ]
      },
      proofPlan: {
        version: 1,
        tasks: [
          {
            ...task,
            route: "/experiment",
            actions: [
              { type: "navigate", path: "/experiment" },
              { type: "click", selector: "[data-agent-proof='start']" }
            ]
          }
        ]
      }
    }).tasks[0].route,
    "/experiment"
  );
});

test("browser plans cover browser clauses while final proof combines deterministic clauses", () => {
  const behaviorContract = {
    version: 2,
    target: { kind: "web", proofKind: "UI" },
    artifactLanes: ["browser"],
    captureBeforeAction: false,
    contractDigest: "d".repeat(64),
    checks: [
      {
        id: "AC1",
        statement: "The page shows the current state.",
        evidenceLanes: ["browser"]
      },
      {
        id: "AC2",
        statement: "Repository tests pass.",
        evidenceLanes: ["deterministic"]
      }
    ]
  };
  const proofPlan = {
    version: 1,
    tasks: [
      {
        clauseIds: ["AC1"],
        route: "/staff/tasks",
        actions: [],
        intermediateAssertions: [],
        finalAssertions: [{ type: "visible", selector: "main" }]
      }
    ]
  };
  assert.deepEqual(
    validateVisualBehaviorPlan({
      proofKind: "UI",
      routes: ["/staff"],
      behaviorContract,
      proofPlan,
      evidenceLanes: ["deterministic", "browser"]
    }),
    {
      ...proofPlan,
      tasks: [{ ...proofPlan.tasks[0], route: "/staff", session: "none" }]
    }
  );
  assert.throws(
    () =>
      validateVisualBehaviorPlan({
        proofKind: "UI",
        routes: ["/staff"],
        behaviorContract,
        proofPlan: {
          ...proofPlan,
          tasks: [{ ...proofPlan.tasks[0], clauseIds: ["AC2"] }]
        },
        evidenceLanes: ["deterministic", "browser"]
      }),
    /non-browser clause AC2/
  );

  const request = {
    kind: "pr",
    number: 12,
    requested: true,
    proofKind: "UI",
    routes: ["/staff"],
    sha: "a".repeat(40),
    checkoutRef: "a".repeat(40),
    intentDigest: "b".repeat(64),
    behaviorContract,
    proofPlan,
    evidenceLanes: ["deterministic", "browser"]
  };
  const resultFor = (lane, commands) => ({
    proofKind: "UI",
    status: "passed",
    commands,
    artifactPaths: [],
    artifactDigests: [],
    provider: "test",
    leaseId: "",
    summary: `${lane} passed`,
    blocker: "",
    evidenceLanes: [lane],
    behaviorReport: commandBehaviorReport({
      contract: behaviorContract,
      passed: true,
      access: request.sha,
      commands,
      evidenceLanes: [lane]
    })
  });
  const combined = combineProofResults(request, [
    resultFor("browser", ["open /staff/tasks"]),
    resultFor("deterministic", ["npm test"])
  ]);
  assert.equal(combined.status, "passed");
  assert.deepEqual(
    combined.behaviorReport.checks.map((check) => check.status),
    ["pass", "pass"]
  );
  assert.equal(
    combineProofResults(request, [
      resultFor("browser", ["open /staff/tasks"])
    ]).status,
    "failed"
  );
  assert.equal(
    combineProofResults(request, [
      {
        ...resultFor("browser", ["open /staff/tasks"]),
        status: "blocked",
        blocker: "Browser provider unavailable."
      },
      resultFor("deterministic", ["npm test"])
    ]).status,
    "blocked"
  );
});

test("proof preparation failure preserves the primary blocker without request decoding", () => {
  const record = preparationFailureRecord(
    {
      "target-kind": "pr",
      "target-number": "61",
      "status-sha": "a".repeat(40),
      "proof-kind": "GIF"
    },
    new Error(
      "browser proof plan does not cover sealed clauses: AC3, AC5"
    )
  );

  assert.equal(record.proofKind, "GIF");
  assert.equal(record.targetNumber, 61);
  assert.match(record.summary, /does not cover sealed clauses: AC3, AC5/);
  assert.doesNotMatch(record.summary, /base64|JSON/);
  assert.equal(
    preparationFailureRecord(
      {
        "target-kind": "pr",
        "target-number": "61",
        "status-sha": "a".repeat(40),
        "resolved-proof-kind": "GIF"
      },
      new Error("browser plan failed")
    ).proofKind,
    "GIF"
  );
});

test("proof owns a dedicated failure label and never mutates shared policy labels", () => {
  const passing = proofLabelChanges(config, "passed");
  const failing = proofLabelChanges(config, "failed");

  assert.deepEqual(passing, {
    add: [],
    remove: [config.labels.proofFailed],
  });
  assert.deepEqual(failing, {
    add: [config.labels.proofFailed],
    remove: [],
  });
  for (const changes of [passing, failing]) {
    assert.equal(changes.add.includes(config.labels.blocked), false);
    assert.equal(changes.remove.includes(config.labels.blocked), false);
    assert.equal(changes.add.includes(config.labels.automerge), false);
    assert.equal(changes.remove.includes(config.labels.automerge), false);
  }
});

test("passing PR proof clears proof-owned blockers from the PR and source issue", () => {
  assert.deepEqual(
    proofLabelUpdates(
      config,
      { kind: "pr", number: 76, sourceNumber: 42 },
      "passed",
    ),
    [
      {
        number: 76,
        add: [],
        remove: [config.labels.proofFailed],
      },
      {
        number: 42,
        add: [],
        remove: [config.labels.proofFailed],
      },
    ],
  );
  assert.deepEqual(
    proofLabelUpdates(
      config,
      { kind: "pr", number: 76, sourceNumber: 42 },
      "failed",
    ),
    [
      {
        number: 76,
        add: [config.labels.proofFailed],
        remove: [],
      },
    ],
  );
});

test("only exact-head failed behavior proof enters automatic semantic repair", () => {
  const sha = "a".repeat(40);
  const contract = {
    target: { kind: "web", proofKind: "GIF" },
    checks: [
      {
        id: "AC1",
        statement: "The loading state is visible.",
        evidenceLanes: ["browser"]
      }
    ]
  };
  const request = {
    kind: "pr",
    number: 76,
    requested: true,
    sha,
    behaviorContract: contract
  };
  const behaviorReport = commandBehaviorReport({
    contract,
    passed: false,
    access: `pull request #76 head ${sha}`,
    commands: ["Open / before navigation."],
    evidenceLanes: ["browser"]
  });
  const result = { status: "failed", behaviorReport };

  assert.equal(proofRepairEligible(request, result, true), true);
  assert.equal(proofRepairEligible(request, result, false), false);
  assert.equal(
    proofRepairEligible({ ...request, kind: "issue" }, result, true),
    false
  );
  assert.equal(
    proofRepairEligible(request, { ...result, status: "blocked" }, true),
    false
  );
  assert.equal(
    proofRepairEligible(
      request,
      {
        ...result,
        behaviorReport: {
          ...behaviorReport,
          target: {
            ...behaviorReport.target,
            access: `pull request #76 head ${"b".repeat(40)}`
          }
        }
      },
      true
    ),
    false
  );
});

test("proof comments link the trusted Actions artifact and collapse runner-only paths", () => {
  const artifactUrl = "https://github.com/sandeepsalwan1/Vet/actions/runs/123/artifacts/456";
  const result = {
    proofKind: "GIF",
    status: "passed",
    commands: ["npm run build"],
    artifactPaths: ["/home/runner/work/Vet/Vet/trusted/.agent-output/screen.trimmed.gif"],
    artifactUrl,
    provider: "local-container",
    leaseId: "cbx_123",
    summary: "Capture completed.",
    blocker: ""
  };
  const body = proofBody(result, ["/"], { totalMs: 10, commandMs: 5 });

  assert.equal(validateArtifactUrl(artifactUrl, { repo: { owner: "sandeepsalwan1", name: "Vet" } }), artifactUrl);
  assert.match(body, new RegExp(`\\[Open reviewer GIF/video proof bundle\\]\\(${artifactUrl}\\)`));
  assert.match(body, /<summary>Runner artifact inventory<\/summary>/);
  assert.ok(body.includes("`/home/runner/work/Vet"));
  assert.throws(
    () =>
      validateArtifactUrl("https://example.com/actions/runs/123/artifacts/456", {
        repo: { owner: "sandeepsalwan1", name: "Vet" }
      }),
    /outside the trusted GitHub Actions run/
  );
});

test("failed proof media is labeled as diagnostic instead of reviewer proof", () => {
  const artifactUrl = "https://github.com/sandeepsalwan1/Vet/actions/runs/123/artifacts/456";
  const body = proofBody(
    {
      proofKind: "GIF",
      status: "failed",
      commands: [],
      artifactPaths: [],
      artifactUrl,
      provider: "vercel-sandbox",
      leaseId: "cbx_failed",
      summary: "Browser assertions failed.",
      blocker: "Session was not retained."
    },
    ["/staff/tasks"],
    null
  );

  assert.match(body, new RegExp(`\\[Open failed capture and diagnostics\\]\\(${artifactUrl}\\)`));
  assert.match(body, /does not prove acceptance/);
  assert.doesNotMatch(body, /Open reviewer GIF\/video proof bundle/);
});

test("published GIF proof is downloaded, digest-bound, exact-head, and playable", (t) => {
  const root = mkdtempSync(join(tmpdir(), "vet-published-proof-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bundle = join(root, "bundle");
  mkdirSync(bundle);
  const log = join(root, "crabbox-gifProof.log");
  const gif = join(bundle, "screen.trimmed.gif");
  const video = join(bundle, "screen.trimmed.mp4");
  const firstRoute = join(root, "route-root");
  const secondRoute = join(root, "route-proof-loading");
  mkdirSync(firstRoute);
  mkdirSync(secondRoute);
  const firstBinding = join(firstRoute, "route-binding.json");
  const secondBinding = join(secondRoute, "route-binding.json");
  const sha = "a".repeat(40);
  writeFileSync(log, `AGENT_PROOF_HEAD_OK ${sha}\n`);
  writeFileSync(gif, "GIF89a-reviewable");
  writeFileSync(video, Buffer.concat([Buffer.alloc(4), Buffer.from("ftypisom")]));
  writeFileSync(firstBinding, '{"route":"/"}');
  writeFileSync(secondBinding, '{"route":"/proof/loading"}');
  const digest = (path) =>
    createHash("sha256").update(readFileSync(path)).digest("hex");
  const behaviorContract = {
    version: 3,
    target: { kind: "web", proofKind: "GIF" },
    artifactLanes: ["browser"],
    captureBeforeAction: true,
    contractDigest: "d".repeat(64),
    checks: [
      {
        id: "AC1",
        statement: "The loading transition is visible.",
        evidenceLanes: ["browser"]
      }
    ]
  };
  const request = {
    kind: "pr",
    number: 67,
    requested: true,
    proofKind: "GIF",
    routes: ["/proof/loading"],
    sha,
    checkoutRef: sha,
    intentDigest: "b".repeat(64),
    behaviorContract,
    proofPlan: {
      version: 1,
      tasks: [
        {
          clauseIds: ["AC1"],
          route: "/proof/loading",
          actions: [
            { type: "navigate", path: "/proof/loading" },
            { type: "click", selector: "[data-agent-proof='start']" }
          ],
          intermediateAssertions: [
            { type: "visible", selector: "[data-agent-proof='opening']" }
          ],
          finalAssertions: [
            { type: "visible", selector: "[data-agent-proof='signin']" }
          ]
        }
      ]
    },
    evidenceLanes: ["browser"]
  };
  const result = {
    proofKind: "GIF",
    status: "passed",
    commands: ["open /proof/loading"],
    artifactPaths: [log, gif, video, firstBinding, secondBinding],
    artifactUrl: "",
    artifactDigests: [
      { name: "crabbox-gifProof.log", sha256: digest(log) },
      { name: "bundle/screen.trimmed.gif", sha256: digest(gif) },
      { name: "bundle/screen.trimmed.mp4", sha256: digest(video) },
      { name: "route-root/route-binding.json", sha256: digest(firstBinding) },
      {
        name: "route-proof-loading/route-binding.json",
        sha256: digest(secondBinding)
      }
    ],
    provider: "test",
    leaseId: "test-lease",
    summary: "Browser behavior passed.",
    blocker: "",
    evidenceLanes: ["browser"],
    behaviorReport: commandBehaviorReport({
      contract: behaviorContract,
      passed: true,
      access: `pull request #67 head ${sha}`,
      commands: ["open /proof/loading"],
      evidenceLanes: ["browser"]
    })
  };
  const remoteOutcome = { terminal: true, result, timing: null };
  const probe = (_path, kind) => ({
    codec: kind === "gif" ? "gif" : "h264",
    width: 1280,
    height: 720,
    frames: kind === "gif" ? 12 : 24,
    durationSeconds: 2
  });

  const outcome = validatePublishedMedia({
    request,
    remoteOutcome,
    artifactDir: root,
    probe
  });

  assert.equal(outcome.status, "passed");
  assert.equal(outcome.headSha, sha);
  assert.deepEqual(
    outcome.files.map((file) => file.kind).sort(),
    ["gif", "video"]
  );
  assert.equal(
    validatePublishedMediaOutcome(outcome, request, result),
    outcome
  );

  writeFileSync(gif, "GIF89a-tampered");
  assert.throws(
    () =>
      validatePublishedMedia({
        request,
        remoteOutcome,
        artifactDir: root,
        probe
      }),
    /digest mismatch/
  );
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
        githubPublisher: "AGENT_GITHUB_TOKEN",
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
      AGENT_GITHUB_TOKEN: "publisher",
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
  const taskBoardPlan = {
    version: 1,
    tasks: [{
      actions: [],
      intermediateAssertions: [],
      finalAssertions: [{
        type: "visible",
        selector: "[data-agent-proof='task-board-lanes']"
      }]
    }]
  };
  const command = visualServerCommand(
    { commands: { install: "npm ci", build: "npm run build" } },
    ["/request", "/staff"],
    { proofPlan: taskBoardPlan }
  );

  assert.match(command, /http:\/\/127\.0\.0\.1:3000\/request/);
  assert.match(command, /http:\/\/127\.0\.0\.1:3000\/staff/);
  assert.match(command, /AGENT_PROOF_ROUTE_OK \/request/);
  assert.match(command, /AGENT_PROOF_ROUTE_OK \/staff/);
  assert.match(command, /AGENT_PROOF_FIXTURES=task-board/);
  assert.match(command, /%\{http_code\}/);
  assert.match(command, /2\?\?/);
  assert.equal(command.includes(" -L"), false);
  assert.equal(command.includes("then exit 0"), false);

  const requestOnlyCommand = visualServerCommand(
    { commands: { install: "npm ci", build: "npm run build" } },
    ["/request"]
  );
  assert.equal(requestOnlyCommand.includes("AGENT_PROOF_FIXTURES"), false);

  const staffSettingsCommand = visualServerCommand(
    { commands: { install: "npm ci", build: "npm run build" } },
    ["/staff"],
    {
      proofPlan: {
        version: 1,
        tasks: [{
          actions: [{
            type: "click",
            selector: "[data-agent-proof='settings-open']"
          }],
          intermediateAssertions: [],
          finalAssertions: [{ type: "visible", selector: "main" }]
        }]
      }
    }
  );
  assert.equal(staffSettingsCommand.includes("AGENT_PROOF_FIXTURES"), false);
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

  const failedOutcome = {
    terminal: true,
    result: {
      ...forged.result,
      status: "failed",
      summary: "npm run build failed",
      blocker: "npm run build exited unsuccessfully"
    }
  };
  const failed = resolveTerminalResult({
    request,
    remoteOutcome: null,
    remoteJobResult: "failure",
    localOutcome: failedOutcome,
    localJobResult: "failure"
  });
  assert.equal(failed.status, "failed");
  assert.match(failed.blocker, /npm run build exited unsuccessfully/);
});

test("service proof requires both disposable checks and trusted Blueprint validation", () => {
  const agentConfig = JSON.parse(
    readFileSync(new URL("../.agent/config.json", import.meta.url), "utf8")
  );
  assert.deepEqual(agentConfig.commands.serviceProof.slice(0, 3), [
    "npm ci --ignore-scripts --no-audit --no-fund",
    "npm run db:migrate",
    "AGENT_DISPOSABLE_DATABASE=1 npm run db:proof"
  ]);

  const request = {
    kind: "pr",
    number: 12,
    requested: true,
    proofKind: "service",
    routes: [],
    sha: "a".repeat(40),
    checkoutRef: "a".repeat(40)
  };
  const serviceOutcome = {
    terminal: true,
    result: {
      proofKind: "service",
      status: "passed",
      commands: ["npm run db:migrate", "npm run build"],
      artifactPaths: [],
      artifactDigests: [],
      provider: "github-actions",
      leaseId: "",
      summary: "service proof passed",
      blocker: ""
    }
  };
  const passing = resolveTerminalResult({
    request,
    remoteOutcome: null,
    remoteJobResult: "skipped",
    localOutcome: null,
    localJobResult: "skipped",
    serviceOutcome,
    serviceJobResult: "success",
    serviceConfigJobResult: "success"
  });
  assert.equal(passing.status, "passed");

  const failed = resolveTerminalResult({
    request,
    remoteOutcome: null,
    remoteJobResult: "skipped",
    localOutcome: null,
    localJobResult: "skipped",
    serviceOutcome,
    serviceJobResult: "success",
    serviceConfigJobResult: "failure"
  });
  assert.equal(failed.status, "failed");
  assert.match(failed.summary, /Blueprint/);

  const commandFailure = resolveTerminalResult({
    request,
    remoteOutcome: null,
    remoteJobResult: "skipped",
    localOutcome: null,
    localJobResult: "skipped",
    serviceOutcome: {
      terminal: true,
      result: {
        ...serviceOutcome.result,
        status: "failed",
        summary: "npm run db:migrate failed",
        blocker: "npm run db:migrate exited unsuccessfully"
      }
    },
    serviceJobResult: "failure",
    serviceConfigJobResult: "success"
  });
  assert.equal(commandFailure.status, "failed");
  assert.match(
    commandFailure.blocker,
    /npm run db:migrate exited unsuccessfully/
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
  const crabboxAction = readFileSync(
    new URL("../.github/actions/setup-crabbox/action.yml", import.meta.url),
    "utf8"
  );
  const finalizeJob = workflow.slice(workflow.indexOf("\n  finalize:"));
  const statusIndex = workflow.indexOf("gh api \"repos/$GITHUB_REPOSITORY/statuses/$STATUS_SHA\"");
  const blockerIndex = workflow.indexOf("name: Reconcile terminal proof blocker");
  const repairIndex = workflow.indexOf("gh workflow run agent-review.yml");
  const recoveryIndex = workflow.indexOf("name: Reconcile review after proof recovery");
  const dispatchIndex = workflow.indexOf("gh workflow run agent-automerge.yml");

  assert.ok(statusIndex >= 0);
  assert.ok(blockerIndex > statusIndex);
  assert.ok(repairIndex > statusIndex);
  assert.ok(recoveryIndex > statusIndex);
  assert.ok(dispatchIndex > statusIndex);
  assert.match(
    workflow.slice(recoveryIndex, dispatchIndex),
    /select\(\.context == "agent-review" and \.creator\.login == "github-actions\[bot\]"\)/
  );
  assert.match(
    workflow.slice(recoveryIndex, dispatchIndex),
    /test "\$current_sha" = "\$STATUS_SHA"/
  );
  assert.match(
    workflow.slice(recoveryIndex, dispatchIndex),
    /if \[ "\$review_state" != failure \]/
  );
  assert.match(
    workflow.slice(recoveryIndex, dispatchIndex),
    /-f expected-head-sha="\$STATUS_SHA"/
  );
  assert.match(finalizeJob, /pull-requests: write/);
  assert.match(workflow, /uses: \.\/trusted\/\.github\/actions\/setup-crabbox/);
  assert.match(workflow, /name: disposable service proof/);
  assert.match(
    workflow,
    /image: pgvector\/pgvector:0\.8\.5-pg17@sha256:[a-f0-9]{64}/
  );
  assert.match(workflow, /create role anon nologin/);
  assert.match(workflow, /create role authenticated nologin/);
  assert.match(workflow, /--execute-service/);
  assert.match(workflow, /name: verify published media/);
  assert.match(workflow, /proof_passed: \$\{\{ steps\.remote\.outputs\.proof_passed \}\}/);
  assert.match(workflow, /needs\.remote\.outputs\.proof_passed == 'true'/);
  assert.match(workflow, /uses: actions\/download-artifact@v4/);
  assert.match(
    workflow,
    /sudo apt-get install -y --no-install-recommends ffmpeg/
  );
  assert.match(workflow, /ffprobe -version/);
  assert.match(workflow, /--verify-published-media/);
  assert.match(
    finalizeJob,
    /--published-media-job-result "\$PUBLISHED_MEDIA_JOB_RESULT"/
  );
  assert.match(workflow, /needs\.prepare\.outputs\.needs_remote == 'true'/);
  assert.match(workflow, /needs\.prepare\.outputs\.needs_service == 'true'/);
  assert.match(workflow, /needs\.prepare\.outputs\.needs_browser != 'true'/);
  assert.match(workflow, /--failure-output failure_b64/);
  assert.match(finalizeJob, /PREPARE_JOB_RESULT: \$\{\{ needs\.prepare\.result \}\}/);
  assert.match(finalizeJob, /--finalize-prepare-failure/);
  assert.match(finalizeJob, /--prepare-failure-base64 "\$PREPARE_FAILURE_B64"/);
  assert.match(
    finalizeJob,
    /if \[ "\$NEEDS_BROWSER" != true \] && \[ -z "\$artifact_url" \]; then/
  );
  assert.doesNotMatch(
    finalizeJob,
    /needs\.remote\.outputs\.artifact_url \|\| needs\.service\.outputs\.artifact_url/
  );
  assert.ok(
    finalizeJob.indexOf("--finalize-prepare-failure") <
      finalizeJob.indexOf("--request-base64")
  );
  assert.match(workflow, /uses: \.\/trusted\/\.github\/actions\/setup-render/);
  assert.match(workflow, /RENDER_WORKSPACE_ID: \$\{\{ secrets\.RENDER_WORKSPACE_ID \}\}/);
  assert.match(workflow, /render workspace set "\$RENDER_WORKSPACE_ID"/);
  assert.match(workflow, /agent-render-blueprint\.mjs/);
  assert.match(crabboxAction, /v0\.40\.0/);
  assert.match(crabboxAction, /crabbox_0\.40\.0_linux_amd64\.tar\.gz/);
  assert.doesNotMatch(`${workflow}\n${crabboxAction}`, /0\.38\.4/);
  assert.match(workflow, /steps\.terminal\.outputs\.state == 'success'/);
  assert.match(
    finalizeJob,
    /\(inputs\.target-kind == 'pr' &&\s+steps\.terminal\.outputs\.state != 'success'\)/
  );
  assert.match(
    finalizeJob,
    /\(inputs\.target-kind == 'issue' &&\s+steps\.finalize\.outcome != 'success'\)/
  );
  assert.match(finalizeJob, /expected_sha="\$\{STATUS_SHA:-\$REQUESTED_HEAD_SHA\}"/);
  assert.match(finalizeJob, /test "\$current_sha" = "\$expected_sha"/);
  assert.match(finalizeJob, /--add-label agent:proof-failed/);
  assert.match(workflow, /artifact_url: \$\{\{ steps\.artifact\.outputs\.artifact-url \}\}/);
  assert.match(workflow, /--artifact-url "\$artifact_url"/);
  assert.match(finalizeJob, /--cost-outcome-file "\$COST_OUTCOME_FILE"/);
  assert.match(finalizeJob, /--proof-outcome-file "\$COST_OUTCOME_FILE"/);
  assert.match(finalizeJob, /steps\.terminal\.outputs\.proof_status == 'passed'/);
  assert.match(finalizeJob, /steps\.finalize\.outputs\.repair-eligible == 'true'/);
  assert.match(finalizeJob, /test "\$current_sha" = "\$STATUS_SHA"/);
  assert.match(finalizeJob, /gh workflow run agent-review\.yml/);
  assert.match(finalizeJob, /-f expected-head-sha="\$STATUS_SHA"/);
  assert.match(finalizeJob, /-f repair-attempt=1/);
  assert.doesNotMatch(finalizeJob, /--proof-(remote|local)-outcome-base64/);
});
