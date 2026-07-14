#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AgentError,
  addLabels,
  assertNotMain,
  commandExists,
  commentHasManagedMarker,
  extractJson,
  fail,
  finish,
  ghApiJson,
  loadConfig,
  markdownJsonBlock,
  parseArgs,
  removeLabels,
  runCommand,
  setCommitStatus,
  upsertManagedComment,
} from "./agent-lib.mjs";

const IMPLEMENTATION_MARKER = "<!-- agent-implementation:v1 -->";
const NO_MISTAKES_COMMENT_MARKER = "<!-- agent-gate-no-mistakes:v1 -->";
const STATUS_CONTEXT = "no-mistakes";

export function noMistakesCommentMarker(config) {
  return `${config.comments.gate}\n${NO_MISTAKES_COMMENT_MARKER}`;
}

export function implementationMetadata(body) {
  const index = String(body ?? "").indexOf(IMPLEMENTATION_MARKER);
  if (index === -1) return {};
  const afterMarker = String(body).slice(index + IMPLEMENTATION_MARKER.length);
  const fence = afterMarker.match(/```json\s*([\s\S]*?)```/i);
  if (!fence) return {};
  try {
    return extractJson(fence[1]);
  } catch {
    return {};
  }
}

export function assertTrustedAgentPull(pull, config) {
  const expectedRepo = `${config.repo.owner}/${config.repo.name}`;
  if (
    pull?.head?.repo?.full_name !== expectedRepo ||
    pull?.base?.repo?.full_name !== expectedRepo
  ) {
    throw new AgentError(
      "refusing no-mistakes gate for cross-repository PR",
      1,
      {
        head: pull?.head?.repo?.full_name,
        base: pull?.base?.repo?.full_name,
      },
    );
  }
  if (pull.base.ref !== config.repo.defaultBranch) {
    throw new AgentError(
      `refusing no-mistakes gate for base branch ${pull.base.ref}`,
      1,
    );
  }

  const metadata = implementationMetadata(pull.body);
  const sourceIssue = Number(metadata.sourceIssue);
  const expectedPrefix =
    Number.isInteger(sourceIssue) && sourceIssue > 0
      ? `agent/issue-${sourceIssue}-`
      : "";
  if (
    !expectedPrefix ||
    !String(pull.head.ref ?? "").startsWith(expectedPrefix)
  ) {
    throw new AgentError(
      "refusing no-mistakes gate for an untrusted same-repository PR",
      1,
      {
        branch: pull?.head?.ref,
        requiredMarker: IMPLEMENTATION_MARKER,
      },
    );
  }
  return { metadata, sourceIssue };
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
  if (!triage)
    throw new AgentError(
      `source issue #${issueNumber} has no managed triage context`,
      1,
    );
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
    if (match) fields[match[1]] = match[2];
  }
  return fields;
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

  if (outcomes.length === 1) {
    const outcome = outcomes[0];
    if (
      exitStatus === 0 &&
      (outcome === "checks-passed" || outcome === "passed")
    ) {
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
    };
  }
  return { status: "failed", outcome: "invalid-output", run, findings };
}

