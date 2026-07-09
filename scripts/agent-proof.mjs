#!/usr/bin/env node
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
  runShell,
  setCommitStatus,
  upsertManagedComment
} from "./agent-lib.mjs";

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
  const artifactPath = args["artifact-path"] ?? "";
  const artifactProvider = args.provider ?? "";
  const leaseId = args["lease-id"] ?? "";
  const missingVisualArtifact =
    (proofKind === "UI" || proofKind === "GIF") && (!artifactPath || !artifactProvider || !leaseId)
      ? `${proofKind} proof requires a collected Crabbox artifact, provider, and lease id`
      : "";
  const blocker = missingVisualArtifact;
  const commands = proofKind === "CI" ? config.commands.proof : [];
  const result = {
    proofKind,
    status: blocker ? "blocked" : "skipped",
    commands: [],
    artifactPaths: artifactPath ? [artifactPath] : [],
    provider: artifactProvider,
    leaseId,
    summary: blocker ? "Remote visual proof did not produce a complete artifact record." : "Proof requested but not run.",
    blocker
  };

  if (!blocker && (proofKind === "UI" || proofKind === "GIF")) {
    result.status = "passed";
    result.summary = "Visual proof artifact was recorded.";
  }

  if (run && !blocker) {
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
