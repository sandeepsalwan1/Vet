#!/usr/bin/env node
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AgentError,
  extractJson,
  fail,
  finish,
  ghApiJson,
  issueLabels,
  loadConfig,
  parseArgs,
  runCommand,
  upsertManagedComment
} from "./agent-lib.mjs";

const IMPLEMENTATION_MARKER = "<!-- agent-implementation:v1 -->";
const TRUSTED_TRIAGE_AUTHOR = "github-actions[bot]";

function newest(items, timestampFields) {
  return [...items].sort((left, right) => {
    const leftTime = timestampFields.map((field) => Date.parse(left?.[field] ?? "")).find(Number.isFinite) ?? 0;
    const rightTime = timestampFields.map((field) => Date.parse(right?.[field] ?? "")).find(Number.isFinite) ?? 0;
    if (leftTime !== rightTime) return rightTime - leftTime;
    return Number(right?.id ?? 0) - Number(left?.id ?? 0);
  })[0];
}

export function statusState(statuses, context, headSha) {
  const candidates = statuses.filter((item) => item.context === context && item.sha === headSha);
  return newest(candidates, ["created_at", "updated_at"])?.state ?? "missing";
}

export function checkState(checks, name, headSha) {
  const candidates = checks.filter((item) => item.name === name && item.head_sha === headSha);
  const run = newest(candidates, ["started_at", "created_at", "completed_at"]);
  if (!run) return "missing";
  return run.conclusion ?? run.status ?? "unknown";
}

export function implementationMetadata(body) {
  const text = String(body ?? "");
  if (text.split(IMPLEMENTATION_MARKER).length !== 2) {
    throw new AgentError("PR must contain exactly one agent implementation marker", 1);
  }
  const afterMarker = text.slice(text.indexOf(IMPLEMENTATION_MARKER) + IMPLEMENTATION_MARKER.length);
  const fence = afterMarker.match(/```json\s*([\s\S]*?)```/i);
  if (!fence) throw new AgentError("agent implementation metadata JSON is missing", 1);
  const metadata = extractJson(fence[1]);
  if (
    !metadata ||
    Array.isArray(metadata) ||
    !Number.isInteger(metadata.sourceIssue) ||
    metadata.sourceIssue <= 0 ||
    !Array.isArray(metadata.sourceLabels) ||
    !metadata.sourceLabels.every((label) => typeof label === "string") ||
    typeof metadata.automergeEligible !== "boolean"
  ) {
    throw new AgentError("agent implementation metadata is invalid", 1);
  }
  return metadata;
}

function triageDecision(comments, marker) {
  const candidates = (comments ?? []).filter(
    (comment) =>
      comment?.user?.login === TRUSTED_TRIAGE_AUTHOR &&
      String(comment.body ?? "").split(marker).length === 2
  );
  const comment = newest(candidates, ["updated_at", "created_at"]);
  if (!comment) throw new AgentError("source issue has no trusted managed triage", 1);
  const afterMarker = String(comment.body).slice(String(comment.body).indexOf(marker) + marker.length);
  const fence = afterMarker.match(/```json\s*([\s\S]*?)```/i);
  if (!fence) throw new AgentError("managed triage JSON is missing", 1);
  const decision = extractJson(fence[1]);
  if (
    !decision ||
    Array.isArray(decision) ||
    !["yes", "no", "unclear"].includes(decision.alignment) ||
    !["low", "medium", "high"].includes(decision.priority) ||
    !["low", "medium", "high"].includes(decision.risk) ||
    !["none", "CI", "UI", "GIF"].includes(decision.proofNeeded) ||
    !["implement", "manual-review", "blocked", "reject"].includes(decision.automationDecision) ||
    typeof decision.humanQuestion !== "string"
  ) {
    throw new AgentError("managed triage JSON is invalid", 1);
  }
  return decision;
}

function includesClosingReference(body, issueNumber) {
  const escaped = String(issueNumber).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\\s+#${escaped}\\b`, "i").test(String(body ?? ""));
}

