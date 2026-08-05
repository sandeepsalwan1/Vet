import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  IMPLEMENTATION_ADDENDUM_MARKER,
  INTENT_CAPSULE_VERSION,
  browserProofRequirements,
  clauseEvidenceLanes,
  createIntentCapsule,
  createIntentCapsuleVersion,
  implementationAddendumEnvelope,
  intentCapsuleForManagedTriage,
  parseImplementationAddendum,
  parseIssueSections,
  parseManagedTriageDecision,
  validateBrowserProofPlan,
  validateImplementationResult,
  validateIntentCapsule,
  validateProofPlan
} from "./agent-intent.mjs";

function issue(overrides = {}) {
  return {
    number: 42,
    title: "Add a bounded status panel",
    body: `### Outcome

Staff can see the automation state.

### Plan or context

Use the existing admin shell.

### Acceptance criteria

- [ ] Show the current state
- [ ] Keep tenant data isolated

### Proof

UI screenshots through Crabbox

### Proof route

/staff/tasks

### Proof interaction

- Open the staff task board
- Observe the current automation state

### Constraints

- Do not expose private findings.

### Conversation intent summary

Keep one managed status surface.

### Conversation source digest

${"a".repeat(64)}`,
    labels: [{ name: "agent:implement" }],
    ...overrides
  };
}

function decision(overrides = {}) {
  return {
    value: "medium",
    priority: "medium",
    risk: "medium",
    alignment: "yes",
    implementationScope: "Add and verify the bounded status panel.",
    proofNeeded: "UI",
    automationDecision: "implement",
    humanQuestion: "",
    ...overrides
  };
}

function clarification(commentId, body) {
  return {
    commentId,
    body,
    sha256: createHash("sha256").update(body).digest("hex")
  };
}

test("issue sections preserve bounded form intent", () => {
  const sections = parseIssueSections(issue().body);

  assert.equal(sections.outcome, "Staff can see the automation state.");
  assert.match(sections["acceptance criteria"], /Keep tenant data isolated/);
  assert.equal(sections["conversation source digest"], "a".repeat(64));
});

test("intent capsule binds issue, requirements, clarifications, transcript, and policy", () => {
  const capsule = createIntentCapsule({
    issue: issue(),
    decision: decision(),
    ownerClarifications: [clarification(55, "Keep the panel concise.")]
  });

  assert.equal(validateIntentCapsule(capsule), capsule);
  assert.deepEqual(capsule.acceptanceCriteria, [
    "Show the current state",
    "Keep tenant data isolated"
  ]);
  assert.deepEqual(capsule.explicitExclusions, ["Do not expose private findings."]);
  assert.equal(capsule.transcriptContext.sourceDigest, "a".repeat(64));
  assert.equal(capsule.ownerClarifications[0].commentId, 55);
  assert.equal(capsule.version, INTENT_CAPSULE_VERSION);
  assert.deepEqual(capsule.behaviorContract.routes, ["/staff/tasks"]);
  assert.deepEqual(
    capsule.behaviorContract.checks.map((check) => check.id),
    ["AC1", "AC2"]
  );
  assert.equal(capsule.behaviorContract.target.kind, "web");
  assert.equal(capsule.behaviorContract.version, 3);
  assert.deepEqual(capsule.behaviorContract.artifactLanes, ["browser"]);
  assert.deepEqual(
    capsule.behaviorContract.checks.map((check) => check.evidenceLanes),
    [["browser"], ["service"]]
  );
  assert.match(capsule.behaviorContract.contractDigest, /^[a-f0-9]{64}$/);
});

test("acceptance clauses select direct evidence without forcing every UI clause into a browser", () => {
  assert.deepEqual(
    clauseEvidenceLanes("Show the real clinic-opening copy on the page", "GIF"),
    ["browser"]
  );
  assert.deepEqual(
    clauseEvidenceLanes("Show the loading transition before the page settles", "GIF"),
    ["browser"]
  );
  assert.deepEqual(
    clauseEvidenceLanes("Browser proof uses only the local app and no production data", "GIF"),
    ["deterministic", "browser"]
  );
  assert.deepEqual(
    clauseEvidenceLanes("Existing repository tests continue to pass", "GIF"),
    ["deterministic"]
  );
  assert.deepEqual(
    clauseEvidenceLanes(
      "The proof route returns not found unless the request host is localhost",
      "GIF"
    ),
    ["deterministic"]
  );
  assert.deepEqual(
    clauseEvidenceLanes(
      "The proof route returns not found unless the request host is localhost",
      "GIF",
      2
    ),
    ["deterministic", "browser"]
  );
});

