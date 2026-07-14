#!/usr/bin/env node
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
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
  withTempJson
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

export function prBody(issue, codexOutput, metadata) {
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

export function preferredBranchName(issueNumber, title) {
  return `agent/issue-${issueNumber}-${slugify(title)}`;
}

export function selectExistingPull(pulls, config, issueNumber, preferredBranch) {
  const prefix = `agent/issue-${issueNumber}-`;
  const repo = `${config.repo.owner}/${config.repo.name}`;
  const candidates = pulls.filter(
    (pull) =>
      pull?.head?.repo?.full_name === repo &&
      pull?.base?.ref === config.repo.defaultBranch &&
      (pull.head.ref === preferredBranch || pull.head.ref.startsWith(prefix))
  );
  return (
    candidates
      .map((pull) => ({
        pull,
        score: (pull.state === "open" ? 4 : 0) + (pull.head.ref === preferredBranch ? 2 : 0) + (pull.merged_at ? 1 : 0)
      }))
      .sort((left, right) => right.score - left.score)[0]?.pull ?? null
  );
}

function listPulls(config) {
  const endpoint = `repos/${config.repo.owner}/${config.repo.name}/pulls?state=all&base=${encodeURIComponent(config.repo.defaultBranch)}&per_page=100`;
  return ghApiJson(endpoint, { paginate: true }) ?? [];
}

function remoteAgentBranches(issueNumber, cwd = repoRoot()) {
  const prefix = `refs/heads/agent/issue-${issueNumber}-*`;
  const result = runCommand("git", ["ls-remote", "--heads", "origin", prefix], { cwd, check: false });
  if (result.status !== 0) throw new AgentError("could not inspect existing agent branches", 1);
  return result.stdout
    .split("\n")
    .map((line) => line.trim().split(/\s+/).at(-1) ?? "")
    .filter((ref) => ref.startsWith("refs/heads/"))
    .map((ref) => ref.slice("refs/heads/".length));
}

export function chooseAgentBranch(preferredBranch, existingPull, remoteBranches) {
  if (existingPull?.head?.ref) return existingPull.head.ref;
  if (remoteBranches.includes(preferredBranch)) return preferredBranch;
  if (remoteBranches.length === 1) return remoteBranches[0];
  if (remoteBranches.length > 1) {
    throw new AgentError("multiple existing agent branches found for issue", 1, { branches: remoteBranches });
  }
  return preferredBranch;
}

function checkoutAgentBranch(config, branch, remoteExists, cwd = repoRoot()) {
  const baseRemoteRef = `refs/remotes/origin/${config.repo.defaultBranch}`;
  runCommand("git", [
    "fetch",
    "origin",
    `+refs/heads/${config.repo.defaultBranch}:${baseRemoteRef}`
  ], { cwd });
  if (remoteExists) {
    const branchRemoteRef = `refs/remotes/origin/${branch}`;
    runCommand("git", ["fetch", "origin", `+refs/heads/${branch}:${branchRemoteRef}`], { cwd });
    runCommand("git", ["switch", "-C", branch, branchRemoteRef], { cwd });
    return;
  }
  runCommand("git", ["switch", "-C", branch, baseRemoteRef], { cwd });
}

export function applyPatchIdempotently(patchPath, cwd = repoRoot()) {
  if (!existsSync(patchPath)) throw new AgentError(`patch not found: ${patchPath}`, 2);
  if (!readText(patchPath).trim()) throw new AgentError("patch is empty", 2);
  const forward = runCommand("git", ["apply", "--check", patchPath], { cwd, check: false });
  if (forward.status === 0) {
    runCommand("git", ["apply", "--index", patchPath], { cwd });
    return "applied";
  }
  const reverse = runCommand("git", ["apply", "--reverse", "--check", patchPath], { cwd, check: false });
  if (reverse.status === 0) return "already-applied";
  throw new AgentError("agent patch conflicts with the existing agent branch", 1);
}

export function upsertPullRequest({ config, issue, branch, codexOutput, metadata, existingPull }, dependencies = {}) {
  const apiJson = dependencies.ghJson ?? ghJson;
  const tempJson = dependencies.withTempJson ?? withTempJson;
  const body = prBody(issue, codexOutput, metadata);
  const payload = {
    title: `Agent: ${issue.title}`,
    body,
    base: config.repo.defaultBranch
  };
  const endpoint = existingPull
    ? `repos/${config.repo.owner}/${config.repo.name}/pulls/${existingPull.number}`
    : `repos/${config.repo.owner}/${config.repo.name}/pulls`;
  if (!existingPull) {
    payload.head = branch;
    payload.draft = true;
  }
  const pull = tempJson(payload, (bodyPath) =>
    apiJson(["api", endpoint, "-X", existingPull ? "PATCH" : "POST", "--input", bodyPath])
  );
  return {
    action: existingPull ? "updated" : "created",
    number: pull.number,
    url: pull.html_url ?? pull.url
  };
}

export function dispatchWorkflowAtRef(config, workflow, ref, dependencies = {}) {
  const run = dependencies.runCommand ?? runCommand;
  const args = [
    "workflow",
    "run",
    workflow,
    "--repo",
    `${config.repo.owner}/${config.repo.name}`,
    "--ref",
    ref
  ];
  run("gh", args);
  return { ok: true, workflow, ref };
}

function checkEnvironment() {
  const env = { ...process.env };
  for (const name of ["GH_TOKEN", "GITHUB_TOKEN", "AGENT_PAT", "OPENAI_API_KEY", "CODEX_API_KEY"]) {
    delete env[name];
  }
  return env;
}

export function privilegedPatchPaths(paths) {
  return paths.filter(
    (path) =>
      path.startsWith(".agent/") ||
      path.startsWith(".github/") ||
      path.startsWith("scripts/agent-") ||
      path === "AGENTS.md" ||
      path === "package.json" ||
      path === "package-lock.json" ||
      path === ".npmrc"
  );
}

export function implementationPullLabels(config, sourceLabels) {
  const labels = [config.labels.review];
  for (const propagated of [
    config.labels.automerge,
    config.labels.priorityHigh,
    config.labels.priorityLow,
    config.labels.proof
  ]) {
    if (sourceLabels.includes(propagated)) labels.push(propagated);
  }
  return [...new Set(labels)];
}

function changedPaths(config, cwd = repoRoot()) {
  const base = `refs/remotes/origin/${config.repo.defaultBranch}`;
  const committed = runCommand("git", ["diff", "--name-only", `${base}...HEAD`], { cwd }).stdout;
  const staged = runCommand("git", ["diff", "--cached", "--name-only"], { cwd }).stdout;
  return [...new Set(`${committed}\n${staged}`.split("\n").map((path) => path.trim()).filter(Boolean))];
}

function normalizeImplementationError(error) {
  if (error instanceof AgentError && error.code === 2 && error.details === undefined) return error;
  const details = {};
  if (Array.isArray(error?.details?.paths)) details.paths = error.details.paths;
  if (Array.isArray(error?.details?.branches)) details.branches = error.details.branches;
  return new AgentError(error?.message ?? String(error), 1, Object.keys(details).length ? details : undefined);
}

function markImplementationFailure(config, issueNumber, error) {
  const result = { labels: null, comment: null };
  try {
    result.labels = {
      added: addLabels(config, issueNumber, [config.labels.blocked], false),
      removed: removeLabels(config, issueNumber, [config.labels.implement, config.labels.automerge], false)
    };
  } catch (labelError) {
    result.labels = { error: labelError?.message ?? String(labelError) };
  }
  try {
    result.comment = upsertManagedComment({
      config,
      number: issueNumber,
      marker: `${config.comments.gate}\n<!-- agent-gate-implement:v1 -->`,
      body: `Agent implementation blocked after an automation failure.

Structured blocker:
${markdownJsonBlock({
  failure: error.message,
  blockedPaths: error.details?.paths ?? [],
  branches: error.details?.branches ?? [],
  actionsRun: error.details?.actionsRun ?? "",
  requiredAction: "retry-or-human-review"
})}`,
      dryRun: false
    });
  } catch (commentError) {
    result.comment = { error: commentError?.message ?? String(commentError) };
  }
  return result;
}

export function applyPatchAndOpenPr(config, issueNumber, patchPath, codexOutputPath, dryRun) {
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
  const preferredBranch = preferredBranchName(issueNumber, issue.title);
  const existingPull = selectExistingPull(listPulls(config), config, issueNumber, preferredBranch);
  const remoteBranches = remoteAgentBranches(issueNumber);
  const branch = chooseAgentBranch(preferredBranch, existingPull, remoteBranches);
  const remoteExists = remoteBranches.includes(branch);
  const codexOutput = codexOutputPath && existsSync(codexOutputPath) ? readText(codexOutputPath) : "";

  if (existingPull?.merged_at) {
    if (!dryRun) removeLabels(config, issueNumber, [config.labels.implement, config.labels.blocked], false);
    return {
      branch,
      action: dryRun ? "would-reuse-merged-pr" : "reused-merged-pr",
      issue: issue.number,
      pr: existingPull.number,
      url: existingPull.html_url
    };
  }
  if (existingPull && existingPull.state !== "open") {
    if (dryRun) {
      return { branch, action: "would-block-closed-pr", issue: issue.number, pr: existingPull.number };
    }
    throw new AgentError(`existing agent PR #${existingPull.number} is closed`, 1);
  }
  if (dryRun) {
    return {
      branch,
      action: existingPull ? "would-update-branch-pr" : "would-upsert-branch-pr",
      issue: issue.number,
      pr: existingPull?.number ?? null,
      remoteExists
    };
  }

  runCommand("gh", ["auth", "setup-git", "--hostname", "github.com"]);
  checkoutAgentBranch(config, branch, remoteExists);
  const patchAction = applyPatchIdempotently(patchPath);
  const env = checkEnvironment();
  const privilegedPaths = privilegedPatchPaths(changedPaths(config));
  if (privilegedPaths.length) {
    throw new AgentError("agent patch touches privileged paths", 1, { paths: privilegedPaths });
  }
  let committed = false;
  const staged = gitOutput(["diff", "--cached", "--name-only"]);
  for (const command of config.commands.defaultImplementChecks) runShell(command, { env });
  if (staged) {
    runCommand("git", ["config", "user.name", "github-actions[bot]"]);
    runCommand("git", ["config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com"]);
    runCommand("git", ["commit", "-m", `chore: implement agent issue #${issueNumber}`]);
    committed = true;
  }
  if (committed || !remoteExists) {
    runCommand("git", ["push", "origin", `HEAD:refs/heads/${branch}`]);
  }
  const pull = upsertPullRequest({ config, issue, branch, codexOutput, metadata, existingPull });
  const prLabels = implementationPullLabels(config, labels);
  addLabels(config, pull.number, prLabels, false);
  const dispatch = {
    ci: dispatchWorkflowAtRef(config, "ci.yml", branch),
    review: dispatchWorkflow(config, "agent-review.yml", { "pr-number": pull.number }, false)
  };
  removeLabels(config, issueNumber, [config.labels.implement, config.labels.blocked], false);
  upsertManagedComment({
    config,
    number: issueNumber,
    marker: `${config.comments.gate}\n<!-- agent-gate-implement:v1 -->`,
    body: `${pull.action === "created" ? "Opened" : "Updated"} agent PR: ${pull.url}

Structured handoff:
${markdownJsonBlock({
  pr: pull.number,
  branch,
  patchAction,
  committed,
  checks: config.commands.defaultImplementChecks
})}`,
    dryRun: false
  });
  return { branch, pr: pull.number, url: pull.url, action: pull.action, patchAction, committed, dispatch };
}

export async function main() {
  const args = parseArgs();
  const config = loadConfig();
  const issueNumber = Number(args["issue-number"]);
  if (args["issue-number"] === true || !Number.isInteger(issueNumber) || issueNumber <= 0) {
    throw new AgentError("missing --issue-number", 2);
  }
  const dryRun = Boolean(args["dry-run"]);

  if (args["write-prompt"]) {
    finish({ ok: true, message: `wrote implement prompt for #${issueNumber}`, ...writePrompt(config, issueNumber, args["write-prompt"]) }, Boolean(args.json));
    return;
  }
  if (args["create-patch"]) {
    finish({ ok: true, message: `created implementation patch for #${issueNumber}`, ...createPatch(args["create-patch"]) }, Boolean(args.json));
    return;
  }
  if (args["mark-failed"]) {
    const actionsRun =
      process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
        ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
        : "";
    const error = new AgentError("implementation workflow did not open or update an agent PR", 1, {
      actionsRun
    });
    const result = dryRun ? { dryRun: true } : markImplementationFailure(config, issueNumber, error);
    finish(
      { ok: true, message: `${dryRun ? "would record" : "recorded"} implementation workflow failure for #${issueNumber}`, result },
      Boolean(args.json)
    );
    return;
  }
  if (args["apply-patch"]) {
    try {
      const result = applyPatchAndOpenPr(config, issueNumber, args["apply-patch"], args["codex-output"], dryRun);
      finish(
        { ok: true, message: `${dryRun ? "would upsert" : "upserted"} implementation PR for #${issueNumber}`, result },
        Boolean(args.json)
      );
    } catch (error) {
      const normalized = normalizeImplementationError(error);
      if (!dryRun && normalized.code !== 2) markImplementationFailure(config, issueNumber, normalized);
      throw normalized;
    }
    return;
  }
  throw new AgentError("missing --write-prompt, --create-patch, --apply-patch, or --mark-failed", 2);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => fail(error, Boolean(parseArgs().json)));
}
