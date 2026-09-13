import { AgentError, privilegedCandidatePaths } from "./agent-lib.mjs";
import { MAX_SEMANTIC_REVISIONS } from "./agent-repair-ledger.mjs";

export const NO_MISTAKES_ARTIFACT_VERSION = 5;
export const MAX_GATE_REPAIR_ATTEMPTS = MAX_SEMANTIC_REVISIONS;

const PASSING_OUTCOMES = new Set(["checks-passed", "passed"]);
const REPLAY_PASSING_OUTCOMES = new Set([
  "passed-proven",
  "passed-recovered",
]);
const ALLOWED_OUTCOMES = new Set([
  ...PASSING_OUTCOMES,
  "failed",
  "cancelled",
  "ask-user",
  "decision-gate",
  "invalid-output",
  "head-mismatch",
  "native-fix",
  "unpublished-changes",
  "setup-failed",
  "model-interrupted",
]);
const PUBLIC_FINDING_SUMMARIES = new Map([
  [
    "review-environment-blocked",
    "The isolated reviewer could not complete in its current environment.",
  ],
  [
    "validation-environment-blocked",
    "The isolated evidence agent could not demonstrate the requested behavior.",
  ],
  [
    "test-environment-blocked",
    "The isolated test evidence agent could not complete in its current environment.",
  ],
]);
const PUBLIC_FAILURE_STAGES = new Set([
  "intent",
  "rebase",
  "review",
  "test",
  "document",
  "lint",
  "push",
  "pr",
  "ci",
]);

export function isPassingGateOutcome(outcome) {
  return PASSING_OUTCOMES.has(String(outcome ?? ""));
}

export function isReplayPassingGateOutcome(outcome) {
  return REPLAY_PASSING_OUTCOMES.has(String(outcome ?? ""));
}

export function readRepairAttempt(value) {
  const attempt = Number(value ?? 0);
  if (
    !Number.isInteger(attempt) ||
    attempt < 0 ||
    attempt > MAX_GATE_REPAIR_ATTEMPTS
  ) {
    throw new AgentError("no-mistakes repair attempt is invalid", 2);
  }
  return attempt;
}

export function gateRepairDecision(
  artifact,
  repairAttempt = 0,
  { replayed = false } = {},
) {
  const attempt = readRepairAttempt(repairAttempt);
  if (replayed) return { state: "unchanged", nextAttempt: null };
  if (artifact?.outcome === "native-fix" && artifact?.nativeFix) {
    if (attempt < MAX_GATE_REPAIR_ATTEMPTS) {
      return { state: "native-fix", nextAttempt: attempt + 1 };
    }
    return { state: "exhausted", nextAttempt: null };
  }
  const exactHeadBound =
    /^[0-9a-f]{40}$/.test(String(artifact?.expectedHead ?? "")) &&
    artifact?.validatedHead === artifact.expectedHead;
  const actionable =
    exactHeadBound &&
    ["decision-gate", "failed"].includes(artifact?.outcome) &&
    Array.isArray(artifact?.findings) &&
    artifact.findings.length > 0 &&
    artifact.findings.every((finding) => finding?.action === "auto-fix");
  if (!actionable) return { state: "none", nextAttempt: null };
  if (attempt < MAX_GATE_REPAIR_ATTEMPTS) {
    return { state: "retry", nextAttempt: attempt };
  }
  return { state: "exhausted", nextAttempt: null };
}

// AXI emits indentation-scoped TOON tables with CSV-shaped rows.
function parseCsvRow(line) {
  const values = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      values.push(value);
      value = "";
    } else {
      value += character;
    }
  }
  values.push(value);
  return values;
}

