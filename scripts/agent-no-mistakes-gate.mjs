#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AgentError,
  addLabels,
  assertTrustedAgentPull as assertSharedTrustedAgentPull,
  fail,
  finish,
  getIssueComments,
  getPullSnapshot,
  ghApiJson,
  implementationCommitMessage,
  issueLabels,
  loadConfig,
  markdownJsonBlock,
  newestManagedComment,
  parseImplementationMetadata,
  parseArgs,
  privilegedCandidatePaths,
  publisherEnvironment,
  removeLabels,
  runCommand,
  setCommitStatus,
  setGitHubOutput,
  upsertManagedComment,
} from "./agent-lib.mjs";
import {
  intentCapsuleForManagedTriage,
  parseImplementationAddendum
} from "./agent-intent.mjs";
import {
  MAX_SEMANTIC_REVISIONS,
  loadRepairLedger,
  openRepairFindings,
  recordRepairEvaluation,
  recordRepairRevision,
  repairEvaluationFor,
  saveRepairLedger,
  semanticInputDigest,
} from "./agent-repair-ledger.mjs";

const ARTIFACT_VERSION = 5;
const MAX_NATIVE_FIX_PATCH_BYTES = 2_000_000;
const SECRET_ENV_NAME = /(key|secret|token|password|credential)/i;
const MIN_SCANNED_SECRET_LENGTH = 12;
const NO_MISTAKES_COMMENT_MARKER = "<!-- agent-gate-no-mistakes:v1 -->";
const STATUS_CONTEXT = "no-mistakes";
export const MAX_INFRASTRUCTURE_RETRIES = 1;
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

export function noMistakesReplayState(evaluation) {
  const outcome = String(evaluation?.outcome ?? "");
  const replayPassed = REPLAY_PASSING_OUTCOMES.has(outcome);
  return {
    skipModel:
      replayPassed ||
      (Boolean(evaluation) &&
        !PASSING_OUTCOMES.has(outcome) &&
        outcome !== "setup-failed"),
    replayPassed,
  };
}

export function repairLedgerOutcome(artifact) {
  const outcome = String(artifact?.outcome ?? "");
  if (artifact?.status === "passed") return "passed-proven";
  return PASSING_OUTCOMES.has(outcome) ? "failed" : outcome;
}

export function setupFailureRecoveryEligible({
  config,
  ledger,
  head,
  inputDigest,
  passProven,
  sourceIssue,
}) {
  if (
    !passProven ||
    !issueLabels(sourceIssue).includes(config.labels.automerge) ||
    openRepairFindings(ledger).length > 0
  ) {
    return false;
  }
  const history = ledger.evaluations.filter(
    (evaluation) =>
      evaluation.lane === "no-mistakes" &&
      evaluation.head === head &&
      evaluation.inputDigest === inputDigest,
  );
  const lastRecovered = history.findLastIndex(
    (evaluation) => evaluation.outcome === "passed-recovered",
  );
  return history.findLastIndex(
    (evaluation) => evaluation.outcome === "setup-failed",
  ) > lastRecovered;
}

function readApprovalState(value) {
  const normalized = String(value ?? "false").trim().toLowerCase();
  if (!["true", "false"].includes(normalized)) {
    throw new AgentError("no-mistakes approval state is invalid", 2);
  }
  return normalized === "true";
}
const GATE_EVIDENCE_BOUNDARY = `Evidence boundary:
- Configured deterministic scenario, API, or CLI checks count as direct product evidence when their output and assertions demonstrate the requested behavior.
- Agent Proof owns browser, visual, and live-provider evidence. Require that evidence only when the trusted issue or managed triage explicitly requests it.
- Do not block solely because UI or live-provider evidence is absent when the trusted request calls for CI or non-visual proof and a configured check directly exercises the behavior.
- Still block when the requested behavior is not demonstrated by either direct checks or an applicable Agent Proof result.`;
const CODEX_MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const CODEX_EFFORTS = new Set(["none", "minimal", "low", "medium", "high", "xhigh"]);
const ISOLATED_GATE_INSTRUCTIONS =
  "This is an isolated no-mistakes pipeline stage. Execute the requested stage directly. Do not invoke skills, autoreview, no-mistakes, external reviewers, or nested agents. Do not run complete repository tests, builds, linters, or package-manager installs; trusted credential-free steps provide deterministic validation. During review, report findings only. During review-fix, apply only safe non-functional fixes requested by no-mistakes, then run one focused verification. Never modify AGENTS.md, package manifests or lockfiles, agent scripts/configuration, skills, or GitHub workflows. Treat test-only assertion changes as documentation-complete when they do not alter runtime behavior, APIs, configuration, workflows, or user-visible behavior and the trusted intent does not request docs. Return the requested structured JSON.";

export function noMistakesCommentMarker(config) {
  return `${config.comments.gate}\n${NO_MISTAKES_COMMENT_MARKER}`;
}

export function implementationMetadata(body) {
  return parseImplementationMetadata(body);
}

export function assertTrustedAgentPull(pull, config, files, dependencies = {}) {
  return assertSharedTrustedAgentPull(pull, config, {
    files,
    rejectPrivilegedPaths: true,
  }, dependencies);
}

export function selectTrustedManagedTriageComment(comments, marker, repoOwner) {
  return newestManagedComment(comments, marker, repoOwner);
}

export function composeEffectiveIntent({
  callerIntent,
  intentCapsule,
  implementationAddendum,
}) {
  const policy = String(callerIntent ?? "").trim();
  if (!policy) throw new AgentError("missing caller gate intent", 2);
  if (!intentCapsule || !implementationAddendum) {
    throw new AgentError("sealed no-mistakes intent context is missing", 1);
  }
  const effective = `Gate policy:
${policy}

${GATE_EVIDENCE_BOUNDARY}

Sealed intent capsule:
${JSON.stringify(intentCapsule, null, 2)}

Implementation intent addendum:
${JSON.stringify(implementationAddendum, null, 2)}`;
  if (Buffer.byteLength(effective, "utf8") > 120_000) {
    throw new AgentError(
      "effective no-mistakes intent exceeds the safe argument limit",
      1,
    );
  }
  return effective;
}

export function noMistakesConfig({ model, effort, agentPath = "" }) {
  const resolvedModel = String(model ?? "").trim();
  const resolvedEffort = String(effort ?? "").trim();
  const resolvedAgentPath = String(agentPath ?? "").trim();
  if (
    !CODEX_MODEL_PATTERN.test(resolvedModel) ||
    !CODEX_EFFORTS.has(resolvedEffort) ||
    (resolvedAgentPath && !isAbsolute(resolvedAgentPath))
  ) {
    throw new AgentError("no-mistakes model configuration is invalid", 2);
  }
  const agentPathConfig = resolvedAgentPath
    ? `agent_path_override:\n  codex: ${JSON.stringify(resolvedAgentPath)}\n`
    : "";
  return `agent: codex
${agentPathConfig}session_reuse: false
intent:
  enabled: false
auto_fix:
  review: 2
agent_args_override:
  codex:
    - --model
    - ${JSON.stringify(resolvedModel)}
    - -c
    - ${JSON.stringify(`model_reasoning_effort=${JSON.stringify(resolvedEffort)}`)}
    - --sandbox
    - workspace-write
    - -c
    - 'approval_policy="never"'
    - -c
    - 'shell_environment_policy.inherit="core"'
    - -c
    - 'shell_environment_policy.ignore_default_excludes=false'
    - -c
    - 'shell_environment_policy.exclude=["*KEY*","*SECRET*","*TOKEN*","*PASSWORD*","*CREDENTIAL*"]'
    - -c
    - ${JSON.stringify(`developer_instructions=${JSON.stringify(ISOLATED_GATE_INSTRUCTIONS)}`)}
`;
}