export function evaluate({ config, pull, pullIssue, sourceIssue, sourceComments, combined, checks }) {
  const prLabels = issueLabels(pullIssue);
  const sourceLabels = issueLabels(sourceIssue ?? {});
  const blockers = [];
  let metadata = null;
  let triage = null;

  try {
    metadata = implementationMetadata(pull.body);
  } catch (error) {
    blockers.push(error.message);
  }

  const expectedRepo = `${config.repo.owner}/${config.repo.name}`;
  const branchMatch = String(pull.head?.ref ?? "").match(/^agent\/issue-(\d+)-[a-z0-9][a-z0-9-]*$/);
  if (pull.head?.repo?.full_name !== expectedRepo || pull.base?.repo?.full_name !== expectedRepo) {
    blockers.push("PR must use a same-repository branch");
  }
  if (pull.base?.ref !== config.repo.defaultBranch) blockers.push(`PR base must be ${config.repo.defaultBranch}`);
  if (!branchMatch) blockers.push("PR head must match agent/issue-<number>-<slug>");
  if (pull.state !== "open" || pull.merged) blockers.push("PR must be open and unmerged");

  if (metadata) {
    const branchIssue = Number(branchMatch?.[1]);
    if (branchIssue !== metadata.sourceIssue) blockers.push("PR branch does not match implementation source issue");
    if (sourceIssue?.number !== metadata.sourceIssue || sourceIssue?.pull_request) {
      blockers.push("implementation metadata does not match a source issue");
    }
    if (!includesClosingReference(pull.body, metadata.sourceIssue)) {
      blockers.push(`PR does not close source issue #${metadata.sourceIssue}`);
    }
    if (!metadata.automergeEligible) blockers.push("implementation metadata does not authorize automerge");
  }

  if (!sourceIssue || sourceIssue.state !== "open") blockers.push("source issue must be open");
  try {
    triage = triageDecision(sourceComments, config.comments.triage);
  } catch (error) {
    blockers.push(error.message);
  }
  if (triage) {
    if (triage.alignment !== "yes") blockers.push(`source triage alignment is ${triage.alignment}`);
    if (!["low", "medium"].includes(triage.risk)) blockers.push(`source triage risk is ${triage.risk}`);
    if (!["low", "medium"].includes(triage.priority)) blockers.push(`source triage priority is ${triage.priority}`);
    if (triage.automationDecision !== "implement") {
      blockers.push(`source triage automation decision is ${triage.automationDecision}`);
    }
    if (triage.humanQuestion.trim()) blockers.push("source triage has an unresolved human question");
  }

  for (const label of config.automerge.requiredLabels) {
    if (!prLabels.includes(label)) blockers.push(`PR missing label ${label}`);
  }
  if (!sourceLabels.includes(config.labels.automerge)) {
    blockers.push(`source issue missing label ${config.labels.automerge}`);
  }
  for (const label of config.automerge.blockedLabels) {
    if (prLabels.includes(label)) blockers.push(`PR blocked by label ${label}`);
    if (sourceLabels.includes(label)) blockers.push(`source issue blocked by label ${label}`);
  }

  if (combined?.sha !== pull.head?.sha) blockers.push("commit statuses are not for the current PR head");
  for (const context of config.automerge.requiredStatuses) {
    const state = statusState(combined?.statuses ?? [], context, pull.head?.sha);
    if (state !== "success") blockers.push(`${context} status ${state}`);
  }

  const proofRequested =
    prLabels.includes(config.labels.proof) ||
    sourceLabels.includes(config.labels.proof) ||
    triage?.proofNeeded === "UI" ||
    triage?.proofNeeded === "GIF";
  if (proofRequested) {
    const state = statusState(combined?.statuses ?? [], config.automerge.proofStatus, pull.head?.sha);
    if (state !== "success") blockers.push(`${config.automerge.proofStatus} status ${state}`);
  }
  for (const name of config.automerge.requiredChecks) {
    const state = checkState(checks?.check_runs ?? [], name, pull.head?.sha);
    if (state !== "success") blockers.push(`${name} check ${state}`);
  }

  return {
    allowed: blockers.length === 0,
    blockers: [...new Set(blockers)],
    metadata,
    triage,
    proofRequested,
    prLabels,
    sourceLabels
  };
}

export function nativeAutomergeArgs(prNumber, config, headSha) {
  return [
    "pr",
    "merge",
    String(prNumber),
    "--repo",
    `${config.repo.owner}/${config.repo.name}`,
    "--auto",
    "--merge",
    "--delete-branch",
    "--match-head-commit",
    headSha
  ];
}

async function main() {
  const args = parseArgs();
  const config = loadConfig();
  const prNumber = Number(args["pr-number"]);
  if (!Number.isInteger(prNumber) || prNumber <= 0) throw new AgentError("missing --pr-number", 2);
  const dryRun = Boolean(args["dry-run"]);
  const pull = ghApiJson(`repos/${config.repo.owner}/${config.repo.name}/pulls/${prNumber}`);
  const pullIssue = ghApiJson(`repos/${config.repo.owner}/${config.repo.name}/issues/${prNumber}`);
  const prLabels = issueLabels(pullIssue);

  if (!config.automerge.requiredLabels.some((label) => prLabels.includes(label))) {
    finish({ ok: true, message: `automerge not requested for PR #${prNumber}` }, Boolean(args.json));
    return;
  }

  let sourceIssue = null;
  let sourceComments = [];
  try {
    const metadata = implementationMetadata(pull.body);
    sourceIssue = ghApiJson(`repos/${config.repo.owner}/${config.repo.name}/issues/${metadata.sourceIssue}`);
    sourceComments = ghApiJson(
      `repos/${config.repo.owner}/${config.repo.name}/issues/${metadata.sourceIssue}/comments`,
      { paginate: true }
    );
  } catch {
    // Evaluation reports malformed or missing metadata without trusting a source issue.
  }
  const combined = ghApiJson(`repos/${config.repo.owner}/${config.repo.name}/commits/${pull.head.sha}/status`);
  const checks = ghApiJson(`repos/${config.repo.owner}/${config.repo.name}/commits/${pull.head.sha}/check-runs`);
  const decision = evaluate({ config, pull, pullIssue, sourceIssue, sourceComments, combined, checks });

  if (!decision.allowed) {
    const comment = upsertManagedComment({
      config,
      number: prNumber,
      marker: `${config.comments.gate}\n<!-- agent-gate-automerge:v1 -->`,
      body: `Automerge blocked:\n\n${decision.blockers.map((item) => `- ${item}`).join("\n")}`,
      dryRun
    });
    finish(
      { ok: false, message: `automerge blocked for PR #${prNumber}`, decision, comment },
      Boolean(args.json),
      1
    );
    return;
  }

  if (!dryRun) {
    if (pull.draft) {
      runCommand("gh", ["pr", "ready", String(prNumber), "--repo", `${config.repo.owner}/${config.repo.name}`]);
    }
    runCommand("gh", nativeAutomergeArgs(prNumber, config, pull.head.sha));
  }
  finish(
    { ok: true, message: `${dryRun ? "would enable" : "enabled"} automerge for PR #${prNumber}`, decision },
    Boolean(args.json)
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => fail(error, Boolean(parseArgs().json)));
}