function parseGateFindings(output) {
  const lines = String(output ?? "").split(/\r?\n/);
  const headerIndex = lines.findIndex((line) =>
    /^\s*findings\[\d+\]\{[^}]+\}:\s*$/.test(line),
  );
  if (headerIndex === -1) return [];
  const headerIndent = lines[headerIndex].match(/^\s*/)?.[0].length ?? 0;
  const columnsMatch = lines[headerIndex].match(/\{([^}]+)\}/);
  const columns =
    columnsMatch?.[1].split(",").map((column) => column.trim()) ?? [];
  const findings = [];
  for (const line of lines.slice(headerIndex + 1)) {
    const rowIndent = line.match(/^\s*/)?.[0].length ?? 0;
    if (!line.trim() || rowIndent <= headerIndent) break;
    const values = parseCsvRow(line.trimStart());
    const row = Object.fromEntries(
      columns.map((column, index) => [column, values[index] ?? ""]),
    );
    findings.push({
      id: row.id,
      severity: row.severity,
      file: row.file,
      action: row.action,
    });
  }
  return findings;
}

function parseFailureStage(output) {
  const lines = String(output ?? "").split(/\r?\n/);
  const headerIndex = lines.findIndex((line) =>
    /^\s*steps\[\d+\]\{[^}]+\}:\s*$/.test(line),
  );
  if (headerIndex === -1) return "";
  const headerIndent = lines[headerIndex].match(/^\s*/)?.[0].length ?? 0;
  const columnsMatch = lines[headerIndex].match(/\{([^}]+)\}/);
  const columns =
    columnsMatch?.[1].split(",").map((column) => column.trim()) ?? [];
  for (const line of lines.slice(headerIndex + 1)) {
    const rowIndent = line.match(/^\s*/)?.[0].length ?? 0;
    if (!line.trim() || rowIndent <= headerIndent) break;
    const values = parseCsvRow(line.trimStart());
    const row = Object.fromEntries(
      columns.map((column, index) => [column, values[index] ?? ""]),
    );
    if (row.status === "failed" && PUBLIC_FAILURE_STAGES.has(row.step)) {
      return row.step;
    }
  }
  return "";
}

function parseRunFields(output) {
  const lines = String(output ?? "").split(/\r?\n/);
  const runIndex = lines.findIndex((line) => line === "run:");
  const fields = {};
  if (runIndex === -1) return fields;
  for (const line of lines.slice(runIndex + 1)) {
    if (!line.startsWith("  ")) break;
    const match = line.match(/^\s{2}(id|head):\s*(.+?)\s*$/);
    if (match) {
      const value = match[2];
      if (value.startsWith('"') && value.endsWith('"')) {
        try {
          const parsed = JSON.parse(value);
          fields[match[1]] = typeof parsed === "string" ? parsed : value;
        } catch {
          fields[match[1]] = value;
        }
      } else {
        fields[match[1]] = value;
      }
    }
  }
  return fields;
}

function parseGateStep(output) {
  const lines = String(output ?? "").split(/\r?\n/);
  const gateIndex = lines.findIndex((line) =>
    /^gate:(?:\s+\S+)?\s*$/.test(line),
  );
  if (gateIndex === -1) return "";
  const inline = lines[gateIndex].match(/^gate:\s+(\S+)\s*$/);
  if (inline) return inline[1];
  for (const line of lines.slice(gateIndex + 1)) {
    if (!line.startsWith("  ")) break;
    const match = line.match(/^\s{2}step:\s*(\S+)\s*$/);
    if (match) return match[1];
  }
  return "";
}

export function parseAxiResult(output, exitStatus) {
  const text = String(output ?? "");
  const outcomes = [
    ...text.matchAll(
      /^outcome:\s*(checks-passed|passed|failed|cancelled)\s*$/gm,
    ),
  ].map((match) => match[1]);
  const run = parseRunFields(text);
  const findings = parseGateFindings(text);
  const step = parseGateStep(text);
  const failureStage = parseFailureStage(text);

  if (outcomes.length === 1) {
    const outcome = outcomes[0];
    if (exitStatus === 0 && isPassingGateOutcome(outcome)) {
      return { status: "passed", outcome, run, findings, failureStage };
    }
    return { status: "failed", outcome, run, findings, failureStage };
  }
  if (/^gate:(?:\s+\S+)?\s*$/m.test(text)) {
    return {
      status: "blocked",
      outcome: findings.some((finding) => finding.action === "ask-user")
        ? "ask-user"
        : "decision-gate",
      run,
      findings,
      step,
      failureStage,
    };
  }
  return {
    status: "failed",
    outcome: "invalid-output",
    run,
    findings,
    failureStage,
  };
}