function optionalCount(value) {
  if (value === "-") return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : undefined;
}

export function parseNoMistakesUsageStats(output, { runId, model, effort }) {
  const lines = String(output ?? "").split(/\r?\n/);
  const header = lines.findIndex(
    (line) =>
      line.trimStart().startsWith("STEP") &&
      line.includes("Δ IN (round)") &&
      line.includes("CACHE RD (raw)"),
  );
  if (header === -1) {
    return {
      version: 1,
      backend: "codex",
      lane: "no-mistakes",
      model,
      effort,
      complete: false,
      calls: [],
    };
  }
  const calls = [];
  for (const line of lines.slice(header + 1)) {
    if (!line.trim()) break;
    const fields = line.trim().split(/\s{2,}/);
    if (fields.length !== 13) continue;
    const [
      step,
      round,
      purpose,
      session,
      deltaInput,
      deltaOutput,
      deltaCached,
      rawInput,
      rawOutput,
      rawCached,
      ,
      ,
      reasoning,
    ] = fields;
    const raw = {
      input: optionalCount(rawInput),
      output: optionalCount(rawOutput),
      cached: optionalCount(rawCached),
    };
    const delta = {
      input: optionalCount(deltaInput),
      output: optionalCount(deltaOutput),
      cached: optionalCount(deltaCached),
    };
    const useRaw = delta.input === null && delta.output === null && delta.cached === null && session === "cold";
    const inputTokens = useRaw ? raw.input : delta.input;
    const outputTokens = useRaw ? raw.output : delta.output;
    const cachedInputTokens = useRaw ? raw.cached : delta.cached;
    if (
      ![inputTokens, outputTokens, cachedInputTokens].every(
        (value) => Number.isSafeInteger(value) && value >= 0,
      ) ||
      cachedInputTokens > inputTokens
    ) {
      continue;
    }
    const reasoningOutputTokens = optionalCount(reasoning);
    calls.push({
      id: createHash("sha256")
        .update(
          `${runId}\0${step}\0${round}\0${purpose}\0${session}\0${inputTokens}\0${outputTokens}`,
        )
        .digest("hex"),
      inputTokens,
      cachedInputTokens,
      outputTokens,
      reasoningOutputTokens:
        Number.isSafeInteger(reasoningOutputTokens) ? reasoningOutputTokens : null,
    });
  }
  return {
    version: 1,
    backend: "codex",
    lane: "no-mistakes",
    model,
    effort,
    complete: calls.length > 0,
    calls,
  };
}

export function exportNoMistakesUsage(
  { resultFile, outputFile, model, effort, repoDir },
  dependencies = {},
) {
  const artifact = JSON.parse(readFileSync(resolve(resultFile), "utf8"));
  const runId = String(artifact?.runId ?? "");
  if (!runId || !/^[A-Za-z0-9._:-]{1,80}$/.test(runId)) {
    const usage = {
      version: 1,
      backend: "codex",
      lane: "no-mistakes",
      model,
      effort,
      complete: artifact?.outcome === "setup-failed",
      calls: [],
    };
    writePrivateFile(outputFile, `${JSON.stringify(usage, null, 2)}\n`);
    return usage;
  }
  const execute = dependencies.runCommand ?? runCommand;
  const stats = execute(
    "no-mistakes",
    ["stats", "--run", runId, "--agents"],
    { cwd: resolve(repoDir), env: gateEnvironment(process.env) },
  );
  const usage = parseNoMistakesUsageStats(stats.stdout, {
    runId,
    model,
    effort,
  });
  writePrivateFile(outputFile, `${JSON.stringify(usage, null, 2)}\n`);
  return usage;
}

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