test("browser proof requirements expose only allowed clauses and sealed routes", () => {
  const capsule = createIntentCapsule({
    issue: issue({
      body: `### Outcome
Show the real clinic-opening transition.

### Acceptance criteria

- [ ] Show the real opening panel.
- [ ] \`/proof/loading\` reaches the sign-in screen.
- [ ] The proof route returns not found unless the host is localhost.
- [ ] Normal \`/\` navigation keeps its current timing.
- [ ] Repository tests pass.

### Proof route

/
/proof/loading`
    }),
    decision: decision({ proofNeeded: "GIF" })
  });

  assert.deepEqual(
    browserProofRequirements({
      proofKind: "GIF",
      behaviorContract: capsule.behaviorContract
    }),
    [
      { clauseId: "AC1", requiredRoutes: [] },
      {
        clauseId: "AC2",
        requiredRoutes: ["/proof/loading"]
      },
      { clauseId: "AC4", requiredRoutes: ["/"] }
    ]
  );
});

test("version 4 intent capsules retain their original evidence classification", () => {
  const sourceIssue = issue({
    body: `### Outcome

The loading proof remains local.

### Acceptance criteria

- [ ] The proof route returns not found unless the request host is localhost.

### Proof

GIF

### Proof route

/proof/loading`
  });
  const sourceDecision = decision({ proofNeeded: "GIF" });
  const capsule = createIntentCapsuleVersion({
    issue: sourceIssue,
    decision: sourceDecision,
    version: 4
  });

  assert.equal(capsule.version, 4);
  assert.equal(capsule.behaviorContract.version, 2);
  assert.deepEqual(capsule.behaviorContract.checks[0].evidenceLanes, [
    "deterministic",
    "browser"
  ]);
  assert.equal(validateIntentCapsule(capsule), capsule);
  const managedDecision = {
    ...sourceDecision,
    issueSnapshotSha256: capsule.issueSnapshotSha256,
    ownerClarifications: [],
    intentDigest: capsule.intentDigest
  };
  const triageComment = {
    body: `<!-- agent-triage:v1 -->
\`\`\`json
${JSON.stringify(managedDecision)}
\`\`\``
  };
  assert.equal(
    intentCapsuleForManagedTriage({
      issue: sourceIssue,
      comments: [triageComment],
      triageComment,
      marker: "<!-- agent-triage:v1 -->",
      repoOwner: "owner"
    }).capsule.version,
    4
  );
});

test("intent digest changes with owner clarification or policy", () => {
  const base = createIntentCapsule({ issue: issue(), decision: decision() });
  const clarified = createIntentCapsule({
    issue: issue(),
    decision: decision(),
    ownerClarifications: [clarification(55, "Use a compact card.")]
  });
  const higherRisk = createIntentCapsule({
    issue: issue(),
    decision: decision({ risk: "high" })
  });

  assert.notEqual(base.intentDigest, clarified.intentDigest);
  assert.notEqual(base.intentDigest, higherRisk.intentDigest);
});

test("proof result labels do not mutate sealed source intent", () => {
  const sourceIssue = issue({
    labels: [{ name: "agent:proof" }, { name: "agent:automerge" }]
  });
  const sealed = createIntentCapsule({
    issue: sourceIssue,
    decision: decision({ proofNeeded: "GIF" })
  });
  const afterFailure = createIntentCapsule({
    issue: {
      ...sourceIssue,
      labels: [...sourceIssue.labels, { name: "agent:proof-failed" }]
    },
    decision: decision({ proofNeeded: "GIF" })
  });

  assert.equal(afterFailure.intentDigest, sealed.intentDigest);
  assert.deepEqual(afterFailure.sourceLabels, sealed.sourceLabels);
});

