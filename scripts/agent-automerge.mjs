#!/usr/bin/env node
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AgentError,
  assertTrustedAgentPull,
  extractJson,
  fail,
  finish,
  ghApiJson,
  ghJson,
  issueSnapshotSha256,
  issueLabels,
  loadConfig,
  newestManagedComment,
  parseImplementationMetadata,
  parseArgs,
  runCommand,
  upsertManagedComment
} from "./agent-lib.mjs";

function newest(items, timestampFields) {
  return [...items].sort((left, right) => {
    const leftTime = timestampFields.map((field) => Date.parse(left?.[field] ?? "")).find(Number.isFinite) ?? 0;
    const rightTime = timestampFields.map((field) => Date.parse(right?.[field] ?? "")).find(Number.isFinite) ?? 0;
    if (leftTime !== rightTime) return rightTime - leftTime;
    return Number(right?.id ?? 0) - Number(left?.id ?? 0);
  })[0];
}

function actionsUrlPattern(config, allowJob = false) {
  const repo = `${config.repo.owner}/${config.repo.name}`.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^https://github\\.com/${repo}/actions/runs/\\d+${allowJob ? "(?:/job/\\d+)?" : ""}$`, "i");
}

export function statusState(statuses, context, headSha, config) {
  const actionsUrl = actionsUrlPattern(config);
  const candidates = statuses.filter(
    (item) =>
      item.context === context &&
      item.sha === headSha &&
      String(item.creator?.login ?? "").toLowerCase() === "github-actions[bot]" &&
      actionsUrl.test(String(item.target_url ?? ""))
  );
  return newest(candidates, ["created_at", "updated_at"])?.state ?? "missing";
}

export function checkState(checks, name, headSha, config) {
  const actionsUrl = actionsUrlPattern(config, true);
  const candidates = checks.filter(
    (item) =>
      item.name === name &&
      item.head_sha === headSha &&
      item.app?.slug === "github-actions" &&
      actionsUrl.test(String(item.details_url ?? ""))
  );
  const run = newest(candidates, ["started_at", "created_at", "completed_at"]);
  if (!run) return "missing";
  return run.conclusion ?? run.status ?? "unknown";
}

export function implementationMetadata(body) {
  return parseImplementationMetadata(body);
}

function triageDecision(comments, marker, repoOwner) {
  const comment = newestManagedComment(comments, marker, repoOwner);
  if (!comment) throw new AgentError("source issue has no trusted managed triage", 1);
  const afterMarker = String(comment.body).slice(String(comment.body).indexOf(marker) + marker.length);
  const fences = [...afterMarker.matchAll(/```json\s*([\s\S]*?)```/gi)];
  if (fences.length !== 1) throw new AgentError("managed triage must contain exactly one decision JSON block", 1);
  const decision = extractJson(fences[0][1]);
  const expectedKeys = [
    "alignment",
    "automationDecision",
    "humanQuestion",
    "implementationScope",
    "issueSnapshotSha256",
    "priority",
    "proofNeeded",
    "risk",
    "value"
  ];
  if (
    !decision ||
    Array.isArray(decision) ||
    JSON.stringify(Object.keys(decision).sort()) !== JSON.stringify(expectedKeys) ||
    !["low", "medium", "high"].includes(decision.value) ||
    !["yes", "no", "unclear"].includes(decision.alignment) ||
    !["low", "medium", "high"].includes(decision.priority) ||
    !["low", "medium", "high"].includes(decision.risk) ||
    !["none", "CI", "UI", "GIF"].includes(decision.proofNeeded) ||
    !["implement", "manual-review", "blocked", "reject"].includes(decision.automationDecision) ||
    typeof decision.implementationScope !== "string" ||
    typeof decision.humanQuestion !== "string" ||
    !/^[a-f0-9]{64}$/.test(String(decision.issueSnapshotSha256 ?? ""))
  ) {
    throw new AgentError("managed triage JSON is invalid", 1);
  }
  return decision;
}

function includesClosingReference(body, issueNumber) {
  const escaped = String(issueNumber).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\\s+#${escaped}\\b`, "i").test(String(body ?? ""));
}

export function evaluate({ config, pull, pullIssue, sourceIssue, sourceComments, combined, checks, files, closingReferences }) {
  const prLabels = issueLabels(pullIssue);
  const sourceLabels = issueLabels(sourceIssue ?? {});
  const blockers = [];
  let metadata = null;
  let triage = null;
  let trustedPull = false;

  try {
    metadata = implementationMetadata(pull.body);
  } catch (error) {
    blockers.push(error.message);
  }

  try {
    assertTrustedAgentPull(pull, config, { files, rejectPrivilegedPaths: true });
    trustedPull = true;
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
    const referencedIssues = [...new Set((closingReferences ?? []).map((reference) => Number(reference.number)).filter(Number.isInteger))];
    if (referencedIssues.length !== 1 || referencedIssues[0] !== metadata.sourceIssue) {
      blockers.push("PR closing reference does not exactly match implementation source issue");
    }
    if (!metadata.automergeEligible) blockers.push("implementation metadata does not authorize automerge");
    try {
      assertTrustedAgentPull(pull, config, { files, sourceIssue, rejectPrivilegedPaths: true });
    } catch (error) {
      blockers.push(error.message);
    }
  }

  if (!sourceIssue || sourceIssue.state !== "open") blockers.push("source issue must be open");
  try {
    triage = triageDecision(sourceComments, config.comments.triage, config.repo.owner);
  } catch (error) {
    blockers.push(error.message);
  }
  if (triage) {
    if (metadata && triage.issueSnapshotSha256 !== metadata.issueSnapshotSha256) {
      blockers.push("source triage snapshot does not match implementation metadata");
    }
    if (sourceIssue && triage.issueSnapshotSha256 !== issueSnapshotSha256(sourceIssue)) {
      blockers.push("source issue changed after trusted triage");
    }
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
    const state = statusState(combined?.statuses ?? [], context, pull.head?.sha, config);
    if (state !== "success") blockers.push(`${context} status ${state}`);
  }

  const proofRequested =
    prLabels.includes(config.labels.proof) ||
    sourceLabels.includes(config.labels.proof) ||
    triage?.proofNeeded === "UI" ||
    triage?.proofNeeded === "GIF";
  if (proofRequested) {
    const state = statusState(combined?.statuses ?? [], config.automerge.proofStatus, pull.head?.sha, config);
    if (state !== "success") blockers.push(`${config.automerge.proofStatus} status ${state}`);
  }
  for (const name of config.automerge.requiredChecks) {
    const state = checkState(checks?.check_runs ?? [], name, pull.head?.sha, config);
    if (state !== "success") blockers.push(`${name} check ${state}`);
  }

  return {
    allowed: blockers.length === 0,
    trustedPull,
    blockers: [...new Set(blockers)],
    metadata,
    triage,
    proofRequested,
    prLabels,
    sourceLabels
  };
}