export function parseGateFindings(output) {
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
  const gateIndex = lines.findIndex((line) => /^gate:(?:\s+\S+)?\s*$/.test(line));
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
    if (exitStatus === 0 && PASSING_OUTCOMES.has(outcome)) {
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

function gateGit(execute, gateDir, args, options = {}) {
  return execute("git", ["--git-dir", gateDir, ...args], options);
}

export function assertNativeFixPatchExcludesSecrets(patch, environment = process.env) {
  const content = Buffer.isBuffer(patch) ? patch : Buffer.from(String(patch ?? ""));
  if (content.includes(Buffer.from("\nGIT binary patch\n"))) {
    throw new AgentError("native no-mistakes fixes cannot contain binary changes", 1);
  }
  for (const [name, rawValue] of Object.entries(environment ?? {})) {
    const value = String(rawValue ?? "");
    if (
      SECRET_ENV_NAME.test(name) &&
      value.length >= MIN_SCANNED_SECRET_LENGTH &&
      content.includes(Buffer.from(value))
    ) {
      throw new AgentError("native no-mistakes fix patch contains a credential value", 1);
    }
  }
  return true;
}

export function createNativeFixPatch(
  gate,
  expectedHead,
  patchPath,
  {
    nmHome = process.env.NM_HOME,
    environment = process.env,
    execute = runCommand,
    readDirectory = readdirSync,
    publishedHead = expectedHead,
  } = {},
) {
  if (gate?.status !== "passed" || !gate?.run?.head) return null;
  const home = String(nmHome ?? "").trim();
  if (!home) throw new AgentError("missing no-mistakes home for native fixes", 1);
  const reposDir = resolve(home, "repos");
  let entries;
  try {
    entries = readDirectory(reposDir, { withFileTypes: true });
  } catch {
    throw new AgentError("no-mistakes gate repository is unavailable", 1);
  }
  const matches = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.endsWith(".git")) continue;
    const gateDir = join(reposDir, entry.name);
    const base = gateGit(execute, gateDir, ["rev-parse", `${expectedHead}^{commit}`], {
      check: false,
    });
    const fixed = gateGit(execute, gateDir, ["rev-parse", `${gate.run.head}^{commit}`], {
      check: false,
    });
    if (base.status === 0 && fixed.status === 0) {
      matches.push({
        gateDir,
        baseHead: base.stdout.trim(),
        fixedHead: fixed.stdout.trim(),
      });
    }
  }
  if (matches.length !== 1) {
    throw new AgentError("could not uniquely resolve the no-mistakes fix repository", 1);
  }
  const match = matches[0];
  if (match.baseHead !== expectedHead) {
    throw new AgentError("no-mistakes fix base does not match the prepared head", 1);
  }
  if (match.fixedHead === expectedHead) return null;
  const ancestry = gateGit(
    execute,
    match.gateDir,
    ["merge-base", "--is-ancestor", expectedHead, match.fixedHead],
    { check: false },
  );
  if (ancestry.status !== 0) {
    throw new AgentError("no-mistakes fixes are not based on the prepared head", 1);
  }
  const paths = gateGit(execute, match.gateDir, [
    "diff",
    "--name-only",
    "--no-renames",
    "-z",
    expectedHead,
    match.fixedHead,
    "--",
    ".",
  ]).stdout
    .split("\0")
    .filter(Boolean);
  if (!paths.length) throw new AgentError("no-mistakes fix commit has no effective changes", 1);
  const privileged = privilegedCandidatePaths(paths);
  if (privileged.length) {
    throw new AgentError("no-mistakes fix touched privileged candidate paths", 1, {
      paths: privileged,
    });
  }
  const patch = gateGit(execute, match.gateDir, [
    "diff",
    "--binary",
    "--no-ext-diff",
    expectedHead,
    match.fixedHead,
    "--",
    ".",
  ]).stdout;
  if (!patch.trim()) throw new AgentError("no-mistakes fix patch is empty", 1);
  if (Buffer.byteLength(patch) > MAX_NATIVE_FIX_PATCH_BYTES) {
    throw new AgentError("no-mistakes fix patch exceeds the trusted size limit", 1);
  }
  assertNativeFixPatchExcludesSecrets(patch, environment);
  const fixedTree = gateGit(execute, match.gateDir, ["rev-parse", `${match.fixedHead}^{tree}`]).stdout.trim();
  writePrivateFile(patchPath, patch);
  return {
    baseHead: publishedHead,
    fixedHead: match.fixedHead,
    fixedTree,
    patchSha256: createHash("sha256").update(patch).digest("hex"),
    paths,
  };
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
      if (typeof path !== "string" || !path || path.length > 500 || /[\u0000-\u001f\u007f\\]/.test(path)) {
        return true;
      }
      const segments = path.split("/");
      return path.startsWith("/") || segments.some((segment) => !segment || segment === "." || segment === "..");
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
    version: ARTIFACT_VERSION,
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
  if (value.version !== ARTIFACT_VERSION) {
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
    (!PASSING_OUTCOMES.has(value.outcome) ||
      value.validatedHead !== expectedHead)
  ) {
    throw new AgentError("sanitized gate artifact cannot prove this head", 1);
  }
  if (!Array.isArray(value.findings) || value.findings.length > 100) {
    throw new AgentError("sanitized gate artifact findings are invalid", 1);
  }
  const nativeFix = normalizeNativeFix(value.nativeFix, expectedHead);
  if ((value.outcome === "native-fix") !== Boolean(nativeFix) || (nativeFix && value.status !== "blocked")) {
    throw new AgentError("sanitized gate artifact native fix state is invalid", 1);
  }
  return {
    version: ARTIFACT_VERSION,
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

function actionsRunUrl(env = process.env) {
  const { GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID } = env;
  if (!GITHUB_SERVER_URL || !GITHUB_REPOSITORY || !GITHUB_RUN_ID) return "";
  return `${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}`;
}

export function validateNoMistakesRemoteRecord(config, path) {
  const record = JSON.parse(readFileSync(resolve(path), "utf8"));
  const providers = new Set(config.crabbox?.nonVisualProviders ?? []);
  const attempted = record?.attempted === true;
  const providerValid = attempted
    ? providers.has(record?.provider)
    : record?.provider === "";
  const leaseValid = attempted
    ? record?.ok
      ? /^[A-Za-z0-9._:-]+$/.test(String(record?.leaseId ?? ""))
      : !record?.leaseId ||
        /^[A-Za-z0-9._:-]+$/.test(String(record.leaseId))
    : record?.leaseId === "";
  const timingValid = record?.timing
    ? record.timing.provider === record.provider &&
      record.timing.leaseId === record.leaseId &&
      Number.isInteger(record.timing.exitCode) &&
      Number.isFinite(record.timing.totalMs) &&
      record.timing.totalMs >= 0
    : !record?.ok;
  if (
    typeof record?.ok !== "boolean" ||
    typeof record?.attempted !== "boolean" ||
    record?.lane !== "noMistakesRemote" ||
    !providerValid ||
    !leaseValid ||
    !timingValid ||
    (record.ok && (!attempted || record.timing.exitCode !== 0 || String(record?.reason ?? "")))
  ) {
    throw new AgentError("Crabbox no-mistakes provenance is invalid", 1);
  }
  return {
    provider: record.provider,
    leaseId: record.leaseId,
    totalMs: record.timing?.totalMs ?? 0,
    ok: record.ok,
    reason: String(record.reason ?? ""),
  };
}

function fetchPullSnapshot(config, prNumber) {
  return getPullSnapshot(config, prNumber);
}

function fetchTrustedPull(config, prNumber, dependencies = {}) {
  const snapshot = fetchPullSnapshot(config, prNumber);
  const trust = assertTrustedAgentPull(snapshot.pull, config, snapshot.files, dependencies);
  return { ...snapshot, trust };
}

export function resolvePullMergeBase(config, pull, dependencies = {}) {
  const baseSha = String(pull?.base?.sha ?? "");
  const headSha = String(pull?.head?.sha ?? "");
  if (!/^[0-9a-f]{40}$/.test(baseSha) || !/^[0-9a-f]{40}$/.test(headSha)) {
    throw new AgentError("no-mistakes pull comparison requires exact commit SHAs", 1);
  }
  const apiJson = dependencies.ghApiJson ?? ghApiJson;
  const comparison = apiJson(
    `repos/${config.repo.owner}/${config.repo.name}/compare/${baseSha}...${headSha}`,
  );
  const mergeBaseSha = String(comparison?.merge_base_commit?.sha ?? "");
  if (!/^[0-9a-f]{40}$/.test(mergeBaseSha)) {
    throw new AgentError("no-mistakes pull comparison has no exact merge base", 1);
  }
  const commit = apiJson(
    `repos/${config.repo.owner}/${config.repo.name}/git/commits/${mergeBaseSha}`,
  );
  const mergeBaseTree = String(commit?.tree?.sha ?? "");
  if (
    commit?.sha !== mergeBaseSha ||
    !/^[0-9a-f]{40}$/.test(mergeBaseTree)
  ) {
    throw new AgentError("no-mistakes merge base has no trusted Git tree", 1);
  }
  return { sha: mergeBaseSha, tree: mergeBaseTree };
}

export function resolveTrustedDefaultCommit(config, dependencies = {}) {
  const apiJson = dependencies.ghApiJson ?? ghApiJson;
  const root = `repos/${config.repo.owner}/${config.repo.name}`;
  const branch = String(config.repo.defaultBranch ?? "");
  if (!/^[A-Za-z0-9._/-]+$/.test(branch)) {
    throw new AgentError("no-mistakes trusted default branch is invalid", 1);
  }
  const tip = apiJson(`${root}/commits/${branch}`);
  const sha = String(tip?.sha ?? "");
  if (!/^[0-9a-f]{40}$/.test(sha)) {
    throw new AgentError("no-mistakes trusted default branch has no exact commit", 1);
  }
  const commit = apiJson(`${root}/git/commits/${sha}`);
  const tree = String(commit?.tree?.sha ?? "");
  if (commit?.sha !== sha || !/^[0-9a-f]{40}$/.test(tree)) {
    throw new AgentError("no-mistakes trusted default commit has no Git tree", 1);
  }
  return { branch, sha, tree };
}

export function assertTrustedIntentSource(config, snapshot, context, dependencies = {}) {
  return assertSharedTrustedAgentPull(
    snapshot.pull,
    config,
    {
      files: snapshot.files,
      sourceIssue: context.sourceIssue,
      rejectPrivilegedPaths: true,
    },
    dependencies,
  );
}

function fetchIntentContext(config, sourceIssueNumber, pull) {
  const root = `repos/${config.repo.owner}/${config.repo.name}`;
  const sourceIssue = ghApiJson(`${root}/issues/${sourceIssueNumber}`);
  if (sourceIssue?.pull_request) {
    throw new AgentError(
      `#${sourceIssueNumber} is a pull request, not a source issue`,
      1,
    );
  }
  const comments = getIssueComments(config, sourceIssueNumber);
  const triageComment = selectTrustedManagedTriageComment(
    comments,
    config.comments.triage,
    config.repo.owner,
  );
  if (!triageComment) {
    throw new AgentError(
      `source issue #${sourceIssueNumber} has no trusted managed triage context`,
      1,
    );
  }
  const { capsule } = intentCapsuleForManagedTriage({
    issue: sourceIssue,
    comments,
    triageComment,
    marker: config.comments.triage,
    repoOwner: config.repo.owner,
  });
  const metadata = parseImplementationMetadata(pull?.body);
  const implementationAddendum = parseImplementationAddendum(pull?.body);
  if (
    metadata.intentDigest !== capsule.intentDigest ||
    metadata.implementationAddendumDigest !== implementationAddendum.digest
  ) {
    throw new AgentError(
      "no-mistakes intent context does not match immutable implementation metadata",
      1,
    );
  }
  return {
    sourceIssue,
    triageComment,
    intentCapsule: capsule,
    implementationAddendum,
  };
}

function markPending(config, pull, dryRun) {
  return setCommitStatus({
    config,
    sha: pull.head.sha,
    state: "pending",
    context: STATUS_CONTEXT,
    description: "no-mistakes gate running",
    targetUrl: actionsRunUrl(),
    dryRun,
  });
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

function artifactBlocker(artifact, repairAttempt = 0, repairDecision = null) {
  if (artifact.status === "passed") return "";
  const repair = repairDecision ?? gateRepairDecision(artifact, repairAttempt);
  if (repair.state === "retry") {
    return `automatic reviewer repair pending (${repair.nextAttempt}/${MAX_GATE_REPAIR_ATTEMPTS})`;
  }
  if (repair.state === "exhausted") {
    return artifact.outcome === "native-fix"
      ? "native no-mistakes fix publication limit exhausted"
      : "automatic reviewer repair limit exhausted";
  }
  if (repair.state === "native-fix") {
    return `native no-mistakes fixes ready to publish (${repair.nextAttempt}/${MAX_GATE_REPAIR_ATTEMPTS})`;
  }
  if (repair.state === "unchanged") {
    return "unchanged exact-head findings already recorded; automatic repair stopped";
  }
  if (artifact.outcome === "invalid-output") {
    return "no-mistakes output remained invalid after its bounded internal retry";
  }
  if (artifact.outcome === "ask-user") {
    return "no-mistakes requires a product or user decision";
  }
  if (artifact.outcome === "head-mismatch") {
    return "validated commit does not match the prepared PR head";
  }
  if (artifact.outcome === "unpublished-changes") {
    return "no-mistakes produced unpublished changes; rerun after landing them";
  }
  if (artifact.outcome === "setup-failed") {
    return "isolated no-mistakes setup did not produce a valid result";
  }
  if (artifact.outcome === "model-interrupted") {
    return "no-mistakes stopped after model execution began; automatic replay was suppressed";
  }
  return "no-mistakes did not return a passing terminal outcome";
}

export function gateCommentBody({
  artifact,
  branch,
  sha,
  runUrl,
  repairAttempt = 0,
  repairDecision = null,
  remote = null,
}) {
  return `## no-mistakes Gate

Status: ${artifact.status}
Branch: ${branch}
Head: ${sha}
Gate mode: ${artifact.userApproved ? "user-approved unattended run for this exact head" : "interactive; ask-user decisions block"}
${runUrl ? `Actions run: ${runUrl}\n` : ""}
${remote ? `Crabbox provider: ${remote.provider}\nCrabbox lease: ${remote.leaseId}\nCrabbox duration: ${remote.totalMs} ms\n` : ""}
Arbitrary finding descriptions, source intent, and process output are omitted. Known infrastructure summaries use an exact allowlist.

Structured gate:
${markdownJsonBlock({
  status: artifact.status,
  outcome: artifact.outcome,
  runId: artifact.runId || "",
  userApproved: artifact.userApproved,
  failureStage: artifact.failureStage || "",
  checksRun: [
    "trusted offline typecheck, build, and scenarios baseline",
    `no-mistakes axi run${artifact.userApproved ? " --yes" : ""} --skip rebase,test,document,lint,push,pr,ci`,
  ],
  findings: artifact.findings,
  blocker: artifactBlocker(artifact, repairAttempt, repairDecision),
})}`;
}

export function gateLabelChanges(
  config,
  artifact,
  {
    repairAttempt = 0,
    repairDecision = null,
    recoveredSetupFailure = false,
  } = {},
) {
  if (
    artifact?.status === "passed" &&
    (artifact?.userApproved || recoveredSetupFailure)
  ) {
    return {
      add: [config.labels.automerge],
      remove: [config.labels.blocked],
    };
  }
  if (artifact?.status === "passed") return { add: [], remove: [] };
  const repair = repairDecision ?? gateRepairDecision(artifact, repairAttempt);
  if (["retry", "native-fix"].includes(repair.state)) {
    return { add: [], remove: [] };
  }
  return {
    add: [config.labels.blocked],
    remove: [config.labels.automerge],
  };
}

function sortedUnique(values) {
  return [...new Set(values)].sort();
}

export function applyNativeFixPatch(
  { artifact, config, patchPath, pull, repairAttempt = 0, dryRun = false },
  dependencies = {},
) {
  const decision = gateRepairDecision(artifact, repairAttempt);
  if (decision.state !== "native-fix") {
    throw new AgentError("native no-mistakes fix is not eligible for publication", 1);
  }
  const execute = dependencies.runCommand ?? runCommand;
  const readFile = dependencies.readFileSync ?? readFileSync;
  const patch = readFile(resolve(patchPath));
  const patchSha256 = createHash("sha256").update(patch).digest("hex");
  if (patchSha256 !== artifact.nativeFix.patchSha256) {
    throw new AgentError("native no-mistakes fix patch digest does not match", 1);
  }
  const expectedHead = artifact.expectedHead;
  if (pull.head.sha !== expectedHead) {
    throw new AgentError("PR head changed before native no-mistakes fixes could publish", 1);
  }
  const headRef = String(pull.head.ref ?? "");
  if (!/^agent\/issue-\d+-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(headRef)) {
    throw new AgentError("native no-mistakes fix target branch is invalid", 1);
  }
  if (dryRun) {
    return {
      nextHead: "",
      nextRepairAttempt: decision.nextAttempt,
      paths: artifact.nativeFix.paths,
      dryRun: true,
    };
  }
  const publishEnv =
    (dependencies.publisherEnvironment ?? publisherEnvironment)(
      dependencies.env ?? process.env,
    );
  execute("gh", ["auth", "setup-git", "--hostname", "github.com"], {
    env: publishEnv,
  });
  execute("git", [
    "fetch",
    "--no-tags",
    "origin",
    `+refs/heads/${headRef}:refs/remotes/origin/${headRef}`,
  ], { env: publishEnv });
  const fetchedHead = execute("git", ["rev-parse", `refs/remotes/origin/${headRef}^{commit}`]).stdout.trim();
  if (fetchedHead !== expectedHead) {
    throw new AgentError("remote PR head changed before native no-mistakes fix application", 1);
  }
  execute("git", ["switch", "--detach", expectedHead]);
  execute("git", ["apply", "--index", "--binary", resolve(patchPath)]);
  const stagedPaths = execute("git", [
    "diff",
    "--cached",
    "--name-only",
    "--no-renames",
    "-z",
  ]).stdout
    .split("\0")
    .filter(Boolean);
  if (
    JSON.stringify(sortedUnique(stagedPaths)) !==
    JSON.stringify(sortedUnique(artifact.nativeFix.paths))
  ) {
    throw new AgentError("native no-mistakes fix patch paths do not match its manifest", 1);
  }
  const privileged = privilegedCandidatePaths(stagedPaths);
  if (privileged.length) {
    throw new AgentError("native no-mistakes fix patch touched privileged candidate paths", 1, {
      paths: privileged,
    });
  }
  const stagedTree = execute("git", ["write-tree"]).stdout.trim();
  if (stagedTree !== artifact.nativeFix.fixedTree) {
    throw new AgentError("native no-mistakes fix tree does not match its isolated result", 1);
  }
  execute("git", ["config", "user.name", "github-actions[bot]"]);
  execute("git", [
    "config",
    "user.email",
    "41898282+github-actions[bot]@users.noreply.github.com",
  ]);
  execute("git", [
    "commit",
    "-m",
    implementationCommitMessage(
      "fix: apply no-mistakes review fixes",
      parseImplementationMetadata(pull.body),
    ),
  ]);
  const nextHead = execute("git", ["rev-parse", "HEAD"]).stdout.trim();
  execute("git", [
    "push",
    "origin",
    `HEAD:refs/heads/${headRef}`,
    `--force-with-lease=refs/heads/${headRef}:${expectedHead}`,
  ], { env: publishEnv });
  const remoteHead = execute(
    "git",
    ["ls-remote", "origin", `refs/heads/${headRef}`],
    { env: publishEnv },
  ).stdout
    .trim()
    .split(/\s+/)[0];
  if (remoteHead !== nextHead) {
    throw new AgentError("published no-mistakes fix does not match the remote PR head", 1);
  }
  return { nextHead, nextRepairAttempt: decision.nextAttempt, paths: stagedPaths };
}

function recordNativeFix({
  artifact,
  config,
  nextHead,
  pull,
  repairAttempt,
  remote = null,
  dryRun = false,
}) {
  const runUrl = actionsRunUrl();
  const status = setCommitStatus({
    config,
    sha: artifact.expectedHead,
    state: "failure",
    context: STATUS_CONTEXT,
    description: "superseded by no-mistakes fixes",
    targetUrl: runUrl,
    dryRun,
  });
  const comment = upsertManagedComment({
    config,
    number: pull.number,
    marker: noMistakesCommentMarker(config),
    body: `## no-mistakes Gate

Status: repaired
Branch: ${pull.head.ref}
Previous head: ${artifact.expectedHead}
Next head: ${nextHead}
${runUrl ? `Actions run: ${runUrl}\n` : ""}
${remote ? `Crabbox provider: ${remote.provider}\nCrabbox lease: ${remote.leaseId}\nCrabbox duration: ${remote.totalMs} ms\n` : ""}
Native review auto-fix produced and published a credential-free patch.
Fresh exact-head CI, independent review, and no-mistakes validation are required before merge.

Structured gate:
${markdownJsonBlock({
  status: "repaired",
  outcome: "native-fix",
  runId: artifact.runId || "",
  previousHead: artifact.expectedHead,
  nextHead,
  fixAttempt: readRepairAttempt(repairAttempt) + 1,
  changedFiles: artifact.nativeFix.paths.length,
})}`,
    dryRun,
  });
  return { comment, status };
}

export function finalizeNativeFixPublication({
  artifact,
  config,
  pull,
  repairAttempt,
  patchPath,
  remote = null,
  dryRun = false,
  applyPatch = applyNativeFixPatch,
  recordFix = recordNativeFix,
  setOutput = setGitHubOutput,
}) {
  const published = applyPatch({
    artifact,
    config,
    patchPath,
    pull,
    repairAttempt,
    remote,
    dryRun,
  });
  const result = recordFix({
    artifact,
    config,
    nextHead: published.nextHead || "new exact-head commit created on publish",
    pull,
    repairAttempt,
    remote,
    dryRun,
  });
  setOutput({
    "repair-action": "native-fix",
    "next-head": published.nextHead,
    "next-repair-attempt": published.nextRepairAttempt,
  });
  return { published, result };
}

export function terminalHeadBinding(expectedHead, currentHead) {
  if (!/^[0-9a-f]{40}$/.test(String(expectedHead ?? ""))) {
    throw new AgentError("terminal status head is invalid", 2);
  }
  return {
    mutatePull: expectedHead === currentHead,
    statusSha: expectedHead,
  };
}

function recordTerminal({
  config,
  pull,
  artifact,
  statusSha = pull.head.sha,
  mutatePull = true,
  repairAttempt = 0,
  repairDecision = null,
  recoveredSetupFailure = false,
  remote = null,
  dryRun = false,
}) {
  const failed = artifact.status !== "passed";
  const runUrl = actionsRunUrl();
  const commitStatus = setCommitStatus({
    config,
    sha: statusSha,
    state: failed ? "failure" : "success",
    context: STATUS_CONTEXT,
    description: failed
      ? `no-mistakes ${artifact.status}`
      : "no-mistakes passed",
    targetUrl: runUrl,
    dryRun,
  });
  if (!mutatePull) {
    return {
      labels: { added: [], removed: [] },
      comment: null,
      status: commitStatus,
    };
  }
  const labelChanges = gateLabelChanges(config, artifact, {
    repairAttempt,
    repairDecision,
    recoveredSetupFailure,
  });
  const labels = {
    added: addLabels(config, pull.number, labelChanges.add, dryRun),
    removed: removeLabels(config, pull.number, labelChanges.remove, dryRun),
  };
  const comment = upsertManagedComment({
    config,
    number: pull.number,
    marker: noMistakesCommentMarker(config),
    body: gateCommentBody({
      artifact,
      branch: pull.head.ref,
      sha: pull.head.sha,
      runUrl,
      repairAttempt,
      repairDecision,
      remote,
    }),
    dryRun,
  });
  return { labels, comment, status: commitStatus };
}

export function gateEnvironment(source = process.env) {
  const env = { ...source };
  for (const name of [
    "AGENT_GITHUB_TOKEN",
    "AGENT_PAT",
    "GATE_INTENT",
    "GITHUB_TOKEN",
    "GH_TOKEN",
    "OPENAI_API_KEY",
    "ACTIONS_RUNTIME_TOKEN",
    "ACTIONS_ID_TOKEN_REQUEST_TOKEN",
    "ACTIONS_ID_TOKEN_REQUEST_URL",
    "ACTIONS_CACHE_URL",
    "ACTIONS_RESULTS_URL",
  ]) {
    delete env[name];
  }
  return env;
}

export function runNoMistakesGate(intent, repoDir, dependencies = {}) {
  const env = gateEnvironment(dependencies.env ?? process.env);
  const execute = dependencies.runCommand ?? runCommand;
  const spawn = dependencies.spawnSync ?? spawnSync;
  const onRetry =
    dependencies.onRetry ??
    (() =>
      process.stderr.write(
        "retrying no-mistakes once after an isolated gate infrastructure failure\n",
      ));
  const onReattach =
    dependencies.onReattach ??
    (() =>
      process.stderr.write(
        "reattaching to the active no-mistakes run after a transient client timeout\n",
      ));
  const maxReattachments = dependencies.maxReattachments ?? 12;
  const modelStarted = dependencies.modelStarted ?? (() => false);

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    execute("no-mistakes", ["init"], { cwd: repoDir, env });
    const axiArgs = [
      "axi",
      "run",
      ...(dependencies.userApproved ? ["--yes"] : []),
      "--intent",
      intent,
      "--skip",
      "rebase,test,document,lint,push,pr,ci",
    ];
    let run;
    let parsed;
    let reattachExhausted = false;
    for (let attachment = 0; attachment <= maxReattachments; attachment += 1) {
      const result = spawn("no-mistakes", axiArgs, {
        cwd: repoDir,
        env,
        encoding: "utf8",
        stdio: "pipe",
      });
      if (result.error) {
        throw new AgentError("no-mistakes gate could not start", 1);
      }
      run = {
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? "",
        status: result.status ?? 1,
        attempts: attempt,
        attachments: attachment + 1,
      };
      const output = `${run.stdout}\n${run.stderr}`.trim();
      parsed = parseAxiResult(output, run.status);
      if (!isRetryableInvalidOutput(parsed) || !isReattachableAxiError(output)) {
        break;
      }
      if (attachment === maxReattachments) {
        reattachExhausted = true;
        break;
      }
      onReattach(parsed);
    }
    if (
      attempt === 1 &&
      !reattachExhausted &&
      !modelStarted() &&
      (isRetryableReviewEnvironmentBlock(parsed) ||
        isRetryableTestEnvironmentBlock(parsed) ||
        isRetryableInvalidOutput(parsed) ||
        isRetryableTechnicalFailure(parsed, dependencies.expectedHead))
    ) {
      execute("no-mistakes", ["daemon", "stop", "--force"], {
        cwd: repoDir,
        env,
      });
      onRetry(parsed);
      continue;
    }
    return run;
  }
  throw new AgentError("no-mistakes retry limit was exhausted", 1);
}

function writePrivateFile(path, content, mode = 0o600) {
  const target = resolve(path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content, { mode });
  chmodSync(target, mode);
  return target;
}

export function codexTurnMarkerWrapper({ codexPath, markerPath }) {
  const resolvedCodexPath = String(codexPath ?? "").trim();
  const resolvedMarkerPath = String(markerPath ?? "").trim();
  if (
    !isAbsolute(resolvedCodexPath) ||
    !existsSync(resolvedCodexPath) ||
    !isAbsolute(resolvedMarkerPath) ||
    !existsSync(dirname(resolvedMarkerPath))
  ) {
    throw new AgentError("no-mistakes Codex marker paths are invalid", 2);
  }
  return `#!/usr/bin/env node
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const codexPath = ${JSON.stringify(resolvedCodexPath)};
const markerPath = ${JSON.stringify(resolvedMarkerPath)};
const child = spawn(codexPath, process.argv.slice(2), {
  env: process.env,
  stdio: ["inherit", "pipe", "inherit"],
});
let markerError = false;
let marked = false;
let pending = "";

child.stdout.on("data", (chunk) => {
  process.stdout.write(chunk);
  if (marked || markerError) return;
  pending += chunk.toString("utf8");
  let newline = pending.indexOf("\\n");
  while (newline !== -1) {
    const line = pending.slice(0, newline);
    pending = pending.slice(newline + 1);
    try {
      if (JSON.parse(line)?.type === "turn.started") {
        writeFileSync(markerPath, "started\\n", { mode: 0o600 });
        marked = true;
        pending = "";
        return;
      }
    } catch (error) {
      if (error?.code) {
        markerError = true;
        process.stderr.write("Codex model-start marker could not be written\\n");
        child.kill("SIGTERM");
        return;
      }
    }
    newline = pending.indexOf("\\n");
  }
  if (pending.length > 1_048_576) pending = pending.slice(-65_536);
});

child.once("error", () => {
  markerError = true;
  process.stderr.write("Codex invocation could not start\\n");
});
child.once("close", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(
    markerError || !Number.isInteger(code) || code < 0 ? 1 : code,
  );
});
`;
}

export function writeCodexTurnMarkerWrapper({
  outputFile,
  codexPath,
  markerPath,
}) {
  const resolvedOutputFile = String(outputFile ?? "").trim();
  if (!isAbsolute(resolvedOutputFile)) {
    throw new AgentError("missing no-mistakes Codex wrapper path", 2);
  }
  return writePrivateFile(
    resolvedOutputFile,
    codexTurnMarkerWrapper({ codexPath, markerPath }),
    0o700,
  );
}

function readExpectedHead(value) {
  const sha = String(value ?? "").trim();
  if (!/^[0-9a-f]{40}$/.test(sha)) {
    throw new AgentError("missing or invalid --expected-head", 2);
  }
  return sha;
}

function readInfrastructureRetry(value) {
  const retry = Number(value ?? 0);
  if (!Number.isInteger(retry) || retry < 0 || retry > MAX_INFRASTRUCTURE_RETRIES) {
    throw new AgentError("no-mistakes infrastructure retry is invalid", 2);
  }
  return retry;
}

function readRepairAttempt(value) {
  const attempt = Number(value ?? 0);
  if (!Number.isInteger(attempt) || attempt < 0 || attempt > MAX_GATE_REPAIR_ATTEMPTS) {
    throw new AgentError("no-mistakes repair attempt is invalid", 2);
  }
  return attempt;
}

export function setupFailureArtifact(expectedHead, { modelStarted = false } = {}) {
  return {
    version: ARTIFACT_VERSION,
    status: "failed",
    outcome: modelStarted ? "model-interrupted" : "setup-failed",
    expectedHead,
    validatedHead: "",
    runId: "",
    userApproved: false,
    failureStage: "",
    findings: [],
    nativeFix: null,
  };
}

export function writeSetupFailureResult({
  expectedHead,
  resultFile,
  usageFile = "",
  model = "",
  effort = "",
  modelStarted = false,
}) {
  if (!resultFile) {
    throw new AgentError("missing no-mistakes setup failure result path", 2);
  }
  const artifact = setupFailureArtifact(readExpectedHead(expectedHead), {
    modelStarted,
  });
  const resultPath = writePrivateFile(
    resultFile,
    `${JSON.stringify(artifact, null, 2)}\n`,
  );
  let usagePath = "";
  if (usageFile) {
    usagePath = writePrivateFile(
      usageFile,
      `${JSON.stringify({
        version: 1,
        backend: "codex",
        lane: "no-mistakes",
        model,
        effort,
        complete: !modelStarted,
        calls: [],
      }, null, 2)}\n`,
    );
  }
  return { artifact, resultPath, usagePath };
}

async function main() {
  const args = parseArgs();
  const config = loadConfig();
  const dryRun = Boolean(args["dry-run"]);
  const prNumber = Number(args["pr-number"]);

  if (args["write-setup-failure"]) {
    const result = writeSetupFailureResult({
      expectedHead: args["expected-head"],
      resultFile: args["result-file"],
      usageFile: args["usage-file"],
      model: args.model,
      effort: args.effort,
      modelStarted:
        Boolean(args["model-started-file"]) &&
        existsSync(resolve(String(args["model-started-file"]))),
    });
    finish(
      {
        ok: true,
        message: "wrote terminal no-mistakes setup failure",
        resultPath: result.resultPath,
        usagePath: result.usagePath,
      },
      Boolean(args.json),
    );
    return;
  }

  if (args["write-codex-wrapper"]) {
    const path = writeCodexTurnMarkerWrapper({
      outputFile: args["write-codex-wrapper"],
      codexPath: args["codex-path"],
      markerPath: args["model-started-file"],
    });
    finish(
      { ok: true, message: "wrote Codex turn marker wrapper", path },
      Boolean(args.json),
    );
    return;
  }

  if (args["write-config"]) {
    const path = writePrivateFile(
      args["write-config"],
      noMistakesConfig({
        model: args.model,
        effort: args.effort,
        agentPath: args["agent-path"],
      }),
    );
    finish(
      { ok: true, message: "wrote isolated no-mistakes configuration", path },
      Boolean(args.json),
    );
    return;
  }

  if (args["export-usage"]) {
    const usage = exportNoMistakesUsage({
      resultFile: args["export-usage"],
      outputFile: args["output-file"],
      model: args.model,
      effort: args.effort,
      repoDir: args["repo-dir"],
    });
    finish(
      {
        ok: usage.complete,
        message: usage.complete
          ? "exported exact no-mistakes usage"
          : "no-mistakes usage is incomplete",
        calls: usage.calls.length,
      },
      Boolean(args.json),
      usage.complete ? 0 : 1,
    );
    return;
  }

  if (args.prepare) {
    if (!Number.isInteger(prNumber)) {
      throw new AgentError("missing --pr-number", 2);
    }
    const snapshot = fetchTrustedPull(config, prNumber, { ghApiJson });
    const { pull, trust } = snapshot;
    const expectedHead = readExpectedHead(args["expected-head"]);
    if (pull.head.sha !== expectedHead) {
      throw new AgentError("PR head changed before no-mistakes preparation", 1);
    }
    const mergeBase = resolvePullMergeBase(config, pull, { ghApiJson });
    const trustedDefault = resolveTrustedDefaultCommit(config, { ghApiJson });
    const context = fetchIntentContext(config, trust.sourceIssue, pull);
    assertTrustedIntentSource(config, snapshot, context, { ghApiJson });
    const commit = ghApiJson(
      `repos/${config.repo.owner}/${config.repo.name}/git/commits/${expectedHead}`,
    );
    const headTree = String(commit?.tree?.sha ?? "");
    if (!/^[0-9a-f]{40}$/.test(headTree)) {
      throw new AgentError("PR head has no trusted Git tree", 1);
    }
    if (args["intent-file"]) {
      const intent = composeEffectiveIntent({
        callerIntent: args.intent,
        ...context,
      });
      if (!dryRun) writePrivateFile(args["intent-file"], `${intent}\n`);
    }
    const comments = getIssueComments(config, prNumber);
    let repairLedger = loadRepairLedger(
      comments,
      context.intentCapsule.intentDigest,
      config.repo.owner,
    );
    const inputDigest = semanticInputDigest({
      lane: "no-mistakes",
      head: expectedHead,
      intentDigest: context.intentCapsule.intentDigest,
      findings: openRepairFindings(repairLedger).filter(
        (finding) => finding.lane !== "no-mistakes",
      ),
      checks: [{
        name: "owner-approval",
        state: readApprovalState(args["approval-state"])
          ? "approved"
          : "not-approved",
      }],
    });
    const replayEvaluation = repairEvaluationFor(repairLedger, {
      lane: "no-mistakes",
      head: expectedHead,
      inputDigest,
    });
    let replay = noMistakesReplayState(replayEvaluation);
    const recoveredSetupFailure =
      replay.replayPassed &&
      setupFailureRecoveryEligible({
        config,
        ledger: repairLedger,
        head: expectedHead,
        inputDigest,
        passProven: replayEvaluation.outcome === "passed-proven",
        sourceIssue: context.sourceIssue,
      });
    let recoveryLabels = null;
    let recoveryLedgerComment = null;
    if (recoveredSetupFailure) {
      const changes = gateLabelChanges(
        config,
        { status: "passed", outcome: replayEvaluation.outcome },
        { recoveredSetupFailure: true },
      );
      recoveryLabels = {
        added: addLabels(config, pull.number, changes.add, dryRun),
        removed: removeLabels(config, pull.number, changes.remove, dryRun),
      };
      repairLedger = recordRepairEvaluation(repairLedger, {
        lane: "no-mistakes",
        head: expectedHead,
        inputDigest,
        findings: [],
        outcome: "passed-recovered",
      }).ledger;
      recoveryLedgerComment = saveRepairLedger({
        config,
        prNumber,
        ledger: repairLedger,
        dryRun,
      });
      replay = noMistakesReplayState(repairEvaluationFor(repairLedger, {
        lane: "no-mistakes",
        head: expectedHead,
        inputDigest,
      }));
    }
    const status = replay.skipModel ? null : markPending(config, pull, dryRun);
    setGitHubOutput({
      default_branch: trustedDefault.branch,
      default_sha: trustedDefault.sha,
      default_tree: trustedDefault.tree,
      merge_base_sha: mergeBase.sha,
      merge_base_tree: mergeBase.tree,
      head_sha: pull.head.sha,
      head_ref: pull.head.ref,
      head_tree: headTree,
      replay_passed: replay.replayPassed,
      skip_model: replay.skipModel,
      shared_revision_count: repairLedger.revisionCount,
    });
    finish(
      {
        ok: true,
        message: replay.skipModel
          ? `no-mistakes already evaluated for PR #${prNumber}`
          : `no-mistakes pending for PR #${prNumber}`,
        status,
        recoveredSetupFailure,
        recoveryLabels,
        recoveryLedgerComment,
        ...replay,
      },
      Boolean(args.json),
    );
    return;
  }

  if (args["prepare-gate"]) {
    if (!Number.isInteger(prNumber)) {
      throw new AgentError("missing --pr-number", 2);
    }
    const expectedHead = readExpectedHead(args["expected-head"]);
    const snapshot = fetchTrustedPull(config, prNumber, { ghApiJson });
    const { pull, trust } = snapshot;
    if (pull.head.sha !== expectedHead) {
      throw new AgentError("PR head changed after the pending status", 1);
    }
    const context = fetchIntentContext(config, trust.sourceIssue, pull);
    assertTrustedIntentSource(config, snapshot, context, { ghApiJson });
    const intent = composeEffectiveIntent({ callerIntent: args.intent, ...context });
    if (!dryRun) writePrivateFile(args["intent-file"], `${intent}\n`);
    finish(
      {
        ok: true,
        message: `prepared isolated no-mistakes context for PR #${prNumber}`,
        head: expectedHead,
      },
      Boolean(args.json),
    );
    return;
  }

  if (args["run-gate"]) {
    const expectedHead = readExpectedHead(args["expected-head"]);
    const expectedRef = String(args["expected-ref"] ?? "").trim();
    const expectedSourceTree = String(args["expected-source-tree"] ?? "").trim();
    if (!/^[0-9a-f]{40}$/.test(expectedSourceTree)) {
      throw new AgentError("missing or invalid --expected-source-tree", 2);
    }
    const repoDir = resolve(String(args["repo-dir"] ?? ""));
    const fixPatchPath = String(args["fix-patch"] ?? "").trim();
    if (!fixPatchPath) throw new AgentError("missing --fix-patch", 2);
    const actualHead = runCommand("git", ["rev-parse", "HEAD"], {
      cwd: repoDir,
    }).stdout.trim();
    const actualRef = runCommand("git", ["branch", "--show-current"], {
      cwd: repoDir,
    }).stdout.trim();
    const actualTree = runCommand("git", ["rev-parse", "HEAD^{tree}"], {
      cwd: repoDir,
    }).stdout.trim();
    if (actualTree !== expectedSourceTree || actualRef !== expectedRef) {
      throw new AgentError(
        "candidate checkout does not match prepared PR tree",
        1,
      );
    }
    const depsDir = String(process.env.VET_GATE_DEPS ?? "").trim();
    if (!depsDir || !existsSync(resolve(depsDir, "node_modules"))) {
      throw new AgentError(
        "preinstalled candidate dependencies are missing",
        1,
      );
    }
    if (dryRun) {
      finish(
        {
          ok: true,
          message: "would run isolated no-mistakes gate",
          head: expectedHead,
        },
        Boolean(args.json),
      );
      return;
    }
    const intent = readFileSync(resolve(args["intent-file"]), "utf8").trim();
    if (!intent) throw new AgentError("trusted gate intent file is empty", 1);
    const userApproved = Boolean(args["user-approved"]);
    const modelStartedFile = String(args["model-started-file"] ?? "").trim();
    if (!modelStartedFile) {
      throw new AgentError("missing no-mistakes model-started marker path", 2);
    }
    if (existsSync(resolve(modelStartedFile))) {
      throw new AgentError("stale no-mistakes model-started marker", 1);
    }
    const run = runNoMistakesGate(intent, repoDir, {
      expectedHead: actualHead,
      userApproved,
      modelStarted: () => existsSync(resolve(modelStartedFile)),
    });
    const postRunHead = runCommand("git", ["rev-parse", "HEAD"], {
      cwd: repoDir,
    }).stdout.trim();
    const postRunRef = runCommand("git", ["branch", "--show-current"], {
      cwd: repoDir,
    }).stdout.trim();
    const trackedStatus = runCommand(
      "git",
      ["status", "--porcelain=v1", "--untracked-files=all"],
      { cwd: repoDir },
    ).stdout.trim();
    const parsed = parseAxiResult(
      `${run.stdout}\n${run.stderr}`.trim(),
      run.status,
    );
    const nativeFix = createNativeFixPatch(
      parsed,
      actualHead,
      resolve(fixPatchPath),
      { publishedHead: expectedHead },
    );
    const artifact = sanitizedGateArtifact(parsed, expectedHead, {
      nativeFix,
      userApproved,
      validatedSourceHead: actualHead,
      unpublishedChanges:
        postRunHead !== actualHead ||
        postRunRef !== expectedRef ||
        Boolean(trackedStatus),
    });
    writePrivateFile(
      args["result-file"],
      `${JSON.stringify(artifact, null, 2)}\n`,
    );
    const exitCode = artifact.status === "passed" ? 0 : 1;
    finish(
      {
        ok: exitCode === 0,
        message: `isolated no-mistakes ${artifact.status}`,
        outcome: artifact.outcome,
        head: expectedHead,
      },
      Boolean(args.json),
      exitCode,
    );
    return;
  }

  if (args.finalize) {
    if (!Number.isInteger(prNumber)) {
      throw new AgentError("missing --pr-number", 2);
    }
    const expectedHead = readExpectedHead(args["expected-head"]);
    readInfrastructureRetry(args["infrastructure-retry"]);
    readRepairAttempt(args["repair-attempt"]);
    const snapshot = fetchTrustedPull(config, prNumber, { ghApiJson });
    const { pull, trust } = snapshot;
    const context = fetchIntentContext(config, trust.sourceIssue, pull);
    assertTrustedIntentSource(config, snapshot, context, { ghApiJson });
    const remote = existsSync(resolve(args["remote-record"] ?? ""))
      ? validateNoMistakesRemoteRecord(config, args["remote-record"])
      : null;
    const comments = getIssueComments(config, prNumber);
    let repairLedger = loadRepairLedger(
      comments,
      context.intentCapsule.intentDigest,
      config.repo.owner,
    );
    const repairAttempt = repairLedger.revisionCount;
    const inputDigest = semanticInputDigest({
      lane: "no-mistakes",
      head: expectedHead,
      intentDigest: context.intentCapsule.intentDigest,
      findings: openRepairFindings(repairLedger).filter(
        (finding) => finding.lane !== "no-mistakes",
      ),
      checks: [{
        name: "owner-approval",
        state: readApprovalState(args["approval-state"])
          ? "approved"
          : "not-approved",
      }],
    });
    let artifact = setupFailureArtifact(expectedHead);
    if (pull.head.sha !== expectedHead) {
      artifact = {
        ...artifact,
        outcome: "head-mismatch",
      };
    } else if (remote?.ok && existsSync(resolve(args["result-file"]))) {
      try {
        artifact = normalizeGateArtifact(
          JSON.parse(readFileSync(resolve(args["result-file"]), "utf8")),
          expectedHead,
        );
      } catch {
        artifact = setupFailureArtifact(expectedHead);
      }
    }
    const recoveredSetupFailure = setupFailureRecoveryEligible({
      config,
      ledger: repairLedger,
      head: expectedHead,
      inputDigest,
      passProven: artifact.status === "passed",
      sourceIssue: context.sourceIssue,
    });
    const binding = terminalHeadBinding(expectedHead, pull.head.sha);
    const evaluation = recordRepairEvaluation(repairLedger, {
      lane: "no-mistakes",
      head: expectedHead,
      inputDigest,
      findings: artifact.status === "passed" ? [] : artifact.findings,
      outcome: repairLedgerOutcome(artifact),
    });
    repairLedger = evaluation.ledger;
    const repair = gateRepairDecision(artifact, repairAttempt, {
      replayed: evaluation.replayed,
    });
    if (repair.state === "native-fix") {
      const { published, result } = finalizeNativeFixPublication({
        artifact,
        config,
        pull,
        repairAttempt,
        patchPath: args["fix-patch"],
        remote,
        dryRun,
      });
      if (!dryRun) {
        repairLedger = recordRepairRevision(repairLedger, {
          lane: "no-mistakes",
          fromHead: expectedHead,
          toHead: published.nextHead,
          findingDigest: evaluation.findingDigest,
        }).ledger;
      }
      const ledgerComment = saveRepairLedger({
        config,
        prNumber,
        ledger: repairLedger,
        dryRun,
      });
      finish(
        {
          ok: true,
          message: `${dryRun ? "would publish" : "published"} native no-mistakes fixes for PR #${prNumber}`,
          outcome: artifact.outcome,
          repair,
          result,
          ledgerComment,
        },
        Boolean(args.json),
      );
      return;
    }
    setGitHubOutput({
      "repair-action": repair.state,
      "next-head": "",
      "next-repair-attempt": repair.nextAttempt ?? "",
    });
    const result = recordTerminal({
      config,
      pull,
      artifact,
      ...binding,
      repairAttempt,
      repairDecision: repair,
      recoveredSetupFailure,
      remote,
      dryRun,
    });
    if (recoveredSetupFailure) {
      repairLedger = recordRepairEvaluation(repairLedger, {
        lane: "no-mistakes",
        head: expectedHead,
        inputDigest,
        findings: [],
        outcome: "passed-recovered",
      }).ledger;
    }
    const ledgerComment = saveRepairLedger({
      config,
      prNumber,
      ledger: repairLedger,
      dryRun,
    });
    const exitCode = artifact.status === "passed" ? 0 : 1;
    finish(
      {
        ok: exitCode === 0,
        message: `no-mistakes ${artifact.status} for PR #${prNumber}`,
        outcome: artifact.outcome,
        repair,
        result,
        ledgerComment,
      },
      Boolean(args.json),
      exitCode,
    );
    return;
  }

  throw new AgentError(
    "choose one of --prepare, --prepare-gate, --run-gate, or --finalize",
    2,
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => fail(error, Boolean(parseArgs().json)));
}
