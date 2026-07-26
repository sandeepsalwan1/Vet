import { AgentError } from "./agent-lib.mjs";

const OVERALL = new Set(["satisfies_contract", "violates_contract", "blocked"]);
const STATUSES = new Set(["pass", "fail", "blocked", "out_of_scope"]);
const MAX_ITEMS = 100;
const MAX_TEXT = 4_000;
const EVIDENCE_LANES = ["deterministic", "browser", "service"];

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

export function checkEvidenceLanes(check, contract) {
  const configured = check?.evidenceLanes;
  if (
    Array.isArray(configured) &&
    configured.length > 0 &&
    configured.every((lane) => EVIDENCE_LANES.includes(lane)) &&
    new Set(configured).size === configured.length
  ) {
    return configured;
  }
  const proofKind = contract?.target?.proofKind;
  if (proofKind === "UI" || proofKind === "GIF") return ["browser"];
  if (proofKind === "service") return ["service"];
  return ["deterministic"];
}

export function requiredEvidenceLanes(contract) {
  const lanes = new Set(
    Array.isArray(contract?.artifactLanes)
      ? contract.artifactLanes
      : checkEvidenceLanes(null, contract)
  );
  for (const check of contract?.checks ?? []) {
    for (const lane of checkEvidenceLanes(check, contract)) lanes.add(lane);
  }
  return EVIDENCE_LANES.filter((lane) => lanes.has(lane));
}

export function commandBehaviorReport({
  contract,
  passed,
  access,
  commands,
  blocker = "",
  evidenceLanes = ["deterministic"]
}) {
  if (
    !Array.isArray(evidenceLanes) ||
    evidenceLanes.length === 0 ||
    evidenceLanes.some((lane) => !EVIDENCE_LANES.includes(lane)) ||
    new Set(evidenceLanes).size !== evidenceLanes.length
  ) {
    throw new AgentError("command behavior evidence lanes are invalid", 1);
  }
  const status = passed ? "pass" : blocker ? "blocked" : "fail";
  const coveredChecks = (contract?.checks ?? []).filter((check) =>
    checkEvidenceLanes(check, contract).some((lane) =>
      evidenceLanes.includes(lane)
    )
  );
  const evidence = passed
    ? `Configured exact-revision checks passed: ${commands.join(", ")}.`
    : blocker || `Configured exact-revision checks failed: ${commands.join(", ")}.`;
  return validateBehaviorReport(
    {
      overall_behavior: passed
        || coveredChecks.length === 0
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
      checks: (contract?.checks ?? []).map((check) => {
        const assigned = checkEvidenceLanes(check, contract);
        const covered = assigned.some((lane) => evidenceLanes.includes(lane));
        return {
          contract_clause: `${check.id}: ${check.statement}`,
          status: covered ? status : "out_of_scope",
          severity: covered && status === "fail" ? "high" : null,
          evidence: covered
            ? evidence
            : `This result covers ${evidenceLanes.join(", ")} evidence; the clause requires ${assigned.join(", ")}.`,
          reproduction_steps: covered ? commands : [],
          confidence: covered ? (passed ? 0.75 : 0.95) : 1
        };
      }),
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
      blockers: blocker && coveredChecks.length ? [blocker] : []
    },
    contract
  );
}

export function combineBehaviorReports({ contract, reports, access }) {
  const entries = (reports ?? []).map((entry) => {
    if (
      !entry ||
      !Array.isArray(entry.evidenceLanes) ||
      entry.evidenceLanes.length === 0 ||
      entry.evidenceLanes.some((lane) => !EVIDENCE_LANES.includes(lane)) ||
      new Set(entry.evidenceLanes).size !== entry.evidenceLanes.length
    ) {
      throw new AgentError("combined behavior evidence lanes are invalid", 1);
    }
    return {
      evidenceLanes: entry.evidenceLanes,
      report: validateBehaviorReport(entry.report, contract)
    };
  });
  const checks = (contract?.checks ?? []).map((check) => {
    const clause = `${check.id}: ${check.statement}`;
    const laneResults = checkEvidenceLanes(check, contract).map((lane) => {
      const matching = entries
        .filter((entry) => entry.evidenceLanes.includes(lane))
        .map((entry) =>
          entry.report.checks.find(
            (candidate) => candidate.contract_clause === clause
          )
        )
        .filter(Boolean);
      const status = matching.some((result) => result.status === "fail")
        ? "fail"
        : matching.some((result) => result.status === "pass")
          ? "pass"
          : "blocked";
      return { lane, status, matching };
    });
    const status = laneResults.some((result) => result.status === "fail")
      ? "fail"
      : laneResults.every((result) => result.status === "pass")
        ? "pass"
        : "blocked";
    return {
      contract_clause: clause,
      status,
      severity: status === "fail" ? "high" : null,
      evidence: laneResults
        .map(({ lane, matching }) =>
          matching.length
            ? matching
                .map((result) => `[${lane}] ${result.evidence}`)
                .join(" ")
            : `[${lane}] No direct evidence was produced.`
        )
        .join(" "),
      reproduction_steps: [
        ...new Set(
          laneResults.flatMap(({ matching }) =>
            matching.flatMap((result) => result.reproduction_steps)
          )
        )
      ],
      confidence:
        status === "pass"
          ? Math.min(
              ...laneResults.flatMap(({ matching }) =>
                matching.map((result) => result.confidence)
              )
            )
          : 0.99
    };
  });
  const statuses = checks.map((check) => check.status);
  const overall = statuses.includes("fail")
    ? "violates_contract"
    : statuses.includes("blocked")
      ? "blocked"
      : "satisfies_contract";
  const blockers = [
    ...new Set([
      ...entries.flatMap((entry) => entry.report.blockers),
      ...checks
        .filter((check) => check.status === "blocked")
        .map(
          (check) =>
            `Required direct evidence is missing for ${check.contract_clause}.`
        )
    ])
  ];
  return validateBehaviorReport(
    {
      overall_behavior: overall,
      overall_confidence: overall === "satisfies_contract" ? 0.75 : 0.99,
      target: {
        type:
          contract?.target?.kind === "service"
            ? "service"
            : contract?.target?.kind === "web"
              ? "web app"
              : "repository",
        access
      },
      checks,
      anti_cheat_probes: entries.flatMap(
        (entry) => entry.report.anti_cheat_probes
      ),
      blockers
    },
    contract
  );
}
