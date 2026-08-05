import { createHash } from "node:crypto";
import {
  AgentError,
  extractJson,
  markdownJsonBlock,
  newestManagedComment,
  upsertManagedComment,
} from "./agent-lib.mjs";

export const REPAIR_LEDGER_VERSION = 1;
export const REPAIR_LEDGER_MARKER = "<!-- agent-repair-ledger:v1 -->";
export const MAX_SEMANTIC_REVISIONS = 3;
export const MAX_PROOF_RECOVERY_REVISIONS = 1;
export const MAX_TOTAL_REVISIONS =
  MAX_SEMANTIC_REVISIONS + MAX_PROOF_RECOVERY_REVISIONS;

const HEAD_PATTERN = /^[0-9a-f]{40}$/;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/;
const LANES = new Set(["review", "no-mistakes"]);
const FINDING_STATES = new Set(["open", "resolved"]);
const MAX_EVALUATIONS = 24;
const MAX_FINDINGS = 100;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function boundedText(value, maxLength = 240) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f`]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function normalizedFinding(finding) {
  if (typeof finding === "string") {
    return {
      id: "",
      severity: "",
      file: "",
      action: "",
      summary: boundedText(finding),
    };
  }
  return {
    id: boundedText(finding?.id, 80),
    severity: boundedText(finding?.severity, 32),
    file: boundedText(finding?.file, 240),
    action: boundedText(finding?.action, 32),
    summary: boundedText(finding?.summary),
  };
}

export function findingDigest(findings = []) {
  const normalized = findings
    .map(normalizedFinding)
    .map((finding) => JSON.stringify(finding))
    .sort();
  return sha256(JSON.stringify(normalized));
}

export function semanticInputDigest({
  lane,
  head,
  intentDigest,
  findings = [],
  checks = [],
}) {
  if (!LANES.has(lane) || !HEAD_PATTERN.test(head) || !DIGEST_PATTERN.test(intentDigest)) {
    throw new AgentError("semantic repair input identity is invalid", 1);
  }
  const normalizedChecks = checks
    .map((check) => ({
      name: boundedText(check?.name, 80),
      state: boundedText(check?.state, 40),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
  return sha256(JSON.stringify({
    lane,
    head,
    intentDigest,
    findingDigest: findingDigest(findings),
    checks: normalizedChecks,
  }));
}

export function emptyRepairLedger(intentDigest) {
  if (!DIGEST_PATTERN.test(String(intentDigest ?? ""))) {
    throw new AgentError("repair ledger intent digest is invalid", 1);
  }
  return {
    version: REPAIR_LEDGER_VERSION,
    intentDigest,
    revisionCount: 0,
    revisions: [],
    evaluations: [],
    findings: [],
  };
}

export function validateRepairLedger(value, expectedIntentDigest = "") {
  const expectedKeys = [
    "evaluations",
    "findings",
    "intentDigest",
    "revisionCount",
    "revisions",
    "version",
  ];
  if (
    !value ||
    Array.isArray(value) ||
    JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(expectedKeys) ||
    value.version !== REPAIR_LEDGER_VERSION ||
    !DIGEST_PATTERN.test(String(value.intentDigest ?? "")) ||
    (expectedIntentDigest && value.intentDigest !== expectedIntentDigest) ||
    !Number.isInteger(value.revisionCount) ||
    value.revisionCount < 0 ||
    value.revisionCount > MAX_TOTAL_REVISIONS ||
    !Array.isArray(value.revisions) ||
    value.revisions.length !== value.revisionCount ||
    !Array.isArray(value.evaluations) ||
    value.evaluations.length > MAX_EVALUATIONS ||
    !Array.isArray(value.findings) ||
    value.findings.length > MAX_FINDINGS
  ) {
    throw new AgentError("repair ledger is invalid", 1);
  }
  value.revisions.forEach((revision, index) => {
    const keys = ["findingDigest", "fromHead", "lane", "number", "toHead"];
    if (
      JSON.stringify(Object.keys(revision ?? {}).sort()) !== JSON.stringify(keys) ||
      revision.number !== index + 1 ||
      !LANES.has(revision.lane) ||
      !HEAD_PATTERN.test(revision.fromHead) ||
      !HEAD_PATTERN.test(revision.toHead) ||
      revision.fromHead === revision.toHead ||
      !DIGEST_PATTERN.test(revision.findingDigest)
    ) {
      throw new AgentError("repair ledger revision is invalid", 1);
    }
  });
  value.evaluations.forEach((evaluation) => {
    const keys = ["findingDigest", "head", "inputDigest", "lane", "outcome"];
    if (
      JSON.stringify(Object.keys(evaluation ?? {}).sort()) !== JSON.stringify(keys) ||
      !LANES.has(evaluation.lane) ||
      !HEAD_PATTERN.test(evaluation.head) ||
      !DIGEST_PATTERN.test(evaluation.inputDigest) ||
      !DIGEST_PATTERN.test(evaluation.findingDigest) ||
      !boundedText(evaluation.outcome, 40) ||
      boundedText(evaluation.outcome, 40) !== evaluation.outcome
    ) {
      throw new AgentError("repair ledger evaluation is invalid", 1);
    }
  });
  value.findings.forEach((finding) => {
    const keys = [
      "digest",
      "firstHead",
      "lane",
      "lastHead",
      "occurrences",
      "status",
      "summary",
    ];
    if (
      JSON.stringify(Object.keys(finding ?? {}).sort()) !== JSON.stringify(keys) ||
      !DIGEST_PATTERN.test(finding.digest) ||
      !LANES.has(finding.lane) ||
      !HEAD_PATTERN.test(finding.firstHead) ||
      !HEAD_PATTERN.test(finding.lastHead) ||
      !Number.isInteger(finding.occurrences) ||
      finding.occurrences < 1 ||
      !FINDING_STATES.has(finding.status) ||
      boundedText(finding.summary) !== finding.summary
    ) {
      throw new AgentError("repair ledger finding is invalid", 1);
    }
  });
  return value;
}

export function parseRepairLedgerBody(body, expectedIntentDigest) {
  const text = String(body ?? "");
  if (text.split(REPAIR_LEDGER_MARKER).length !== 2) {
    throw new AgentError("repair ledger marker is invalid", 1);
  }
  const afterMarker = text.slice(
    text.indexOf(REPAIR_LEDGER_MARKER) + REPAIR_LEDGER_MARKER.length,
  );
  const match = afterMarker.match(/^\s*## Shared Repair Ledger[\s\S]*?Structured ledger:\s*```json\s*([\s\S]*?)```/i);
  if (!match) throw new AgentError("repair ledger JSON is missing", 1);
  return validateRepairLedger(extractJson(match[1]), expectedIntentDigest);
}

export function loadRepairLedger(comments, intentDigest, repoOwner) {
  const comment = newestManagedComment(
    comments,
    REPAIR_LEDGER_MARKER,
    repoOwner,
  );
  return comment
    ? parseRepairLedgerBody(comment.body, intentDigest)
    : emptyRepairLedger(intentDigest);
}

function findingSummary(finding) {
  const normalized = normalizedFinding(finding);
  return boundedText(
    normalized.summary ||
      [normalized.id, normalized.file, normalized.action, normalized.severity]
        .filter(Boolean)
        .join(" | "),
  );
}

export function recordRepairEvaluation(
  ledgerValue,
  { lane, head, inputDigest, findings = [], outcome },
) {
  const ledger = structuredClone(validateRepairLedger(ledgerValue));
  const aggregate = findingDigest(findings);
  const normalizedOutcome = boundedText(outcome, 40);
  if (
    !LANES.has(lane) ||
    !HEAD_PATTERN.test(head) ||
    !DIGEST_PATTERN.test(inputDigest) ||
    !normalizedOutcome
  ) {
    throw new AgentError("repair evaluation is invalid", 1);
  }
  const replayed = ledger.evaluations.some(
    (evaluation) =>
      evaluation.lane === lane &&
      evaluation.head === head &&
      evaluation.inputDigest === inputDigest &&
      evaluation.findingDigest === aggregate &&
      evaluation.outcome === normalizedOutcome,
  );
  if (replayed) return { ledger, replayed: true, findingDigest: aggregate };

  const current = new Map(
    findings.map((finding) => {
      const normalized = normalizedFinding(finding);
      const digest = sha256(JSON.stringify(normalized));
      return [digest, findingSummary(finding)];
    }),
  );
  for (const existing of ledger.findings) {
    if (existing.lane !== lane || existing.status !== "open") continue;
    if (!current.has(existing.digest)) existing.status = "resolved";
  }
  for (const [digest, summary] of current) {
    const existing = ledger.findings.find(
      (finding) => finding.lane === lane && finding.digest === digest,
    );
    if (existing) {
      existing.lastHead = head;
      existing.occurrences += 1;
      existing.status = "open";
    } else {
      ledger.findings.push({
        digest,
        lane,
        summary,
        firstHead: head,
        lastHead: head,
        occurrences: 1,
        status: "open",
      });
    }
  }
  ledger.evaluations.push({
    lane,
    head,
    inputDigest,
    findingDigest: aggregate,
    outcome: normalizedOutcome,
  });
  if (ledger.evaluations.length > MAX_EVALUATIONS) {
    ledger.evaluations = ledger.evaluations.slice(-MAX_EVALUATIONS);
  }
  return {
    ledger: validateRepairLedger(ledger),
    replayed: false,
    findingDigest: aggregate,
  };
}

export function recordRepairRevision(
  ledgerValue,
  { lane, fromHead, toHead, findingDigest: sourceFindingDigest },
  { allowProofRecovery = false } = {},
) {
  const ledger = structuredClone(validateRepairLedger(ledgerValue));
  if (
    !LANES.has(lane) ||
    !HEAD_PATTERN.test(fromHead) ||
    !HEAD_PATTERN.test(toHead) ||
    fromHead === toHead ||
    !DIGEST_PATTERN.test(sourceFindingDigest)
  ) {
    throw new AgentError("semantic repair revision is invalid", 1);
  }
  const replayed = ledger.revisions.some(
    (revision) =>
      revision.lane === lane &&
      revision.fromHead === fromHead &&
      revision.toHead === toHead,
  );
  if (replayed) return { ledger, replayed: true };
  const limit = allowProofRecovery
    ? MAX_TOTAL_REVISIONS
    : MAX_SEMANTIC_REVISIONS;
  if (ledger.revisionCount >= limit) {
    throw new AgentError("shared semantic repair limit exhausted", 1);
  }
  ledger.revisionCount += 1;
  ledger.revisions.push({
    number: ledger.revisionCount,
    lane,
    fromHead,
    toHead,
    findingDigest: sourceFindingDigest,
  });
  return { ledger: validateRepairLedger(ledger), replayed: false };
}

export function openRepairFindings(ledgerValue) {
  return validateRepairLedger(ledgerValue).findings
    .filter((finding) => finding.status === "open")
    .map((finding) => ({ ...finding }));
}

export function hasRepairEvaluation(
  ledgerValue,
  { lane, head, inputDigest },
) {
  return Boolean(
    repairEvaluationFor(ledgerValue, { lane, head, inputDigest }),
  );
}

export function repairEvaluationFor(
  ledgerValue,
  { lane, head, inputDigest },
) {
  const ledger = validateRepairLedger(ledgerValue);
  const evaluation = ledger.evaluations.findLast(
    (evaluation) =>
      evaluation.lane === lane &&
      evaluation.head === head &&
      evaluation.inputDigest === inputDigest,
  );
  return evaluation ? { ...evaluation } : null;
}

export function repairLedgerBody(ledgerValue) {
  const ledger = validateRepairLedger(ledgerValue);
  const openCount = ledger.findings.filter((finding) => finding.status === "open").length;
  return `## Shared Repair Ledger

Semantic revisions: ${ledger.revisionCount}/${MAX_TOTAL_REVISIONS} (${MAX_SEMANTIC_REVISIONS} standard + ${MAX_PROOF_RECOVERY_REVISIONS} proof recovery)
Open finding fingerprints: ${openCount}

Infrastructure retries, polling, and unchanged-head reconciliation do not consume this budget.

Structured ledger:
${markdownJsonBlock(ledger)}`;
}

export function saveRepairLedger({
  config,
  prNumber,
  ledger,
  dryRun = false,
}) {
  return upsertManagedComment({
    config,
    number: prNumber,
    marker: REPAIR_LEDGER_MARKER,
    body: repairLedgerBody(ledger),
    dryRun,
  });
}
