#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AgentError,
  addLabels,
  assertTrustedAgentPull as assertSharedTrustedAgentPull,
  fail,
  finish,
  ghApiJson,
  loadConfig,
  markdownJsonBlock,
  newestManagedComment,
  parseImplementationMetadata,
  parseArgs,
  removeLabels,
  runCommand,
  setCommitStatus,
  setGitHubOutput,
  upsertManagedComment,
} from "./agent-lib.mjs";

const ARTIFACT_VERSION = 2;
const NO_MISTAKES_COMMENT_MARKER = "<!-- agent-gate-no-mistakes:v1 -->";
const STATUS_CONTEXT = "no-mistakes";
const PASSING_OUTCOMES = new Set(["checks-passed", "passed"]);
const ALLOWED_OUTCOMES = new Set([
  ...PASSING_OUTCOMES,
  "failed",
  "cancelled",
  "ask-user",
  "decision-gate",
  "invalid-output",
  "head-mismatch",
  "unpublished-changes",
  "setup-failed",
]);

export function noMistakesCommentMarker(config) {
  return `${config.comments.gate}\n${NO_MISTAKES_COMMENT_MARKER}`;
}

export function implementationMetadata(body) {
  return parseImplementationMetadata(body);
}

export function assertTrustedAgentPull(pull, config, files) {
  return assertSharedTrustedAgentPull(pull, config, {
    files,
    rejectPrivilegedPaths: true,
  });
}

export function selectTrustedManagedTriageComment(comments, marker, repoOwner) {
  return newestManagedComment(comments, marker, repoOwner);
}

export function composeEffectiveIntent({
  callerIntent,
  sourceIssue,
  triageComment,
}) {
  const policy = String(callerIntent ?? "").trim();
  const issueNumber = Number(sourceIssue?.number);
  const issueTitle = String(sourceIssue?.title ?? "").trim();
  const issueBody =
    String(sourceIssue?.body ?? "").trim() || "No issue body provided.";
  const triage = String(triageComment?.body ?? "").trim();
  if (!policy) throw new AgentError("missing caller gate intent", 2);
  if (!Number.isInteger(issueNumber) || issueNumber < 1 || !issueTitle) {
    throw new AgentError("source issue is missing required intent context", 1);
  }
  if (!triage) {
    throw new AgentError(
      `source issue #${issueNumber} has no trusted managed triage context`,
      1,
    );
  }
  const effective = `Gate policy:
${policy}

Authoritative source issue #${issueNumber}
Title: ${issueTitle}
Body:
${issueBody}

Managed triage context:
${triage}`;
  if (Buffer.byteLength(effective, "utf8") > 120_000) {
    throw new AgentError(
      "effective no-mistakes intent exceeds the safe argument limit",
      1,
    );
  }
  return effective;
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
    /^\s{2}findings\[\d+\]\{[^}]+\}:\s*$/.test(line),
  );
  if (headerIndex === -1) return [];
  const columnsMatch = lines[headerIndex].match(/\{([^}]+)\}/);
  const columns =
    columnsMatch?.[1].split(",").map((column) => column.trim()) ?? [];
  const findings = [];
  for (const line of lines.slice(headerIndex + 1)) {
    if (!/^\s{4}\S/.test(line)) break;
    const values = parseCsvRow(line.slice(4));
    const row = Object.fromEntries(
      columns.map((column, index) => [column, values[index] ?? ""]),
    );
    findings.push({
      id: row.id,
      severity: row.severity,
      file: row.file,
      action: row.action,
      description: row.description,
    });
  }
  return findings;
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
  const gateIndex = lines.findIndex((line) => line === "gate:");
  if (gateIndex === -1) return "";
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

  if (outcomes.length === 1) {
    const outcome = outcomes[0];
    if (exitStatus === 0 && PASSING_OUTCOMES.has(outcome)) {
      return { status: "passed", outcome, run, findings };
    }
    return { status: "failed", outcome, run, findings };
  }
  if (/^gate:\s*$/m.test(text)) {
    return {
      status: "blocked",
      outcome: findings.some((finding) => finding.action === "ask-user")
        ? "ask-user"
        : "decision-gate",
      run,
      findings,
      step,
    };
  }
  return { status: "failed", outcome: "invalid-output", run, findings };
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

