import assert from "node:assert/strict";
import test from "node:test";

import {
  commandBehaviorReport,
  validateBehaviorReport
} from "./agent-behavior-report.mjs";

const contract = {
  target: { kind: "repository" },
  checks: [
    { id: "AC1", statement: "The command succeeds." },
    { id: "AC2", statement: "The result persists." }
  ]
};

test("command behavior report covers every sealed clause", () => {
  const report = commandBehaviorReport({
    contract,
    passed: true,
    access: "head abc123",
    commands: ["npm test"]
  });

  assert.equal(report.overall_behavior, "satisfies_contract");
  assert.deepEqual(
    report.checks.map((check) => check.contract_clause),
    [
      "AC1: The command succeeds.",
      "AC2: The result persists."
    ]
  );
});

test("behavior report rejects missing clauses and inconsistent success", () => {
  const report = commandBehaviorReport({
    contract,
    passed: true,
    access: "head abc123",
    commands: ["npm test"]
  });

  assert.throws(
    () => validateBehaviorReport({ ...report, checks: report.checks.slice(0, 1) }, contract),
    /cover every contract clause/
  );
  assert.throws(
    () =>
      validateBehaviorReport(
        {
          ...report,
          checks: report.checks.map((check, index) =>
            index
              ? { ...check, status: "fail", severity: "high" }
              : check
          )
        },
        contract
      ),
    /overall result is inconsistent/
  );
});
