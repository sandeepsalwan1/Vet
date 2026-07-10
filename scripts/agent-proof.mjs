#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  AgentError,
  addLabels,
  fail,
  finish,
  ghApiJson,
  issueLabels,
  loadConfig,
  markdownJsonBlock,
  parseArgs,
  removeLabels,
  repoRoot,
  runCommand,
  runShell,
  setCommitStatus,
  upsertManagedComment
} from "./agent-lib.mjs";

const proofBaseUrl = "http://127.0.0.1:3000";

function targetDetails(config, kind, number) {
  if (kind === "pr") {
    const pull = ghApiJson(`repos/${config.repo.owner}/${config.repo.name}/pulls/${number}`);
    const issue = ghApiJson(`repos/${config.repo.owner}/${config.repo.name}/issues/${number}`);
    return {
      title: pull.title,
      body: `${pull.body ?? ""}\n${issue.body ?? ""}`,
      labels: issueLabels(issue),
      sha: pull.head.sha
    };
  }
  const issue = ghApiJson(`repos/${config.repo.owner}/${config.repo.name}/issues/${number}`);
  return { title: issue.title, body: issue.body ?? "", labels: issueLabels(issue), sha: null };
}

function requestedProof(config, details) {
  const text = `${details.title}\n${details.body}`.toLowerCase();
  if (text.includes("gif") || text.includes("video")) return "GIF";
  if (details.labels.includes(config.labels.proof) || text.includes("screenshot") || text.includes("visual proof")) return "UI";
  return "CI";
}

function proofBody(result) {
  return `## Agent Proof

Status: ${result.status}
Kind: ${result.proofKind}
Provider: ${result.provider || "none"}
Lease: ${result.leaseId || "none"}

Commands:

${result.commands.length ? result.commands.map((command) => `- ${command}`).join("\n") : "- none"}

Summary:

${result.summary}

${result.blocker ? `Blocker:\n\n${result.blocker}\n` : ""}

Structured proof:
${markdownJsonBlock(result)}`;
}