test("managed intent reconstruction preserves legacy v5 proof-result labels", () => {
  const sourceIssue = issue({
    labels: [
      { name: "agent:proof" },
      { name: "agent:automerge" },
      { name: "agent:proof-failed" }
    ]
  });
  const sourceDecision = decision({ proofNeeded: "GIF" });
  const legacy = createIntentCapsuleVersion({
    issue: sourceIssue,
    decision: sourceDecision,
    version: 5
  });
  const managedDecision = {
    ...sourceDecision,
    issueSnapshotSha256: legacy.issueSnapshotSha256,
    ownerClarifications: [],
    intentDigest: legacy.intentDigest
  };
  const triageComment = {
    body: `<!-- agent-triage:v1 -->
\`\`\`json
${JSON.stringify(managedDecision)}
\`\`\``
  };

  assert.deepEqual(legacy.sourceLabels, [
    "agent:automerge",
    "agent:proof",
    "agent:proof-failed"
  ]);
  assert.equal(
    intentCapsuleForManagedTriage({
      issue: sourceIssue,
      comments: [triageComment],
      triageComment,
      marker: "<!-- agent-triage:v1 -->",
      repoOwner: "owner"
    }).capsule.version,
    5
  );
});

test("managed intent reconstruction tolerates proof failure after a v5 seal", () => {
  const sealedIssue = issue({
    labels: [{ name: "agent:proof" }, { name: "agent:automerge" }]
  });
  const sourceDecision = decision({ proofNeeded: "GIF" });
  const legacy = createIntentCapsuleVersion({
    issue: sealedIssue,
    decision: sourceDecision,
    version: 5
  });
  const managedDecision = {
    ...sourceDecision,
    issueSnapshotSha256: legacy.issueSnapshotSha256,
    ownerClarifications: [],
    intentDigest: legacy.intentDigest
  };
  const triageComment = {
    body: `<!-- agent-triage:v1 -->
\`\`\`json
${JSON.stringify(managedDecision)}
\`\`\``
  };

  assert.equal(
    intentCapsuleForManagedTriage({
      issue: {
        ...sealedIssue,
        labels: [...sealedIssue.labels, { name: "agent:proof-failed" }]
      },
      comments: [triageComment],
      triageComment,
      marker: "<!-- agent-triage:v1 -->",
      repoOwner: "owner"
    }).capsule.version,
    5
  );
});

test("managed intent reconstruction tolerates proof recovery after a v5 seal", () => {
  const failedIssue = issue({
    labels: [
      { name: "agent:proof" },
      { name: "agent:automerge" },
      { name: "agent:proof-failed" }
    ]
  });
  const sourceDecision = decision({ proofNeeded: "GIF" });
  const legacy = createIntentCapsuleVersion({
    issue: failedIssue,
    decision: sourceDecision,
    version: 5
  });
  const managedDecision = {
    ...sourceDecision,
    issueSnapshotSha256: legacy.issueSnapshotSha256,
    ownerClarifications: [],
    intentDigest: legacy.intentDigest
  };
  const triageComment = {
    body: `<!-- agent-triage:v1 -->
\`\`\`json
${JSON.stringify(managedDecision)}
\`\`\``
  };

  assert.equal(
    intentCapsuleForManagedTriage({
      issue: {
        ...failedIssue,
        labels: failedIssue.labels.filter(
          ({ name }) => name !== "agent:proof-failed"
        )
      },
      comments: [triageComment],
      triageComment,
      marker: "<!-- agent-triage:v1 -->",
      repoOwner: "owner"
    }).capsule.version,
    5
  );
});

test("legacy implement cleanup composes with proof-result label drift", () => {
  const sealedIssue = issue({
    labels: [
      { name: "agent:implement" },
      { name: "agent:proof" },
      { name: "agent:automerge" }
    ]
  });
  const sourceDecision = decision({
    automationDecision: "implement",
    proofNeeded: "GIF"
  });
  const legacy = createIntentCapsuleVersion({
    issue: sealedIssue,
    decision: sourceDecision,
    version: 2
  });
  const managedDecision = {
    ...sourceDecision,
    issueSnapshotSha256: legacy.issueSnapshotSha256,
    ownerClarifications: [],
    intentDigest: legacy.intentDigest
  };
  const triageComment = {
    body: `<!-- agent-triage:v1 -->
\`\`\`json
${JSON.stringify(managedDecision)}
\`\`\``
  };

  assert.equal(
    intentCapsuleForManagedTriage({
      issue: {
        ...sealedIssue,
        labels: [
          { name: "agent:proof" },
          { name: "agent:automerge" },
          { name: "agent:proof-failed" }
        ]
      },
      comments: [triageComment],
      triageComment,
      marker: "<!-- agent-triage:v1 -->",
      repoOwner: "owner"
    }).capsule.version,
    2
  );
});