export function validatedHeadMatches(result, sha) {
  return Boolean(
    result?.run?.head && String(sha ?? "").startsWith(result.run.head),
  );
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

export function gateGhShimScript(realGhPath) {
  const delegate = String(realGhPath ?? "").trim();
  if (!delegate.startsWith("/"))
    throw new AgentError("real gh path must be absolute", 2);
  return `#!/bin/sh
if [ "$1" = "pr" ] && [ "$2" = "edit" ]; then
  exit 0
fi
if [ "$1" = "pr" ] && [ "$2" = "create" ]; then
  echo "PR creation disabled by the no-mistakes gate" >&2
  exit 1
fi
exec ${shellQuote(delegate)} "$@"
`;
}

function writeGateGhShim(outputPath) {
  const located = spawnSync("sh", ["-c", "command -v gh"], {
    encoding: "utf8",
    stdio: "pipe",
  });
  const realGhPath = String(located.stdout ?? "").trim();
  if (located.status !== 0 || !realGhPath)
    throw new AgentError("gh CLI not found", 2);
  const target = resolve(outputPath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, gateGhShimScript(realGhPath), { mode: 0o700 });
  return target;
}

function actionsRunUrl(env = process.env) {
  const { GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID } = env;
  if (!GITHUB_SERVER_URL || !GITHUB_REPOSITORY || !GITHUB_RUN_ID) return "";
  return `${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}`;
}

function checkoutPullHead(pull) {
  runCommand("gh", ["auth", "setup-git", "--hostname", "github.com"]);
  runCommand("git", ["fetch", "origin", pull.head.ref]);
  runCommand("git", ["switch", "-C", pull.head.ref, "FETCH_HEAD"]);
}

function noMistakesEnvironment() {
  const env = { ...process.env };
  delete env.AGENT_PAT;
  delete env.GATE_INTENT;
  delete env.GITHUB_TOKEN;
  delete env.OPENAI_API_KEY;
  // CODEX_API_KEY and GH_TOKEN must reach the already-started gate daemon and
  // provider tools. Trusted commands get a clean environment from main's
  // .no-mistakes.yaml, but this is not hostile-code isolation on a shared UID.
  return env;
}

function runNoMistakesGate(intent) {
  const result = spawnSync("no-mistakes", ["axi", "run", "--intent", intent], {
    cwd: process.cwd(),
    env: noMistakesEnvironment(),
    encoding: "utf8",
    stdio: "pipe",
  });
  if (result.error) throw new AgentError("no-mistakes gate could not start", 1);
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    status: result.status ?? 1,
  };
}

function safeFinding(finding) {
  return {
    id: String(finding.id ?? "").slice(0, 80),
    severity: String(finding.severity ?? "").slice(0, 32),
    file: String(finding.file ?? "").slice(0, 240),
    action: String(finding.action ?? "").slice(0, 32),
  };
}

export function gateCommentBody({
  status,
  branch,
  sha,
  runId,
  findings,
  runUrl,
  blocker,
}) {
  const safeFindings = (findings ?? []).map(safeFinding);
  return `## no-mistakes Gate

Status: ${status}
Branch: ${branch}
Head: ${sha}
${runUrl ? `Actions run: ${runUrl}\n` : ""}
Finding descriptions and process output are intentionally omitted from this public comment.

Structured gate:
${markdownJsonBlock({
  status,
  runId: runId || "",
  checksRun: ["no-mistakes axi run"],
  findings: safeFindings,
  blocker: blocker || "",
})}`;
}

function writeFinalizedMarker() {
  const path = process.env.NO_MISTAKES_FINALIZED_FILE;
  if (path) writeFileSync(path, "finalized\n", { mode: 0o600 });
}

function fetchTrustedPull(config, prNumber) {
  const pull = ghApiJson(
    `repos/${config.repo.owner}/${config.repo.name}/pulls/${prNumber}`,
  );
  const trust = assertTrustedAgentPull(pull, config);
  return { pull, trust };
}