export function isRetryableReviewEnvironmentBlock(gate) {
  return (
    gate?.status === "blocked" &&
    gate?.outcome === "ask-user" &&
    gate?.step === "review" &&
    gate?.findings?.length === 1 &&
    gate.findings[0]?.id === "review-environment-blocked" &&
    !gate.findings[0]?.file &&
    gate.findings[0]?.action === "ask-user"
  );
}

export function isRetryableTestEnvironmentBlock(gate) {
  return (
    gate?.status === "blocked" &&
    gate?.outcome === "ask-user" &&
    gate?.step === "test" &&
    gate?.findings?.length === 1 &&
    gate.findings[0]?.id === "test-environment-blocked" &&
    !gate.findings[0]?.file &&
    gate.findings[0]?.action === "ask-user"
  );
}

export function isRetryableTechnicalFailure(gate, expectedHead) {
  return (
    gate?.status === "failed" &&
    gate?.outcome === "failed" &&
    /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(gate?.run?.id ?? "") &&
    validatedHeadMatches(gate, expectedHead) &&
    gate?.findings?.length === 0
  );
}

export function isRetryableInvalidOutput(gate) {
  return (
    gate?.status === "failed" &&
    gate?.outcome === "invalid-output" &&
    Object.keys(gate?.run ?? {}).length === 0 &&
    gate?.findings?.length === 0
  );
}

export function isReattachableAxiError(output) {
  return /^error:\s*drive run:\s*/m.test(String(output ?? ""));
}

export function validatedHeadMatches(result, sha) {
  const expected = String(sha ?? "");
  const validated = String(result?.run?.head ?? "");
  return (
    /^[0-9a-f]{40}$/.test(expected) &&
    /^[0-9a-f]{8,40}$/.test(validated) &&
    expected.startsWith(validated)
  );
}

function normalizeNativeFix(value, expectedHead) {
  if (value == null) return null;
  if (
    typeof value !== "object" ||
    Array.isArray(value) ||
    value.baseHead !== expectedHead ||
    !/^[0-9a-f]{40}$/.test(String(value.fixedHead ?? "")) ||
    !/^[0-9a-f]{40}$/.test(String(value.fixedTree ?? "")) ||
    !/^[0-9a-f]{64}$/.test(String(value.patchSha256 ?? "")) ||
    !Array.isArray(value.paths) ||
    value.paths.length < 1 ||
    value.paths.length > 1000 ||
    value.paths.some((path) => {
      if (
        typeof path !== "string" ||
        !path ||
        path.length > 500 ||
        /[\u0000-\u001f\u007f\\]/.test(path)
      ) {
        return true;
      }
      const segments = path.split("/");
      return (
        path.startsWith("/") ||
        segments.some(
          (segment) => !segment || segment === "." || segment === "..",
        )
      );
    }) ||
    privilegedCandidatePaths(value.paths).length
  ) {
    throw new AgentError("sanitized native no-mistakes fix is invalid", 1);
  }
  return {
    baseHead: expectedHead,
    fixedHead: value.fixedHead,
    fixedTree: value.fixedTree,
    patchSha256: value.patchSha256,
    paths: [...new Set(value.paths)],
  };
}

