#!/usr/bin/env node
import {
  AgentError,
  fail,
  finish,
  ghApiJson,
  issueLabels,
  loadConfig,
  parseArgs,
  removeLabels,
  runCommand,
  upsertManagedComment
} from "./agent-lib.mjs";

function statusState(statuses, context) {
  const status = statuses.find((item) => item.context === context);
  return status?.state ?? "missing";
}

function checkState(checks, name) {
  const run = checks.find((item) => item.name === name);
  if (!run) return "missing";
  return run.conclusion ?? run.status ?? "unknown";
}

function evaluate(config, pull, issue, combined, checks) {
  const labels = issueLabels(issue);
  const blockers = [];
  for (const label of config.automerge.requiredLabels) {
    if (!labels.includes(label)) blockers.push(`missing label ${label}`);
  }
  for (const label of config.automerge.blockedLabels) {
    if (labels.includes(label)) blockers.push(`blocked by label ${label}`);
  }
  for (const context of config.automerge.requiredStatuses) {
    const state = statusState(combined.statuses, context);
    if (state !== "success") blockers.push(`${context} status ${state}`);
  }
  if (labels.includes(config.labels.proof)) {
    const state = statusState(combined.statuses, config.automerge.proofStatus);
    if (state !== "success") blockers.push(`${config.automerge.proofStatus} status ${state}`);
  }
  for (const name of config.automerge.requiredChecks) {
    const state = checkState(checks.check_runs ?? [], name);
    if (state !== "success") blockers.push(`${name} check ${state}`);
  }
  return { labels, blockers, allowed: blockers.length === 0 };
}

async function main() {
  const args = parseArgs();
  const config = loadConfig();
  const prNumber = Number(args["pr-number"]);
  if (!Number.isInteger(prNumber)) throw new AgentError("missing --pr-number", 2);
  const dryRun = Boolean(args["dry-run"]);
  const pull = ghApiJson(`repos/${config.repo.owner}/${config.repo.name}/pulls/${prNumber}`);
  const issue = ghApiJson(`repos/${config.repo.owner}/${config.repo.name}/issues/${prNumber}`);
  const combined = ghApiJson(`repos/${config.repo.owner}/${config.repo.name}/commits/${pull.head.sha}/status`);
  const checks = ghApiJson(`repos/${config.repo.owner}/${config.repo.name}/commits/${pull.head.sha}/check-runs`);
  const decision = evaluate(config, pull, issue, combined, checks);

  if (!decision.allowed) {
    const comment = upsertManagedComment({
      config,
      number: prNumber,
      marker: config.comments.gate,
      body: `Automerge blocked:

${decision.blockers.map((item) => `- ${item}`).join("\n")}`,
      dryRun
    });
    finish({ ok: false, message: `automerge blocked for PR #${prNumber}`, decision, comment }, Boolean(args.json), 1);
    return;
  }

  if (!dryRun) {
    if (pull.draft) {
      runCommand("gh", ["pr", "ready", String(prNumber), "--repo", `${config.repo.owner}/${config.repo.name}`], {
        check: false
      });
    }
    runCommand("gh", ["pr", "merge", String(prNumber), "--repo", `${config.repo.owner}/${config.repo.name}`, "--auto", "--merge", "--delete-branch"]);
    removeLabels(config, prNumber, [config.labels.blocked], false);
  }
  finish({ ok: true, message: `${dryRun ? "would enable" : "enabled"} automerge for PR #${prNumber}`, decision }, Boolean(args.json));
}

main().catch((error) => fail(error, Boolean(parseArgs().json)));