async function waitForUrl(url, timeoutMs = 60000) {
  const started = Date.now();
  let lastError = "";
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url, { headers: { "user-agent": "vet-agent-proof" } });
      if (response.ok) return;
      lastError = `${response.status} ${response.statusText}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await delay(1000);
  }
  throw new AgentError(`server did not become ready: ${lastError}`, 1);
}

async function collectUiProof() {
  const outputDir = join(repoRoot(), ".agent-output");
  const artifactPath = join(outputDir, "proof-ui.png");
  const logPath = join(outputDir, "proof-next.log");
  const commands = [];
  mkdirSync(outputDir, { recursive: true });

  for (const args of [
    ["npm", ["run", "build"]],
    ["npx", ["-y", "playwright@latest", "install", "chromium"]]
  ]) {
    const [command, commandArgs] = args;
    commands.push([command, ...commandArgs].join(" "));
    const result = runCommand(command, commandArgs, { check: false });
    if (result.status !== 0) {
      return { ok: false, artifactPath, commands, error: `${commands.at(-1)} failed` };
    }
  }

  const server = spawn("npm", ["--workspace", "@central-vet/internal", "run", "start", "--", "--port", "3000", "--hostname", "127.0.0.1"], {
    cwd: repoRoot(),
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"]
  });
  let serverLog = "";
  server.stdout.on("data", (chunk) => {
    serverLog += chunk.toString();
  });
  server.stderr.on("data", (chunk) => {
    serverLog += chunk.toString();
  });
  commands.push("npm --workspace @central-vet/internal run start -- --port 3000 --hostname 127.0.0.1");

  try {
    await waitForUrl(`${proofBaseUrl}/request`);
    const screenshotArgs = [
      "-y",
      "playwright@latest",
      "screenshot",
      "--browser",
      "chromium",
      "--timeout",
      "30000",
      `${proofBaseUrl}/request`,
      artifactPath
    ];
    commands.push(["npx", ...screenshotArgs].join(" "));
    const screenshot = runCommand("npx", screenshotArgs, { check: false });
    if (screenshot.status !== 0 || !existsSync(artifactPath)) {
      return { ok: false, artifactPath, commands, error: "Playwright screenshot failed" };
    }
    return { ok: true, artifactPath, commands, error: "" };
  } catch (error) {
    return { ok: false, artifactPath, commands, error: error instanceof Error ? error.message : String(error) };
  } finally {
    server.kill("SIGTERM");
    writeFileSync(logPath, serverLog);
  }
}

async function main() {
  const args = parseArgs();
  const config = loadConfig();
  const kind = args["target-kind"] ?? args.kind;
  const number = Number(args["target-number"] ?? args.number);
  if (!["issue", "pr"].includes(kind)) throw new AgentError("missing --target-kind issue|pr", 2);
  if (!Number.isInteger(number)) throw new AgentError("missing --target-number", 2);
  const dryRun = Boolean(args["dry-run"]);
  const run = Boolean(args.run);
  const details = targetDetails(config, kind, number);
  const proofKind = args["proof-kind"] ?? requestedProof(config, details);
  let artifactPath = args["artifact-path"] ?? "";
  let artifactProvider = args.provider ?? "";
  let leaseId = args["lease-id"] ?? "";
  let blocker = "";
  const commands = proofKind === "CI" ? config.commands.proof : [];
  const result = {
    proofKind,
    status: "skipped",
    commands: [],
    artifactPaths: artifactPath ? [artifactPath] : [],
    provider: artifactProvider,
    leaseId,
    summary: "Proof requested but not run.",
    blocker: ""
  };

  if (run && !dryRun && proofKind === "UI" && (!artifactPath || !artifactProvider || !leaseId)) {
    const collected = await collectUiProof();
    result.commands.push(...collected.commands);
    if (collected.ok) {
      artifactPath = collected.artifactPath;
      artifactProvider = "github-actions";
      leaseId = process.env.GITHUB_RUN_ID || "local";
      result.artifactPaths = [artifactPath];
      result.provider = artifactProvider;
      result.leaseId = leaseId;
      result.status = "passed";
      result.summary = "UI screenshot proof artifact was recorded.";
    } else {
      result.status = "failed";
      result.summary = collected.error || "UI proof capture failed.";
    }
  }

  if ((proofKind === "UI" || proofKind === "GIF") && result.status !== "passed" && (!artifactPath || !artifactProvider || !leaseId)) {
    blocker =
      proofKind === "GIF"
        ? "GIF proof requires a collected Crabbox desktop artifact, provider, and lease id"
        : "UI proof requires a screenshot artifact, provider, and lease id";
    result.status = "blocked";
    result.summary = "Visual proof did not produce a complete artifact record.";
    result.blocker = blocker;
  }

  if (!blocker && (proofKind === "UI" || proofKind === "GIF")) {
    result.status = "passed";
    result.summary = proofKind === "GIF" ? "GIF/video proof artifact was recorded." : "UI screenshot proof artifact was recorded.";
    result.artifactPaths = artifactPath ? [artifactPath] : [];
    result.provider = artifactProvider;
    result.leaseId = leaseId;
  }

  if (run && !dryRun && proofKind === "CI" && !blocker) {
    for (const command of commands) {
      const output = runShell(command, { check: false });
      result.commands.push(command);
      if (output.status !== 0) {
        result.status = "failed";
        result.summary = `${command} failed`;
        break;
      }
    }
    if (result.status !== "failed") {
      result.status = "passed";
      result.summary = commands.length ? "Configured proof commands passed." : "No command proof required.";
    }
  }

  const comment = upsertManagedComment({
    config,
    number,
    marker: config.comments.proof,
    body: proofBody(result),
    dryRun
  });
  const labels =
    result.status === "blocked" || result.status === "failed"
      ? { added: addLabels(config, number, [config.labels.blocked], dryRun), removed: removeLabels(config, number, [config.labels.automerge], dryRun) }
      : { added: [], removed: removeLabels(config, number, [config.labels.blocked], dryRun) };
  const status =
    kind === "pr" && details.sha
      ? setCommitStatus({
          config,
          sha: details.sha,
          state: result.status === "passed" || result.status === "skipped" ? "success" : "failure",
          context: "agent-proof",
          description: result.summary,
          dryRun
        })
      : null;
  const ok = result.status === "passed" || result.status === "skipped";
  finish({ ok, message: `proof ${result.status} for ${kind} #${number}`, result, comment, labels, status }, Boolean(args.json), ok ? 0 : 1);
}

main().catch((error) => fail(error, Boolean(parseArgs().json)));
