import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  IMPLEMENTATION_ADDENDUM_MARKER,
  createIntentCapsule,
  implementationAddendumEnvelope,
  intentCapsuleForManagedTriage,
  parseImplementationAddendum,
  parseIssueSections,
  parseManagedTriageDecision,
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
  assert.equal(capsule.version, 2);
  assert.deepEqual(capsule.behaviorContract.routes, ["/staff/tasks"]);
  assert.deepEqual(
    capsule.behaviorContract.checks.map((check) => check.id),
    ["AC1", "AC2"]
  );
  assert.equal(capsule.behaviorContract.target.kind, "web");
  assert.match(capsule.behaviorContract.contractDigest, /^[a-f0-9]{64}$/);
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

  assert.deepEqual(validateProofPlan(base), base);
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
            actions: [{ type: "wait", milliseconds: 60_000 }]
          }
        ]
      }),
    /proof wait is invalid/
  );
});