function safePublicText(value, maxLength) {
  return String(value ?? "")
    .replace(
      /\b(?:sk-[A-Za-z0-9_-]{8,}|github_pat_[A-Za-z0-9_]{8,}|gh[pousr]_[A-Za-z0-9]{8,})\b/g,
      "[redacted]",
    )
    .replace(/[\u0000-\u001f\u007f`]/g, " ")
    .slice(0, maxLength);
}

function safeFinding(finding) {
  const id = safePublicText(finding?.id, 80);
  return {
    id,
    severity: safePublicText(finding?.severity, 32),
    file: safePublicText(finding?.file, 240),
    action: safePublicText(finding?.action, 32),
    summary: PUBLIC_FINDING_SUMMARIES.get(id) ?? "",
  };
}

export function sanitizedGateArtifact(
  gate,
  expectedHead,
  {
    nativeFix = null,
    unpublishedChanges = false,
    userApproved = false,
    validatedSourceHead = expectedHead,
  } = {},
) {
  // Only this bounded projection may cross from the isolated gate to trusted publication.
  let normalized = gate;
  const headMatches = validatedHeadMatches(gate, validatedSourceHead);
  const normalizedNativeFix = normalizeNativeFix(nativeFix, expectedHead);
  let artifactNativeFix = null;
  if (unpublishedChanges) {
    normalized = {
      ...gate,
      status: "failed",
      outcome: "unpublished-changes",
    };
  } else if (normalizedNativeFix && gate?.status === "passed") {
    normalized = { ...gate, status: "blocked", outcome: "native-fix" };
    artifactNativeFix = normalizedNativeFix;
  } else if (gate?.run?.head && !headMatches) {
    normalized = {
      ...gate,
      status: "failed",
      outcome: "unpublished-changes",
    };
  } else if (gate?.status === "passed" && !headMatches) {
    normalized = { ...gate, status: "failed", outcome: "head-mismatch" };
  }
  const status = ["passed", "blocked", "failed"].includes(normalized?.status)
    ? normalized.status
    : "failed";
  const outcome = ALLOWED_OUTCOMES.has(normalized?.outcome)
    ? normalized.outcome
    : "invalid-output";
  return {
    version: NO_MISTAKES_ARTIFACT_VERSION,
    status,
    outcome,
    expectedHead,
    validatedHead: headMatches ? expectedHead : "",
    runId: safePublicText(normalized?.run?.id, 80),
    userApproved: Boolean(userApproved),
    failureStage: PUBLIC_FAILURE_STAGES.has(normalized?.failureStage)
      ? normalized.failureStage
      : "",
    findings: (normalized?.findings ?? []).slice(0, 100).map(safeFinding),
    nativeFix: artifactNativeFix,
  };
}

export function normalizeGateArtifact(value, expectedHead) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AgentError("sanitized gate artifact is not an object", 1);
  }
  if (value.version !== NO_MISTAKES_ARTIFACT_VERSION) {
    throw new AgentError("sanitized gate artifact version is invalid", 1);
  }
  if (value.expectedHead !== expectedHead) {
    throw new AgentError("sanitized gate artifact targets another head", 1);
  }
  if (!["passed", "blocked", "failed"].includes(value.status)) {
    throw new AgentError("sanitized gate artifact status is invalid", 1);
  }
  if (!ALLOWED_OUTCOMES.has(value.outcome)) {
    throw new AgentError("sanitized gate artifact outcome is invalid", 1);
  }
  if (typeof value.userApproved !== "boolean") {
    throw new AgentError("sanitized gate artifact approval is invalid", 1);
  }
  if (value.failureStage && !PUBLIC_FAILURE_STAGES.has(value.failureStage)) {
    throw new AgentError("sanitized gate artifact failure stage is invalid", 1);
  }
  if (
    value.status === "passed" &&
    (!isPassingGateOutcome(value.outcome) || value.validatedHead !== expectedHead)
  ) {
    throw new AgentError("sanitized gate artifact cannot prove this head", 1);
  }
  if (!Array.isArray(value.findings) || value.findings.length > 100) {
    throw new AgentError("sanitized gate artifact findings are invalid", 1);
  }
  const nativeFix = normalizeNativeFix(value.nativeFix, expectedHead);
  if (
    (value.outcome === "native-fix") !== Boolean(nativeFix) ||
    (nativeFix && value.status !== "blocked")
  ) {
    throw new AgentError("sanitized gate artifact native fix state is invalid", 1);
  }
  return {
    version: NO_MISTAKES_ARTIFACT_VERSION,
    status: value.status,
    outcome: value.outcome,
    expectedHead,
    validatedHead: value.validatedHead === expectedHead ? expectedHead : "",
    runId: safePublicText(value.runId, 80),
    userApproved: value.userApproved,
    failureStage: PUBLIC_FAILURE_STAGES.has(value.failureStage)
      ? value.failureStage
      : "",
    findings: value.findings.map(safeFinding),
    nativeFix,
  };
}