test("managed triage parser requires one exact capsule-bound decision", () => {
  const capsule = createIntentCapsule({ issue: issue(), decision: decision() });
  const managed = {
    ...decision(),
    issueSnapshotSha256: capsule.issueSnapshotSha256,
    ownerClarifications: [],
    intentDigest: capsule.intentDigest
  };
  const comment = {
    body: `<!-- agent-triage:v1 -->

\`\`\`json
${JSON.stringify(managed)}
\`\`\``
  };

  assert.deepEqual(
    parseManagedTriageDecision(comment, "<!-- agent-triage:v1 -->"),
    managed
  );
  assert.throws(
    () =>
      parseManagedTriageDecision(
        { body: `${comment.body}\n\n\`\`\`json\n{}\n\`\`\`` },
        "<!-- agent-triage:v1 -->"
      ),
    /exactly one decision/
  );
});

test("managed intent reconstruction rejects changed owner clarification text", () => {
  const ownerClarifications = [clarification(55, "Keep the panel concise.")];
  const capsule = createIntentCapsule({
    issue: issue(),
    decision: decision(),
    ownerClarifications
  });
  const managed = {
    ...decision(),
    issueSnapshotSha256: capsule.issueSnapshotSha256,
    ownerClarifications: ownerClarifications.map(({ commentId, sha256 }) => ({
      commentId,
      sha256
    })),
    intentDigest: capsule.intentDigest
  };
  const triageComment = {
    body: `<!-- agent-triage:v1 -->\n\`\`\`json\n${JSON.stringify(managed)}\n\`\`\``
  };
  const comments = [
    {
      database_id: 55,
      user: { login: "owner" },
      body: "Keep the panel concise."
    }
  ];

  assert.equal(
    intentCapsuleForManagedTriage({
      issue: issue(),
      comments,
      triageComment,
      marker: "<!-- agent-triage:v1 -->",
      repoOwner: "owner"
    }).capsule.intentDigest,
    capsule.intentDigest
  );
  assert.throws(
    () =>
      intentCapsuleForManagedTriage({
        issue: issue(),
        comments: [{ ...comments[0], body: "Changed later." }],
        triageComment,
        marker: "<!-- agent-triage:v1 -->",
        repoOwner: "owner"
      }),
    /missing or changed/
  );
});

test("implementation result carries one bounded digest-verified intent addendum", () => {
  const result = {
    version: 1,
    summary: "Added the bounded status panel.",
    changes: ["Added the panel.", "Kept the existing admin shell."],
    checks: ["npm run typecheck passed."],
    intentAddendum: {
      decisions: ["Reused the existing status card."],
      assumptions: ["The admin shell remains the intended surface."],
      scopeClarifications: ["No public flow changed."],
      verificationDecisions: ["Used the existing scenario test."],
      proofPlan: {
        version: 1,
        tasks: [
          {
            clauseIds: ["AC1"],
            route: "/staff/tasks",
            actions: [{ type: "click", selector: "[data-agent-proof='refresh']" }],
            intermediateAssertions: [
              { type: "visible", selector: "[data-agent-proof-state='loading']" }
            ],
            finalAssertions: [
              {
                type: "text",
                selector: "[data-agent-proof-state='complete']",
                value: "Current"
              }
            ]
          }
        ]
      },
      unresolvedQuestions: []
    }
  };
  const validated = validateImplementationResult(result);
  const envelope = implementationAddendumEnvelope(validated);
  const body = `${IMPLEMENTATION_ADDENDUM_MARKER}
Implementation intent addendum:
\`\`\`json
${JSON.stringify(envelope)}
\`\`\``;

  assert.deepEqual(parseImplementationAddendum(body), envelope);
  assert.throws(
    () =>
      parseImplementationAddendum(
        body.replace(envelope.digest, "f".repeat(64))
      ),
    /digest does not match/
  );
  const legacyEnvelope = {
    version: 1,
    intentAddendum: result.intentAddendum,
    digest: createHash("sha256")
      .update(JSON.stringify(result.intentAddendum))
      .digest("hex")
  };
  const legacyBody = `${IMPLEMENTATION_ADDENDUM_MARKER}
Implementation intent addendum:
\`\`\`json
${JSON.stringify(legacyEnvelope)}
\`\`\``;
  const normalizedLegacy = parseImplementationAddendum(legacyBody);

  assert.equal(normalizedLegacy.digest, legacyEnvelope.digest);
  assert.equal(
    normalizedLegacy.intentAddendum.proofPlan.tasks[0].session,
    "none"
  );
});