function fetchIntentContext(config, sourceIssueNumber) {
  const sourceIssue = ghApiJson(
    `repos/${config.repo.owner}/${config.repo.name}/issues/${sourceIssueNumber}`,
  );
  if (sourceIssue?.pull_request) {
    throw new AgentError(
      `#${sourceIssueNumber} is a pull request, not a source issue`,
      1,
    );
  }
  const comments =
    ghApiJson(
      `repos/${config.repo.owner}/${config.repo.name}/issues/${sourceIssueNumber}/comments`,
      { paginate: true },
    ) ?? [];
  const triageComment = comments.find((comment) =>
    commentHasManagedMarker(comment?.body, config.comments.triage),
  );
  if (!triageComment) {
    throw new AgentError(
      `source issue #${sourceIssueNumber} has no managed triage context`,
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

function recordTerminal({
  config,
  pull,
  status,
  runId = "",
  findings = [],
  blocker = "",
  dryRun = false,
}) {
  const failed = status !== "passed";
  const runUrl = actionsRunUrl();
  const commitStatus = setCommitStatus({
    config,
    sha: pull.head.sha,
    state: failed ? "failure" : "success",
    context: STATUS_CONTEXT,
    description: failed ? `no-mistakes ${status}` : "no-mistakes passed",
    targetUrl: runUrl,
    dryRun,
  });
  const labels = failed
    ? {
        added: addLabels(config, pull.number, [config.labels.blocked], dryRun),
        removed: removeLabels(
          config,
          pull.number,
          [config.labels.automerge],
          dryRun,
        ),
      }
    : { added: [], removed: [] };
  const comment = upsertManagedComment({
    config,
    number: pull.number,
    marker: noMistakesCommentMarker(config),
    body: gateCommentBody({
      status,
      branch: pull.head.ref,
      sha: pull.head.sha,
      runId,
      findings,
      runUrl,
      blocker,
    }),
    dryRun,
  });
  if (!dryRun) writeFinalizedMarker();
  return { labels, comment, status: commitStatus };
}

async function main() {
  const args = parseArgs();
  if (args["write-gh-shim"]) {
    if (typeof args["write-gh-shim"] !== "string") {
      throw new AgentError("missing --write-gh-shim path", 2);
    }
    const path = writeGateGhShim(args["write-gh-shim"]);
    finish(
      { ok: true, message: `wrote no-mistakes gh shim to ${path}` },
      Boolean(args.json),
    );
    return;
  }
  const config = loadConfig();
  const dryRun = Boolean(args["dry-run"]);
  const prNumber = Number(args["pr-number"]);
  if (!Number.isInteger(prNumber))
    throw new AgentError("missing --pr-number", 2);
  const { pull, trust } = fetchTrustedPull(config, prNumber);

  if (args.prepare) {
    fetchIntentContext(config, trust.sourceIssue);
    const status = markPending(config, pull, dryRun);
    finish(
      { ok: true, message: `no-mistakes pending for PR #${prNumber}`, status },
      Boolean(args.json),
    );
    return;
  }

  if (args["setup-failed"]) {
    const result = recordTerminal({
      config,
      pull,
      status: "failed",
      blocker:
        "no-mistakes workflow failed before recording a terminal gate result",
      dryRun,
    });
    finish(
      {
        ok: false,
        message: `no-mistakes setup failed for PR #${prNumber}`,
        result,
      },
      Boolean(args.json),
      1,
    );
    return;
  }

  const intent = args.intent;
  if (!intent) throw new AgentError("missing --intent", 2);
  const intentContext = fetchIntentContext(config, trust.sourceIssue);
  const effectiveIntent = composeEffectiveIntent({
    callerIntent: intent,
    ...intentContext,
  });
  if (dryRun) {
    finish(
      {
        ok: true,
        message: "would run no-mistakes gate",
        prNumber,
        branch: pull.head.ref,
        sourceIssue: trust.sourceIssue,
      },
      Boolean(args.json),
    );
    return;
  }
  markPending(config, pull, false);
  checkoutPullHead(pull);
  const branch = assertNotMain(config);
  if (!commandExists("no-mistakes"))
    throw new AgentError("no-mistakes CLI not found", 2);

  const run = runNoMistakesGate(effectiveIntent);
  const output = `${run.stdout}\n${run.stderr}`.trim();
  let gate = parseAxiResult(output, run.status);
  const refreshed = fetchTrustedPull(config, prNumber).pull;
  if (
    gate.status === "passed" &&
    !validatedHeadMatches(gate, refreshed.head.sha)
  ) {
    gate = { ...gate, status: "failed", outcome: "head-mismatch" };
  }
  const blocker =
    gate.status === "passed"
      ? ""
      : gate.outcome === "ask-user"
        ? "no-mistakes requires a product or user decision"
        : gate.outcome === "head-mismatch"
          ? "validated commit does not match the current PR head"
          : "no-mistakes did not return a passing terminal outcome";
  const terminal = recordTerminal({
    config,
    pull: refreshed,
    status: gate.status,
    runId: gate.run.id,
    findings: gate.findings,
    blocker,
    dryRun: false,
  });
  const exitCode = gate.status === "passed" ? 0 : 1;
  finish(
    {
      ok: exitCode === 0,
      message: `no-mistakes ${gate.status} for PR #${prNumber}`,
      outcome: gate.outcome,
      branch,
      runId: gate.run.id ?? "",
      result: terminal,
    },
    Boolean(args.json),
    exitCode,
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => fail(error, Boolean(parseArgs().json)));
}
