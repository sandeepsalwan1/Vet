#!/usr/bin/env node
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  AgentError,
  addLabels,
  dispatchWorkflow,
  fail,
  finish,
  ghApiJson,
  ghJson,
  gitOutput,
  issueLabels,
  loadConfig,
  markdownJsonBlock,
  parseArgs,
  readText,
  removeLabels,
  repoRoot,
  runCommand,
  runShell,
  slugify,
  upsertManagedComment,
  withTempText
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
  const triage = comments.find((comment) => String(comment.body ?? "").includes(config.comments.triage));
  const prompt = `${readText(join(repoRoot(), ".agent/prompts/implement.md"))}

## Issue

Number: ${issue.number}
Title: ${issue.title}
Labels: ${issueLabels(issue).join(", ") || "none"}

Body:

${issue.body ?? ""}

## Agent Triage

${triage?.body ?? "No managed triage comment found."}
`;
  mkdirSync(join(repoRoot(), ".agent-output"), { recursive: true });
  writeFileSync(outputPath, prompt);
  return { issueNumber, outputPath };
}

function createPatch(outputPath) {
  runCommand("git", ["add", "-N", "."]);
  const diff = runCommand("git", [
    "diff",
    "--binary",
    "HEAD",
    "--",
    ".",
    ":(exclude).agent-output/**",
    ":(exclude)codex.patch",
    ":(exclude)review.patch"
  ]).stdout;
  writeFileSync(outputPath, diff);
  if (!diff.trim()) throw new AgentError("agent produced no file changes", 1);
  return { outputPath, bytes: Buffer.byteLength(diff) };
}

function prBody(issue, codexOutput, metadata) {
  return `Agent implementation for #${issue.number}.

Closes #${issue.number}

## Source Issue

${issue.title}

## Agent Output

${codexOutput?.trim() || "No final agent output captured."}

<!-- agent-implementation:v1 -->
Agent implementation metadata:
${markdownJsonBlock(metadata)}

## Gate Policy

- CI must pass.
- Agent review must pass.
- no-mistakes must pass before automerge.
- High-priority or high-risk work remains manual.
`;
}

function checkEnvironment() {
  const env = { ...process.env };
  for (const name of ["GH_TOKEN", "GITHUB_TOKEN", "AGENT_PAT", "OPENAI_API_KEY", "CODEX_API_KEY"]) {
    delete env[name];
  }
  return env;
}

function applyPatchAndOpenPr(config, issueNumber, patchPath, codexOutputPath, dryRun) {
  if (!existsSync(patchPath)) throw new AgentError(`patch not found: ${patchPath}`, 2);
  const { issue } = fetchIssue(config, issueNumber);
  const labels = issueLabels(issue);
  const metadata = {
    sourceIssue: issue.number,
    sourceLabels: labels,
    automergeEligible:
      labels.includes(config.labels.automerge) &&
      !labels.includes(config.labels.priorityHigh) &&
      !labels.includes(config.labels.blocked)
  };
  const branch = `agent/issue-${issueNumber}-${slugify(issue.title)}`;
  const codexOutput = codexOutputPath && existsSync(codexOutputPath) ? readText(codexOutputPath) : "";

  if (dryRun) {
    return { branch, action: "would-apply-patch-open-pr", issue: issue.number };
  }

  runCommand("git", ["switch", "-c", branch]);
  runCommand("git", ["apply", "--index", patchPath]);
  const env = checkEnvironment();
  for (const command of config.commands.defaultImplementChecks) runShell(command, { env });
  const staged = gitOutput(["diff", "--cached", "--name-only"]);
  if (!staged) throw new AgentError("patch applied no staged changes", 1);
  runCommand("git", ["config", "user.name", "github-actions[bot]"]);
  runCommand("git", ["config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com"]);
  runCommand("git", ["commit", "-m", `chore: implement agent issue #${issueNumber}`]);
  runCommand("gh", ["auth", "setup-git", "--hostname", "github.com"]);
  runCommand("git", ["push", "origin", branch]);
  const created = withTempText(prBody(issue, codexOutput, metadata), ".md", (bodyFile) =>
    ghJson([
      "pr",
      "create",
      "--repo",
      `${config.repo.owner}/${config.repo.name}`,
      "--base",
      config.repo.defaultBranch,
      "--head",
      branch,
      "--draft",
      "--title",
      `Agent: ${issue.title}`,
      "--body-file",
      bodyFile,
      "--json",
      "number,url"
    ])
  );
  const prLabels = [config.labels.review];
  for (const propagated of [config.labels.priorityHigh, config.labels.priorityLow, config.labels.proof]) {
    if (labels.includes(propagated)) prLabels.push(propagated);
  }
  addLabels(config, created.number, [...new Set(prLabels)], false);
  const dispatch = dispatchWorkflow(config, "agent-review.yml", { "pr-number": created.number }, false);
  removeLabels(config, issueNumber, [config.labels.implement], false);
  upsertManagedComment({
    config,
    number: issueNumber,
    marker: config.comments.gate,
    body: `Opened draft PR: ${created.url}

Structured handoff:
${markdownJsonBlock({ pr: created.number, branch, checks: config.commands.defaultImplementChecks })}`,
    dryRun: false
  });
  return { branch, pr: created.number, url: created.url, dispatch };
}

async function main() {
  const args = parseArgs();
  const config = loadConfig();
  const issueNumber = Number(args["issue-number"]);
  if (!Number.isInteger(issueNumber)) throw new AgentError("missing --issue-number", 2);
  const dryRun = Boolean(args["dry-run"]);

  if (args["write-prompt"]) {
    finish({ ok: true, message: `wrote implement prompt for #${issueNumber}`, ...writePrompt(config, issueNumber, args["write-prompt"]) }, Boolean(args.json));
    return;
  }
  if (args["create-patch"]) {
    finish({ ok: true, message: `created implementation patch for #${issueNumber}`, ...createPatch(args["create-patch"]) }, Boolean(args.json));
    return;
  }
  if (args["apply-patch"]) {
    const result = applyPatchAndOpenPr(config, issueNumber, args["apply-patch"], args["codex-output"], dryRun);
    finish({ ok: true, message: `${dryRun ? "would open" : "opened"} implementation PR for #${issueNumber}`, result }, Boolean(args.json));
    return;
  }
  throw new AgentError("missing --write-prompt, --create-patch, or --apply-patch", 2);
}

main().catch((error) => fail(error, Boolean(parseArgs().json)));