export function validatedHeadMatches(result, sha) {
  const expected = String(sha ?? "");
  const validated = String(result?.run?.head ?? "");
  return (
    /^[0-9a-f]{40}$/.test(expected) &&
    /^[0-9a-f]{8,40}$/.test(validated) &&
    expected.startsWith(validated)
  );
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
  return {
    id: safePublicText(finding?.id, 80),
    severity: safePublicText(finding?.severity, 32),
    file: safePublicText(finding?.file, 240),
    action: safePublicText(finding?.action, 32),
    description: safePublicText(finding?.description, 1000),
  };
}

export function sanitizedGateArtifact(
  gate,
  expectedHead,
  { unpublishedChanges = false } = {},
) {
  let normalized = gate;
  const headMatches = validatedHeadMatches(gate, expectedHead);
  if (unpublishedChanges || (gate?.run?.head && !headMatches)) {
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
    findings: (normalized?.findings ?? []).slice(0, 100).map(safeFinding),
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
  return {
    version: ARTIFACT_VERSION,
    status: value.status,
    outcome: value.outcome,
    expectedHead,
    validatedHead: value.validatedHead === expectedHead ? expectedHead : "",
    runId: safePublicText(value.runId, 80),
    findings: value.findings.map(safeFinding),
  };
}

function actionsRunUrl(env = process.env) {
  const { GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID } = env;
  if (!GITHUB_SERVER_URL || !GITHUB_REPOSITORY || !GITHUB_RUN_ID) return "";
  return `${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}`;
}

function fetchPullSnapshot(config, prNumber) {
  const root = `repos/${config.repo.owner}/${config.repo.name}`;
  const pull = ghApiJson(`${root}/pulls/${prNumber}`);
  const files =
    ghApiJson(`${root}/pulls/${prNumber}/files?per_page=100`, {
      paginate: true,
    }) ?? [];
  if (!Array.isArray(files) || Number(pull?.changed_files) !== files.length) {
    throw new AgentError("could not verify the complete PR file inventory", 1);
  }
  return { pull, files };
}

function fetchTrustedPull(config, prNumber) {
  const snapshot = fetchPullSnapshot(config, prNumber);
  const trust = assertTrustedAgentPull(snapshot.pull, config, snapshot.files);
  return { ...snapshot, trust };
}

function assertTrustedIntentSource(config, snapshot, context) {
  return assertSharedTrustedAgentPull(snapshot.pull, config, {
    files: snapshot.files,
    sourceIssue: context.sourceIssue,
    rejectPrivilegedPaths: true,
  });
}

function fetchIntentContext(config, sourceIssueNumber) {
  const root = `repos/${config.repo.owner}/${config.repo.name}`;
  const sourceIssue = ghApiJson(`${root}/issues/${sourceIssueNumber}`);
  if (sourceIssue?.pull_request) {
    throw new AgentError(
      `#${sourceIssueNumber} is a pull request, not a source issue`,
      1,
    );
  }
  const comments =
    ghApiJson(`${root}/issues/${sourceIssueNumber}/comments`, {
      paginate: true,
    }) ?? [];
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
  return { sourceIssue, triageComment };
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

function artifactBlocker(artifact) {
  if (artifact.status === "passed") return "";
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
  return "no-mistakes did not return a passing terminal outcome";
}

export function gateCommentBody({ artifact, branch, sha, runUrl }) {
  return `## no-mistakes Gate

Status: ${artifact.status}
Branch: ${branch}
Head: ${sha}
${runUrl ? `Actions run: ${runUrl}\n` : ""}
Finding descriptions are sanitized. Source intent and process output are omitted.

Structured gate:
${markdownJsonBlock({
  status: artifact.status,
  outcome: artifact.outcome,
  runId: artifact.runId || "",
  checksRun: ["no-mistakes axi run --skip push,pr,ci"],
  findings: artifact.findings,
  blocker: artifactBlocker(artifact),
})}`;
}

export function gateLabelChanges(config, artifact) {
  if (artifact?.outcome !== "ask-user") {
    return { add: [], remove: [] };
  }
  return {
    add: [config.labels.blocked],
    remove: [config.labels.automerge],
  };
}

function recordTerminal({ config, pull, artifact, dryRun = false }) {
  const failed = artifact.status !== "passed";
  const runUrl = actionsRunUrl();
  const commitStatus = setCommitStatus({
    config,
    sha: pull.head.sha,
    state: failed ? "failure" : "success",
    context: STATUS_CONTEXT,
    description: failed
      ? `no-mistakes ${artifact.status}`
      : "no-mistakes passed",
    targetUrl: runUrl,
    dryRun,
  });
  const labelChanges = gateLabelChanges(config, artifact);
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
    }),
    dryRun,
  });
  return { labels, comment, status: commitStatus };
}