export function nativeMergeArgs(prNumber, config, headSha) {
  return [
    "pr",
    "merge",
    String(prNumber),
    "--repo",
    `${config.repo.owner}/${config.repo.name}`,
    "--merge",
    "--delete-branch",
    "--match-head-commit",
    headSha
  ];
}

export function disableNativeAutomergeArgs(prNumber, config) {
  return [
    "pr",
    "merge",
    String(prNumber),
    "--repo",
    `${config.repo.owner}/${config.repo.name}`,
    "--disable-auto"
  ];
}

export function revokeNativeAutomerge(
  { config, prNumber, pull, dryRun = false },
  dependencies = {}
) {
  if (!pull.auto_merge) return "not-enabled";
  if (dryRun) return "would-disable";
  const execute = dependencies.runCommand ?? runCommand;
  execute("gh", disableNativeAutomergeArgs(prNumber, config));
  return "disabled";
}

export function settleAutomerge(
  { config, prNumber, pull, decision, dryRun = false },
  dependencies = {}
) {
  const execute = dependencies.runCommand ?? runCommand;
  const upsert = dependencies.upsertManagedComment ?? upsertManagedComment;

  if (!decision.trustedPull) {
    return {
      code: 1,
      result: {
        ok: false,
        message: `automerge refused untrusted PR #${prNumber}`,
        decision,
        nativeAutomerge: "not-touched",
        comment: null
      }
    };
  }

  if (!decision.allowed) {
    const nativeAutomerge = revokeNativeAutomerge(
      { config, prNumber, pull, dryRun },
      { runCommand: execute }
    );
    const comment = upsert({
      config,
      number: prNumber,
      marker: `${config.comments.gate}\n<!-- agent-gate-automerge:v1 -->`,
      body: `Automerge blocked:\n\n${decision.blockers.map((item) => `- ${item}`).join("\n")}`,
      dryRun
    });
    return {
      code: 1,
      result: {
        ok: false,
        message: `automerge blocked for PR #${prNumber}`,
        decision,
        nativeAutomerge,
        comment
      }
    };
  }

  if (!dryRun) {
    revokeNativeAutomerge({ config, prNumber, pull }, { runCommand: execute });
    if (pull.draft) {
      execute("gh", ["pr", "ready", String(prNumber), "--repo", `${config.repo.owner}/${config.repo.name}`]);
    }
    execute("gh", nativeMergeArgs(prNumber, config, pull.head.sha));
  }
  return {
    code: 0,
    result: {
      ok: true,
      message: `${dryRun ? "would merge" : "merged"} PR #${prNumber}`,
      decision
    }
  };
}

async function main() {
  const args = parseArgs();
  const config = loadConfig();
  const prNumber = Number(args["pr-number"]);
  if (!Number.isInteger(prNumber) || prNumber <= 0) throw new AgentError("missing --pr-number", 2);
  const dryRun = Boolean(args["dry-run"]);
  const pull = ghApiJson(`repos/${config.repo.owner}/${config.repo.name}/pulls/${prNumber}`);
  const files = ghApiJson(
    `repos/${config.repo.owner}/${config.repo.name}/pulls/${prNumber}/files?per_page=100`,
    { paginate: true }
  ) ?? [];
  const pullIssue = ghApiJson(`repos/${config.repo.owner}/${config.repo.name}/issues/${prNumber}`);
  const prLabels = issueLabels(pullIssue);

  if (!config.automerge.requiredLabels.some((label) => prLabels.includes(label))) {
    try {
      assertTrustedAgentPull(pull, config, { files, rejectPrivilegedPaths: true });
    } catch {
      finish({ ok: true, message: `ignored non-agent PR #${prNumber}` }, Boolean(args.json));
      return;
    }
    const nativeAutomerge = revokeNativeAutomerge({ config, prNumber, pull, dryRun });
    finish(
      { ok: true, message: `automerge not requested for PR #${prNumber}`, nativeAutomerge },
      Boolean(args.json)
    );
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
  const closing = ghJson([
    "pr",
    "view",
    String(prNumber),
    "--repo",
    `${config.repo.owner}/${config.repo.name}`,
    "--json",
    "closingIssuesReferences"
  ]);
  const decision = evaluate({
    config,
    pull,
    pullIssue,
    sourceIssue,
    sourceComments,
    combined,
    checks,
    files,
    closingReferences: closing?.closingIssuesReferences ?? []
  });

  const outcome = settleAutomerge({ config, prNumber, pull, decision, dryRun });
  finish(outcome.result, Boolean(args.json), outcome.code);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => fail(error, Boolean(parseArgs().json)));
}
