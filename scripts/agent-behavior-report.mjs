import { AgentError } from "./agent-lib.mjs";

const OVERALL = new Set(["satisfies_contract", "violates_contract", "blocked"]);
const STATUSES = new Set(["pass", "fail", "blocked", "out_of_scope"]);
const MAX_ITEMS = 100;
const MAX_TEXT = 4_000;

function text(value, label, { empty = false } = {}) {
  if (typeof value !== "string" || (!empty && !value.trim()) || value.length > MAX_TEXT) {
    throw new AgentError(`behavior report ${label} is invalid`, 1);
  }
  return value.trim();
}

function stringList(value, label) {
  if (
    !Array.isArray(value) ||
    value.length > MAX_ITEMS ||
    value.some((item) => typeof item !== "string" || !item.trim() || item.length > MAX_TEXT)
  ) {
    throw new AgentError(`behavior report ${label} is invalid`, 1);
  }
  return value.map((item) => item.trim());
}

export function validateBehaviorReport(report, contract) {
  const keys = [
    "anti_cheat_probes",
    "blockers",
    "checks",
    "overall_behavior",
    "overall_confidence",
    "target"
  ];
  if (
    !report ||
    Array.isArray(report) ||
    JSON.stringify(Object.keys(report).sort()) !== JSON.stringify(keys) ||
    !OVERALL.has(report.overall_behavior) ||
    !Number.isFinite(report.overall_confidence) ||
    report.overall_confidence < 0 ||
    report.overall_confidence > 1 ||
    !report.target ||
    Array.isArray(report.target) ||
    JSON.stringify(Object.keys(report.target).sort()) !==
      JSON.stringify(["access", "type"]) ||
    !Array.isArray(report.checks) ||
    report.checks.length > MAX_ITEMS ||
    !Array.isArray(report.anti_cheat_probes) ||
    report.anti_cheat_probes.length > MAX_ITEMS
  ) {
    throw new AgentError("behavior report is invalid", 1);
  }
  text(report.target.type, "target type");
  text(report.target.access, "target access");
  const expectedClauses = new Map(
    (contract?.checks ?? []).map((check) => [
      `${check.id}: ${check.statement}`,
      check
    ])
  );
  const seen = new Set();
  for (const check of report.checks) {
    const checkKeys = [
      "confidence",
      "contract_clause",
      "evidence",
      "reproduction_steps",
      "severity",
      "status"
    ];
    if (
      !check ||
      Array.isArray(check) ||
      JSON.stringify(Object.keys(check).sort()) !== JSON.stringify(checkKeys) ||
      !STATUSES.has(check.status) ||
      !Number.isFinite(check.confidence) ||
      check.confidence < 0 ||
      check.confidence > 1 ||
      (check.status === "fail"
        ? typeof check.severity !== "string" || !check.severity.trim()
        : check.severity !== null)
    ) {
      throw new AgentError("behavior report check is invalid", 1);
    }
    const clause = text(check.contract_clause, "contract clause");
    if (seen.has(clause)) throw new AgentError("behavior report repeats a contract clause", 1);
    seen.add(clause);
    if (expectedClauses.size && !expectedClauses.has(clause)) {
      throw new AgentError("behavior report contains an unknown contract clause", 1);
    }
    text(check.evidence, "evidence");
    stringList(check.reproduction_steps, "reproduction steps");
  }
  if (
    expectedClauses.size &&
    (seen.size !== expectedClauses.size ||
      [...expectedClauses.keys()].some((clause) => !seen.has(clause)))
  ) {
    throw new AgentError("behavior report does not cover every contract clause", 1);
  }
  for (const probe of report.anti_cheat_probes) {
    if (
      !probe ||
      Array.isArray(probe) ||
      JSON.stringify(Object.keys(probe).sort()) !==
        JSON.stringify(["probe", "result"])
    ) {
      throw new AgentError("behavior report anti-cheat probe is invalid", 1);
    }
    text(probe.probe, "anti-cheat probe");
    text(probe.result, "anti-cheat result");
  }
  const blockers = stringList(report.blockers, "blockers");
  const statuses = report.checks.map((check) => check.status);
  if (
    (report.overall_behavior === "satisfies_contract" &&
      (statuses.some((status) => status !== "pass" && status !== "out_of_scope") ||
        blockers.length)) ||
    (report.overall_behavior === "violates_contract" && !statuses.includes("fail")) ||
    (report.overall_behavior === "blocked" &&
      !statuses.includes("blocked") &&
      blockers.length === 0)
  ) {
    throw new AgentError("behavior report overall result is inconsistent", 1);
  }
  return report;
}

export function commandBehaviorReport({
  contract,
  passed,
  access,
  commands,
  blocker = ""
}) {
  const status = passed ? "pass" : blocker ? "blocked" : "fail";
  const evidence = passed
    ? `Configured exact-revision checks passed: ${commands.join(", ")}.`
    : blocker || `Configured exact-revision checks failed: ${commands.join(", ")}.`;
  return validateBehaviorReport(
    {
      overall_behavior: passed
        ? "satisfies_contract"
        : blocker
          ? "blocked"
          : "violates_contract",
      overall_confidence: passed ? 0.75 : 0.95,
      target: {
        type:
          contract?.target?.kind === "service"
            ? "service"
            : contract?.target?.kind === "web"
              ? "web app"
              : "repository",
        access
      },
      checks: (contract?.checks ?? []).map((check) => ({
        contract_clause: `${check.id}: ${check.statement}`,
        status,
        severity: status === "fail" ? "high" : null,
        evidence,
        reproduction_steps: commands,
        confidence: passed ? 0.75 : 0.95
      })),
      anti_cheat_probes: [
        {
          probe: "Exact revision binding",
          result: `Checks executed against ${access}.`
        },
        {
          probe: "Configured assertion completion",
          result: passed
            ? "Every configured command exited successfully."
            : "At least one configured command did not complete successfully."
        }
      ],
      blockers: blocker ? [blocker] : []
    },
    contract
  );
}