test("proof plan rejects unsafe routes and unbounded waits", () => {
  const base = {
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

  assert.deepEqual(validateProofPlan(base), {
    ...base,
    tasks: [{ ...base.tasks[0], session: "none" }]
  });
  assert.deepEqual(
    validateProofPlan({
      version: 1,
      tasks: [{ ...base.tasks[0], clauseIds: [] }]
    }).tasks[0].clauseIds,
    []
  );
  assert.deepEqual(
    validateProofPlan({
      ...base,
      tasks: [
        {
          ...base.tasks[0],
          actions: [{ type: "navigate", path: "//localhost/staff/tasks" }]
        }
      ]
    }).tasks[0].actions,
    [{ type: "navigate", path: "/staff/tasks" }]
  );
  assert.throws(
    () =>
      validateProofPlan({
        ...base,
        tasks: [{ ...base.tasks[0], route: "https://example.com" }]
      }),
    /proof route is invalid/
  );
  assert.throws(
    () =>
      validateProofPlan({
        ...base,
        tasks: [
          {
            ...base.tasks[0],
            actions: [{ type: "navigate", path: "//example.com/staff/tasks" }]
          }
        ]
      }),
    /proof action path is invalid/
  );
  assert.throws(
    () =>
      validateProofPlan({
        ...base,
        tasks: [
          {
            ...base.tasks[0],
            actions: [{ type: "wait", milliseconds: 60_000 }]
          }
        ]
      }),
    /proof wait is invalid/
  );
  assert.throws(
    () =>
      validateProofPlan({
        version: 1,
        tasks: [
          {
            clauseIds: ["AC1"],
            route: "/staff/tasks",
            actions: [{ type: "press", key: "." }],
            intermediateAssertions: [],
            finalAssertions: []
          }
        ]
      }),
    /proof key is unsupported/
  );
});

test("browser proof plans declare protected sessions and executable interactions", () => {
  const behaviorContract = {
    target: { kind: "web" },
    captureBeforeAction: true,
    checks: [
      {
        id: "AC1",
        statement: "Saving settings shows sparkles.",
        evidenceLanes: ["browser"]
      }
    ]
  };
  const task = {
    clauseIds: ["AC1"],
    route: "/staff",
    session: "demo-admin",
    actions: [
      { type: "navigate", path: "/staff" },
      { type: "clickText", selector: "button", value: "Notifications" },
      {
        type: "click",
        selector: "button[role='switch'][aria-label='Appointment confirmation']"
      },
      { type: "clickText", selector: "button", value: "Save changes" }
    ],
    intermediateAssertions: [
      { type: "visible", selector: "[data-agent-proof='mini-confetti']" }
    ],
    finalAssertions: [
      { type: "text", selector: "[aria-live='polite']", value: "All changes saved." }
    ]
  };

  assert.deepEqual(
    validateBrowserProofPlan({
      proofKind: "GIF",
      routes: ["/staff"],
      behaviorContract,
      proofPlan: { version: 1, tasks: [task] }
    }).tasks[0],
    task
  );
  assert.throws(
    () =>
      validateBrowserProofPlan({
        proofKind: "GIF",
        routes: ["/staff"],
        behaviorContract,
        proofPlan: {
          version: 1,
          tasks: [{ ...task, session: "none" }]
        }
      }),
    /must declare a demo staff session/
  );
  assert.throws(
    () =>
      validateBrowserProofPlan({
        proofKind: "GIF",
        routes: ["/staff"],
        behaviorContract,
        proofPlan: {
          version: 1,
          tasks: [
            {
              ...task,
              actions: [
                { type: "navigate", path: "/staff" },
                { type: "clickText", selector: "button", value: "Save changes" }
              ]
            }
          ]
        }
      }),
    /without first changing a form control/
  );
  assert.throws(
    () =>
      validateBrowserProofPlan({
        proofKind: "GIF",
        routes: ["/staff"],
        behaviorContract,
        proofPlan: {
          version: 1,
          tasks: [
            {
              ...task,
              actions: [{ type: "navigate", path: "/staff" }]
            }
          ]
        }
      }),
    /has no user trigger action/
  );
  for (const selector of [
    "button:has-text('Notifications')",
    "button:text('Notifications')",
    "button:text-is('Notifications')",
    "button:contains('Notifications')",
    "text=Notifications",
    "xpath=//button",
    "//button",
    "button >> nth=0"
  ]) {
    assert.throws(
      () =>
        validateProofPlan({
          version: 1,
          tasks: [
            {
              ...task,
              actions: [{ type: "click", selector }]
            }
          ]
        }),
      /must be CSS/,
      selector
    );
  }
  assert.throws(
    () =>
      validateProofPlan({
        version: 1,
        tasks: [
          {
            ...task,
            actions: [
              {
                type: "clickText",
                selector: "button",
                value: ""
              }
            ]
          }
        ]
      }),
    /proof value is invalid/
  );
  assert.throws(
    () =>
      validateProofPlan({
        version: 1,
        tasks: [
          {
            ...task,
            finalAssertions: [
              {
                type: "visible",
                selector: "button:has-text('Saved')"
              }
            ]
          }
        ]
      }),
    /must be CSS/
  );
  assert.throws(
    () =>
      validateProofPlan({
        version: 1,
        tasks: [{
          ...task,
          finalAssertions: [{ type: "visible", selector: ".generated-class" }]
        }]
      }),
    /stable element, attribute, or data-agent-proof hook/
  );
  for (const selector of [
    "button.generated-class",
    "section#generated-id",
    "section:not(.generated-class)"
  ]) {
    assert.throws(
      () =>
        validateProofPlan({
          version: 1,
          tasks: [{
            ...task,
            finalAssertions: [{ type: "visible", selector }]
          }]
        }),
      /stable element, attribute, or data-agent-proof hook/
    );
  }
  assert.doesNotThrow(() =>
    validateProofPlan({
      version: 1,
      tasks: [{
        ...task,
        finalAssertions: [{ type: "visible", selector: "a[href='#details']" }]
      }]
    })
  );
});

test("demo session plans omit only runner-owned visible sign-in actions", () => {
  const plan = validateProofPlan({
    version: 1,
    tasks: [
      {
        clauseIds: ["AC1"],
        route: "/staff",
        session: "demo-staff",
        actions: [
          { type: "navigate", path: "/staff" },
          { type: "fill", selector: "[data-agent-proof='signin-email']", value: "staff@clinic.demo" },
          { type: "fill", selector: "[data-agent-proof=signin-passcode]", value: "staff1234" },
          { type: "click", selector: "[data-agent-proof=\"signin-submit\"]" },
          { type: "navigate", path: "/staff/tasks" },
          { type: "fill", selector: "[data-agent-proof='task-board-search']", value: "Biscuit" }
        ],
        intermediateAssertions: [
          { type: "text", selector: ".lane .taskStack", value: "Biscuit" }
        ],
        finalAssertions: [
          { type: "text", selector: ".boardGrid", value: "Biscuit" }
        ]
      }
    ]
  });

  assert.equal(plan.tasks[0].route, "/staff/tasks");
  assert.deepEqual(plan.tasks[0].actions, [
    { type: "navigate", path: "/staff" },
    { type: "navigate", path: "/staff/tasks" },
    { type: "fill", selector: "[data-agent-proof='task-board-search']", value: "Biscuit" }
  ]);
  assert.deepEqual(plan.tasks[0].intermediateAssertions, [
    {
      type: "text",
      selector: "[data-agent-proof='task-board-lanes']",
      value: "Biscuit"
    }
  ]);
  assert.deepEqual(plan.tasks[0].finalAssertions, [
    {
      type: "text",
      selector: "[data-agent-proof='task-board-lanes']",
      value: "Biscuit"
    }
  ]);
});
