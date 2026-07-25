import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_SEMANTIC_REVISIONS,
  emptyRepairLedger,
  findingDigest,
  hasRepairEvaluation,
  loadRepairLedger,
  openRepairFindings,
  parseRepairLedgerBody,
  recordRepairEvaluation,
  recordRepairRevision,
  repairEvaluationFor,
  repairLedgerBody,
  semanticInputDigest,
} from "./agent-repair-ledger.mjs";

const intentDigest = "a".repeat(64);
const head = "b".repeat(40);
const nextHead = "c".repeat(40);

test("shared repair ledger records findings and only material heads consume budget", () => {
  const inputDigest = semanticInputDigest({
    lane: "review",
    head,
    intentDigest,
    findings: [],
    checks: [{ name: "quality", state: "success" }],
  });
  const evaluated = recordRepairEvaluation(emptyRepairLedger(intentDigest), {
    lane: "review",
    head,
    inputDigest,
    findings: ["Fix the tenant-scoped query."],
    outcome: "blocked",
  });
  assert.equal(evaluated.ledger.revisionCount, 0);
  assert.equal(openRepairFindings(evaluated.ledger).length, 1);

  const revised = recordRepairRevision(evaluated.ledger, {
    lane: "review",
    fromHead: head,
    toHead: nextHead,
    findingDigest: evaluated.findingDigest,
  });
  assert.equal(revised.ledger.revisionCount, 1);
  assert.equal(MAX_SEMANTIC_REVISIONS, 3);
});

test("identical exact-head evaluation reconciles without duplicating findings", () => {
  const ledger = emptyRepairLedger(intentDigest);
  const inputDigest = semanticInputDigest({
    lane: "no-mistakes",
    head,
    intentDigest,
    findings: [],
  });
  const first = recordRepairEvaluation(ledger, {
    lane: "no-mistakes",
    head,
    inputDigest,
    findings: [{ id: "unsafe-query", file: "packages/db/query.ts", action: "auto-fix" }],
    outcome: "decision-gate",
  });
  const second = recordRepairEvaluation(first.ledger, {
    lane: "no-mistakes",
    head,
    inputDigest,
    findings: [{ id: "unsafe-query", file: "packages/db/query.ts", action: "auto-fix" }],
    outcome: "decision-gate",
  });
  assert.equal(second.replayed, true);
  assert.equal(second.ledger.evaluations.length, 1);
  assert.equal(second.ledger.findings[0].occurrences, 1);
  assert.equal(
    hasRepairEvaluation(second.ledger, {
      lane: "no-mistakes",
      head,
      inputDigest,
    }),
    true,
  );
  assert.equal(
    repairEvaluationFor(second.ledger, {
      lane: "no-mistakes",
      head,
      inputDigest,
    })?.outcome,
    "decision-gate",
  );
});

test("same-head setup failure can be superseded without a semantic revision", () => {
  const inputDigest = semanticInputDigest({
    lane: "no-mistakes",
    head,
    intentDigest,
    findings: [],
  });
  const failed = recordRepairEvaluation(emptyRepairLedger(intentDigest), {
    lane: "no-mistakes",
    head,
    inputDigest,
    findings: [],
    outcome: "setup-failed",
  });
  const passed = recordRepairEvaluation(failed.ledger, {
    lane: "no-mistakes",
    head,
    inputDigest,
    findings: [],
    outcome: "passed",
  });
  assert.equal(passed.replayed, false);
  assert.equal(passed.ledger.evaluations.length, 2);
  assert.equal(passed.ledger.revisionCount, 0);
  assert.equal(
    repairEvaluationFor(passed.ledger, {
      lane: "no-mistakes",
      head,
      inputDigest,
    })?.outcome,
    "passed",
  );
});

test("ledger parser trusts one exact managed comment and intent digest", () => {
  const ledger = emptyRepairLedger(intentDigest);
  const body = `<!-- agent-repair-ledger:v1 -->\n${repairLedgerBody(ledger)}\n`;
  assert.deepEqual(parseRepairLedgerBody(body, intentDigest), ledger);
  assert.deepEqual(
    loadRepairLedger(
      [{
        id: 1,
        updated_at: "2026-07-24T00:00:00Z",
        user: { login: "github-actions[bot]" },
        body,
      }],
      intentDigest,
      "sandeepsalwan1",
    ),
    ledger,
  );
});

test("shared revision limit rejects a fourth material head", () => {
  let ledger = emptyRepairLedger(intentDigest);
  for (let index = 0; index < MAX_SEMANTIC_REVISIONS; index += 1) {
    const fromHead = String(index + 1).repeat(40);
    const toHead = String(index + 2).repeat(40);
    ledger = recordRepairRevision(ledger, {
      lane: index % 2 ? "no-mistakes" : "review",
      fromHead,
      toHead,
      findingDigest: findingDigest([`finding ${index}`]),
    }).ledger;
  }
  assert.throws(
    () => recordRepairRevision(ledger, {
      lane: "review",
      fromHead: "4".repeat(40),
      toHead: "5".repeat(40),
      findingDigest: findingDigest(["one more"]),
    }),
    /shared semantic repair limit exhausted/,
  );
});
