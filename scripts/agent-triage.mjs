#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  AgentError,
  addLabels,
  dispatchWorkflow,
  fail,
  finish,
  ghApiJson,
  issueLabels,
  loadConfig,
  markdownJsonBlock,
  parseArgs,
  readAgentJson,
  readText,
  removeLabels,
  repoRoot,
  upsertManagedComment
} from "./agent-lib.mjs";

function fetchIssue(config, issueNumber) {
  const issue = ghApiJson(`repos/${config.repo.owner}/${config.repo.name}/issues/${issueNumber}`);
  const comments = ghApiJson(`repos/${config.repo.owner}/${config.repo.name}/issues/${issueNumber}/comments`, {
    paginate: true
  });
  return { issue, comments };
}

function writePrompt(config, issueNumber, outputPath) {
  const { issue, comments } = fetchIssue(config, issueNumber);
  const docs = [
    ["VISION.md", readText(join(repoRoot(), "VISION.md"))],
    ["README.md", readText(join(repoRoot(), "README.md"))],
    ["CONTEXT.md", readText(join(repoRoot(), "CONTEXT.md")).slice(0, 16000)],
    ["docs/architecture.md", readText(join(repoRoot(), "docs/architecture.md"))],
    [".agent/agent-policy.md", readText(join(repoRoot(), ".agent/agent-policy.md"))]
  ];
  const prompt = `${readText(join(repoRoot(), ".agent/prompts/triage.md"))}

## Repository Context

${docs.map(([name, body]) => `### ${name}\n\n${body.trim()}`).join("\n\n")}

## Issue

Number: ${issue.number}
Title: ${issue.title}
Labels: ${issueLabels(issue).join(", ") || "none"}

Body:

${issue.body ?? ""}

## Comments

${comments.map((comment) => `### Comment ${comment.id}\n\n${comment.body ?? ""}`).join("\n\n") || "none"}
`;
  writeFileSync(outputPath, prompt);
  return { issueNumber, outputPath };
}

function triageBody(decision) {
  return `## Agent Triage

- value: ${decision.value}
- priority: ${decision.priority}
- risk: ${decision.risk}
- alignment: ${decision.alignment}
- proof needed: ${decision.proofNeeded}
- automation: ${decision.automationDecision}

Scope:

${decision.implementationScope}

${decision.humanQuestion ? `Human question:\n\n${decision.humanQuestion}\n` : ""}

Structured decision:
${markdownJsonBlock(decision)}`;
}

function applyDecision(config, issueNumber, decision, dryRun) {
  const add = [];
  const remove = [];
  const blocked =
    decision.alignment !== "yes" ||
    decision.automationDecision === "blocked" ||
    decision.automationDecision === "reject" ||
    decision.risk === "high" ||
    decision.priority === "high";
  const requiresVisualProof = decision.proofNeeded === "UI" || decision.proofNeeded === "GIF";

  if (decision.priority === "high") add.push(config.labels.priorityHigh);
  if (decision.priority === "low") add.push(config.labels.priorityLow);
  if (requiresVisualProof) add.push(config.labels.proof);

  if (blocked) {
    add.push(config.labels.blocked);
    remove.push(config.labels.implement, config.labels.automerge);
  } else if (decision.automationDecision === "implement") {
    add.push(config.labels.implement);
    remove.push(config.labels.blocked);
    if (decision.risk !== "high" && decision.priority !== "high") add.push(config.labels.automerge);
  }

  if (decision.priority !== "high") remove.push(config.labels.priorityHigh);
  if (decision.priority !== "low") remove.push(config.labels.priorityLow);
  if (!requiresVisualProof) remove.push(config.labels.proof);

  const comment = upsertManagedComment({
    config,
    number: issueNumber,
    marker: config.comments.triage,
    body: triageBody(decision),
    dryRun
  });
  return {
    comment,
    added: addLabels(config, issueNumber, [...new Set(add)], dryRun),
    removed: removeLabels(config, issueNumber, [...new Set(remove)], dryRun),
    dispatch:
      add.includes(config.labels.implement) && !dryRun
        ? dispatchWorkflow(config, "agent-implement.yml", { "issue-number": issueNumber }, false)
        : null
  };
}

async function main() {
  const args = parseArgs();
  const config = loadConfig();
  const issueNumber = Number(args["issue-number"]);
  if (!Number.isInteger(issueNumber)) throw new AgentError("missing --issue-number", 2);
  const dryRun = Boolean(args["dry-run"]);

  if (args["write-prompt"]) {
    const result = writePrompt(config, issueNumber, args["write-prompt"]);
    finish({ ok: true, message: `wrote triage prompt for #${issueNumber}`, ...result }, Boolean(args.json));
    return;
  }

  const fromFile = args["from-file"];
  if (!fromFile) throw new AgentError("missing --write-prompt or --from-file", 2);
  const decision = readAgentJson(fromFile);
  const applied = applyDecision(config, issueNumber, decision, dryRun);
  finish(
    {
      ok: true,
      message: `${dryRun ? "would apply" : "applied"} triage for #${issueNumber}`,
      decision,
      applied
    },
    Boolean(args.json)
  );
}

main().catch((error) => fail(error, Boolean(parseArgs().json)));
