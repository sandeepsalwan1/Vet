#!/usr/bin/env node
import {
  AgentError,
  addLabels,
  assertNotMain,
  commandExists,
  extractJson,
  fail,
  finish,
  ghApiJson,
  loadConfig,
  markdownJsonBlock,
  parseArgs,
  runCommand,
  setCommitStatus,
  upsertManagedComment
} from "./agent-lib.mjs";

function summarize(output, exitStatus) {
  const lower = output.toLowerCase();
  if (exitStatus !== 0) {
    if (lower.includes("ask-user") || lower.includes("gate")) return "blocked";
    return "failed";
  }
  if (lower.includes("ask-user")) return "blocked";
  if (lower.includes("failed") || lower.includes("cancelled")) return "failed";
  if (lower.includes("checks-passed") || lower.includes("passed")) return "passed";
  if (lower.includes("gate")) return "blocked";
  return "blocked";
}

function implementationMetadata(body) {
  const marker = "<!-- agent-implementation:v1 -->";
  const index = String(body ?? "").indexOf(marker);
  if (index === -1) return {};
  const afterMarker = String(body).slice(index + marker.length);
  const fence = afterMarker.match(/```json\s*([\s\S]*?)```/i);
  if (!fence) return {};
  try {
    return extractJson(fence[1]);
  } catch {
    return {};
  }
}

function checkoutPullHead(pull) {
  if (pull.head.repo.full_name !== pull.base.repo.full_name) {
    throw new AgentError("refusing no-mistakes gate for cross-repository PR", 1, {
      head: pull.head.repo.full_name,
      base: pull.base.repo.full_name
    });
  }
  runCommand("gh", ["auth", "setup-git", "--hostname", "github.com"]);
  runCommand("git", ["fetch", "origin", pull.head.ref]);
  runCommand("git", ["switch", "-C", pull.head.ref, "FETCH_HEAD"]);
}

function noMistakesEnvironment() {
  const env = { ...process.env };
  for (const name of ["AGENT_PAT", "OPENAI_API_KEY", "CODEX_API_KEY"]) {
    delete env[name];
  }
  return env;
}

async function main() {
  const args = parseArgs();
  const config = loadConfig();
  const dryRun = Boolean(args["dry-run"]);
  const prNumber = Number(args["pr-number"]);
  if (!Number.isInteger(prNumber)) throw new AgentError("missing --pr-number", 2);
  const intent = args.intent;
  if (!intent) throw new AgentError("missing --intent", 2);
  const pull = ghApiJson(`repos/${config.repo.owner}/${config.repo.name}/pulls/${prNumber}`);
  if (!dryRun) checkoutPullHead(pull);
  const branch = dryRun ? pull.head.ref : assertNotMain(config);
  if (!commandExists("no-mistakes") && !dryRun) throw new AgentError("no-mistakes CLI not found", 2);

  if (dryRun) {
    finish({ ok: true, message: "would run no-mistakes gate", prNumber, branch, intent }, Boolean(args.json));
    return;
  }
  const run = runCommand("no-mistakes", ["axi", "run", "--intent", intent], {
    check: false,
    env: noMistakesEnvironment()
  });
  const output = `${run.stdout}\n${run.stderr}`.trim();
  const status = summarize(output, run.status);
  const state = status === "passed" ? "success" : "failure";
  const body = `## no-mistakes Gate

Status: ${status}
Branch: ${branch}

Structured gate:
${markdownJsonBlock({
  status,
  checksRun: ["no-mistakes axi run"],
  findings: output ? output.split("\n").slice(0, 20) : [],
  blocker: status === "passed" ? "" : "no-mistakes did not return a passing status"
})}`;
  const comment = upsertManagedComment({
    config,
    number: prNumber,
    marker: config.comments.gate,
    body,
    dryRun: false
  });
  const commitStatus = setCommitStatus({
    config,
    sha: pull.head.sha,
    state,
    context: "no-mistakes",
    description: status === "passed" ? "no-mistakes passed" : "no-mistakes blocked",
    dryRun: false
  });
  const metadata = implementationMetadata(pull.body);
  let automerge = null;
  if (status === "passed" && metadata.automergeEligible) {
    runCommand("gh", ["pr", "ready", String(prNumber), "--repo", `${config.repo.owner}/${config.repo.name}`], {
      check: false
    });
    addLabels(config, prNumber, [config.labels.automerge], false);
    const merge = runCommand("node", ["scripts/agent-automerge.mjs", "--pr-number", String(prNumber), "--json"], {
      check: false
    });
    automerge = {
      status: merge.status,
      stdout: merge.stdout,
      stderr: merge.stderr
    };
  }
  const exitCode = status === "passed" && (!automerge || automerge.status === 0) ? 0 : 1;
  finish(
    { ok: exitCode === 0, message: `no-mistakes ${status} for PR #${prNumber}`, comment, status: commitStatus, metadata, automerge },
    Boolean(args.json),
    exitCode
  );
}

main().catch((error) => fail(error, Boolean(parseArgs().json)));