export function gateEnvironment(source = process.env) {
  const env = { ...source };
  for (const name of [
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
        "retrying no-mistakes once after an isolated review environment blocker\n",
      ));

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    execute("no-mistakes", ["init"], { cwd: repoDir, env });
    const result = spawn(
      "no-mistakes",
      ["axi", "run", "--intent", intent, "--skip", "push,pr,ci"],
      {
        cwd: repoDir,
        env,
        encoding: "utf8",
        stdio: "pipe",
      },
    );
    if (result.error) {
      throw new AgentError("no-mistakes gate could not start", 1);
    }
    const run = {
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      status: result.status ?? 1,
      attempts: attempt,
    };
    const parsed = parseAxiResult(
      `${run.stdout}\n${run.stderr}`.trim(),
      run.status,
    );
    if (attempt === 1 && isRetryableReviewEnvironmentBlock(parsed)) {
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

function writePrivateFile(path, content) {
  const target = resolve(path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content, { mode: 0o600 });
  return target;
}

function readExpectedHead(value) {
  const sha = String(value ?? "").trim();
  if (!/^[0-9a-f]{40}$/.test(sha)) {
    throw new AgentError("missing or invalid --expected-head", 2);
  }
  return sha;
}

function setupFailureArtifact(expectedHead) {
  return {
    version: ARTIFACT_VERSION,
    status: "failed",
    outcome: "setup-failed",
    expectedHead,
    validatedHead: "",
    runId: "",
    findings: [],
  };
}

async function main() {
  const args = parseArgs();
  const config = loadConfig();
  const dryRun = Boolean(args["dry-run"]);
  const prNumber = Number(args["pr-number"]);

  if (args.prepare) {
    if (!Number.isInteger(prNumber)) {
      throw new AgentError("missing --pr-number", 2);
    }
    const snapshot = fetchTrustedPull(config, prNumber);
    const { pull, trust } = snapshot;
    const context = fetchIntentContext(config, trust.sourceIssue);
    assertTrustedIntentSource(config, snapshot, context);
    const status = markPending(config, pull, dryRun);
    setGitHubOutput({ head_sha: pull.head.sha, head_ref: pull.head.ref });
    finish(
      { ok: true, message: `no-mistakes pending for PR #${prNumber}`, status },
      Boolean(args.json),
    );
    return;
  }

  if (args["prepare-gate"]) {
    if (!Number.isInteger(prNumber)) {
      throw new AgentError("missing --pr-number", 2);
    }
    const expectedHead = readExpectedHead(args["expected-head"]);
    const snapshot = fetchTrustedPull(config, prNumber);
    const { pull, trust } = snapshot;
    if (pull.head.sha !== expectedHead) {
      throw new AgentError("PR head changed after the pending status", 1);
    }
    const context = fetchIntentContext(config, trust.sourceIssue);
    assertTrustedIntentSource(config, snapshot, context);
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
    const repoDir = resolve(String(args["repo-dir"] ?? ""));
    const actualHead = runCommand("git", ["rev-parse", "HEAD"], {
      cwd: repoDir,
    }).stdout.trim();
    const actualRef = runCommand("git", ["branch", "--show-current"], {
      cwd: repoDir,
    }).stdout.trim();
    if (actualHead !== expectedHead || actualRef !== expectedRef) {
      throw new AgentError(
        "candidate checkout does not match prepared PR head",
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
    const run = runNoMistakesGate(intent, repoDir);
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
    const artifact = sanitizedGateArtifact(parsed, expectedHead, {
      unpublishedChanges:
        postRunHead !== expectedHead ||
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
    const snapshot = fetchTrustedPull(config, prNumber);
    const { pull, trust } = snapshot;
    const context = fetchIntentContext(config, trust.sourceIssue);
    assertTrustedIntentSource(config, snapshot, context);
    let artifact = setupFailureArtifact(expectedHead);
    if (pull.head.sha !== expectedHead) {
      artifact = {
        ...artifact,
        outcome: "head-mismatch",
      };
    } else if (existsSync(resolve(args["result-file"]))) {
      try {
        artifact = normalizeGateArtifact(
          JSON.parse(readFileSync(resolve(args["result-file"]), "utf8")),
          expectedHead,
        );
      } catch {
        artifact = setupFailureArtifact(expectedHead);
      }
    }
    const result = recordTerminal({ config, pull, artifact, dryRun });
    const exitCode = artifact.status === "passed" ? 0 : 1;
    finish(
      {
        ok: exitCode === 0,
        message: `no-mistakes ${artifact.status} for PR #${prNumber}`,
        outcome: artifact.outcome,
        result,
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
