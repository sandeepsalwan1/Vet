#!/usr/bin/env node
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
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
  privilegedCandidatePaths,
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
  const path = allowJob
    ? "(?:actions/runs/\\d+(?:/job/\\d+)?|runs/\\d+)"
    : "actions/runs/\\d+";
  return new RegExp(`^https://github\\.com/${repo}/${path}$`, "i");
}

export function statusState(statuses, context, config) {
  const actionsUrl = actionsUrlPattern(config);
  const candidates = statuses.filter(
    (item) =>
      item.context === context &&
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

function repoSlug(config) {
  return `${config.repo.owner}/${config.repo.name}`;
}

export function isStaleBase(pull) {
  return String(pull?.mergeable_state ?? "").toLowerCase() === "behind";
}

export function resolveBaseState({ config, pull }, dependencies = {}) {
  const expectedRepo = repoSlug(config);
  const headSha = String(pull?.head?.sha ?? "");
  const getBaseHead =
    dependencies.getBaseHead ??
    (() => ghApiJson(`repos/${expectedRepo}/commits/${config.repo.defaultBranch}`)?.sha);
  const hasAncestor =
    dependencies.hasAncestor ??
    ((ancestor, descendant) =>
      comparisonHasAncestor(
        ghApiJson(`repos/${expectedRepo}/compare/${ancestor}...${descendant}`),
        ancestor
      ));
  const baseHead = String(getBaseHead() ?? "");
  if (!/^[a-f0-9]{40}$/.test(headSha) || !/^[a-f0-9]{40}$/.test(baseHead)) {
    throw new AgentError("could not resolve exact base and pull request heads", 1);
  }
  return {
    baseHead,
    headSha,
    stale: !hasAncestor(baseHead, headSha),
    mergeableState: String(pull?.mergeable_state ?? "unknown").toLowerCase()
  };
}

export function updateBranchArgs(prNumber, config, headSha) {
  return [
    "api",
    `repos/${config.repo.owner}/${config.repo.name}/pulls/${prNumber}/update-branch`,
    "--method",
    "PUT",
    "-f",
    `expected_head_sha=${headSha}`
  ];
}

export function recoveryDispatchArgs(prNumber, config, headSha, proofRequested = false) {
  const repo = repoSlug(config);
  const common = ["--repo", repo, "--ref", config.repo.defaultBranch];
  const dispatches = [
    [
      "workflow",
      "run",
      "ci.yml",
      ...common,
      "-f",
      `pr-number=${prNumber}`,
      "-f",
      `expected-head-sha=${headSha}`
    ],
    [
      "workflow",
      "run",
      "agent-review.yml",
      ...common,
      "-f",
      `pr-number=${prNumber}`,
      "-f",
      `expected-head-sha=${headSha}`
    ]
  ];
  if (proofRequested) {
    dispatches.push([
      "workflow",
      "run",
      "agent-proof.yml",
      ...common,
      "-f",
      "target-kind=pr",
      "-f",
      `target-number=${prNumber}`,
      "-f",
      `expected-head-sha=${headSha}`
    ]);
  }
  return dispatches;
}

function comparisonHasAncestor(comparison, ancestor) {
  return comparison?.merge_base_commit?.sha === ancestor;
}

export async function recoverStaleBase(
  { config, prNumber, pull, decision, baseState, dryRun = false },
  dependencies = {}
) {
  if (!decision.trustedPull || !decision.staleRecoveryAllowed || baseState?.stale !== true) {
    throw new AgentError("stale-base recovery requires an eligible trusted PR that is behind its base", 1);
  }

  const oldHead = pull.head?.sha;
  const headRef = pull.head?.ref;
  const expectedRepo = repoSlug(config);
  if (!/^[a-f0-9]{40}$/.test(String(oldHead ?? ""))) throw new AgentError("PR head SHA is invalid", 1);
  const execute = dependencies.runCommand ?? runCommand;
  const nativeAutomerge = revokeNativeAutomerge(
    { config, prNumber, pull, dryRun },
    { runCommand: execute }
  );

  if (dryRun) {
    return {
      code: 0,
      result: {
        ok: true,
        message: `would update stale base and rerun gates for PR #${prNumber}`,
        decision,
        recovery: {
          oldHead,
          newHead: null,
          dispatches: [],
          proofRequested: decision.proofRequested,
          nativeAutomerge
        }
      }
    };
  }

  const getPull = dependencies.getPull ?? (() => ghApiJson(`repos/${expectedRepo}/pulls/${prNumber}`));
  const hasAncestor =
    dependencies.hasAncestor ??
    ((ancestor, descendant) =>
      comparisonHasAncestor(
        ghApiJson(`repos/${expectedRepo}/compare/${ancestor}...${descendant}`),
        ancestor
      ));
  const wait = dependencies.wait ?? delay;
  const baseHead = baseState.baseHead;
  if (!/^[a-f0-9]{40}$/.test(String(baseHead ?? ""))) throw new AgentError("base branch head SHA is invalid", 1);
  if (hasAncestor(baseHead, oldHead)) {
    throw new AgentError("pull request head already contains the current base", 1);
  }

  execute("gh", updateBranchArgs(prNumber, config, oldHead));

  let updatedPull = null;
  const pollAttempts = 60;
  for (let attempt = 0; attempt < pollAttempts; attempt += 1) {
    const candidate = getPull();
    if (
      candidate?.state !== "open" ||
      candidate?.merged ||
      candidate?.head?.repo?.full_name !== expectedRepo ||
      candidate?.head?.ref !== headRef ||
      candidate?.base?.ref !== config.repo.defaultBranch
    ) {
      throw new AgentError("PR identity changed during stale-base recovery", 1);
    }
    if (candidate.head?.sha !== oldHead) {
      updatedPull = candidate;
      break;
    }
    if (attempt < pollAttempts - 1) await wait(500);
  }

  const newHead = updatedPull?.head?.sha;
  if (!/^[a-f0-9]{40}$/.test(String(newHead ?? "")) || newHead === oldHead) {
    throw new AgentError("stale-base update did not produce a new PR head", 1);
  }
  if (!hasAncestor(oldHead, newHead) || !hasAncestor(baseHead, newHead)) {
    throw new AgentError("updated PR head does not contain the authorized head and base", 1);
  }

  const dispatches = recoveryDispatchArgs(prNumber, config, newHead, decision.proofRequested);
  const dispatchErrors = [];
  for (const args of dispatches) {
    try {
      execute("gh", args);
    } catch (error) {
      dispatchErrors.push(error?.message ?? String(error));
    }
  }
  return {
    code: dispatchErrors.length ? 1 : 0,
    result: {
      ok: dispatchErrors.length === 0,
      message: dispatchErrors.length
        ? `updated stale base for PR #${prNumber}, but gate redispatch failed`
        : `updated stale base and reran gates for PR #${prNumber}`,
      decision,
      recovery: {
        oldHead,
        newHead,
        baseHead,
        proofRequested: decision.proofRequested,
        nativeAutomerge,
        dispatches,
        dispatchErrors
      }
    }
  };
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

function closingReferenceMatchesRepo(reference, config) {
  const expected = repoSlug(config).toLowerCase();
  const named =
    reference?.repository?.nameWithOwner ??
    reference?.repository?.name_with_owner ??
    (reference?.repository?.owner?.login && reference?.repository?.name
      ? `${reference.repository.owner.login}/${reference.repository.name}`
      : "");
  if (named) return String(named).toLowerCase() === expected;
  try {
    const url = new URL(String(reference?.url ?? ""));
    return (
      url.origin === "https://github.com" &&
      url.pathname.split("/").filter(Boolean).slice(0, 2).join("/").toLowerCase() === expected
    );
  } catch {
    return false;
  }
}

export function trustedClosingIssueNumbers(closingReferences, config) {
  return [
    ...new Set(
      (closingReferences ?? [])
        .filter((reference) => closingReferenceMatchesRepo(reference, config))
        .map((reference) => Number(reference.number))
        .filter((number) => Number.isInteger(number) && number > 0),
    ),
  ];
}

export function evaluate({ config, pull, pullIssue, sourceIssue, sourceComments, combined, checks, files, closingReferences }) {
  const prLabels = issueLabels(pullIssue);
  const sourceLabels = issueLabels(sourceIssue ?? {});
  const policyBlockers = [];
  const gateBlockers = [];
  let metadata = null;
  let triage = null;
  let trustedPull = false;

  try {
    metadata = implementationMetadata(pull.body);
  } catch (error) {
    policyBlockers.push(error.message);
  }

  try {
    assertTrustedAgentPull(pull, config, { files, rejectPrivilegedPaths: true });
    trustedPull = true;
  } catch (error) {
    policyBlockers.push(error.message);
  }

  const expectedRepo = `${config.repo.owner}/${config.repo.name}`;
  const branchMatch = String(pull.head?.ref ?? "").match(/^agent\/issue-(\d+)-[a-z0-9][a-z0-9-]*$/);
  if (pull.head?.repo?.full_name !== expectedRepo || pull.base?.repo?.full_name !== expectedRepo) {
    policyBlockers.push("PR must use a same-repository branch");
  }
  if (pull.base?.ref !== config.repo.defaultBranch) policyBlockers.push(`PR base must be ${config.repo.defaultBranch}`);
  if (!branchMatch) policyBlockers.push("PR head must match agent/issue-<number>-<slug>");
  if (pull.state !== "open" || pull.merged) policyBlockers.push("PR must be open and unmerged");

  if (metadata) {
    const branchIssue = Number(branchMatch?.[1]);
    if (branchIssue !== metadata.sourceIssue) policyBlockers.push("PR branch does not match implementation source issue");
    if (sourceIssue?.number !== metadata.sourceIssue || sourceIssue?.pull_request) {
      policyBlockers.push("implementation metadata does not match a source issue");
    }
    if (!includesClosingReference(pull.body, metadata.sourceIssue)) {
      policyBlockers.push(`PR does not close source issue #${metadata.sourceIssue}`);
    }
    const referencedIssues = trustedClosingIssueNumbers(closingReferences, config);
    if (referencedIssues.length !== 1 || referencedIssues[0] !== metadata.sourceIssue) {
      policyBlockers.push("PR closing reference does not exactly match implementation source issue");
    }
    if (!metadata.automergeEligible) policyBlockers.push("implementation metadata does not authorize automerge");
    try {
      assertTrustedAgentPull(pull, config, { files, sourceIssue, rejectPrivilegedPaths: true });
    } catch (error) {
      policyBlockers.push(error.message);
    }
  }

  if (!sourceIssue || sourceIssue.state !== "open") policyBlockers.push("source issue must be open");
  try {
    triage = triageDecision(sourceComments, config.comments.triage, config.repo.owner);
  } catch (error) {
    policyBlockers.push(error.message);
  }
  if (triage) {
    if (metadata && triage.issueSnapshotSha256 !== metadata.issueSnapshotSha256) {
      policyBlockers.push("source triage snapshot does not match implementation metadata");
    }
    if (sourceIssue && triage.issueSnapshotSha256 !== issueSnapshotSha256(sourceIssue)) {
      policyBlockers.push("source issue changed after trusted triage");
    }
    if (triage.alignment !== "yes") policyBlockers.push(`source triage alignment is ${triage.alignment}`);
    if (!["low", "medium"].includes(triage.risk)) policyBlockers.push(`source triage risk is ${triage.risk}`);
    if (!["low", "medium"].includes(triage.priority)) policyBlockers.push(`source triage priority is ${triage.priority}`);
    if (triage.automationDecision !== "implement") {
      policyBlockers.push(`source triage automation decision is ${triage.automationDecision}`);
    }
    if (triage.humanQuestion.trim()) policyBlockers.push("source triage has an unresolved human question");
  }

  for (const label of config.automerge.requiredLabels) {
    if (!prLabels.includes(label)) policyBlockers.push(`PR missing label ${label}`);
  }
  if (!sourceLabels.includes(config.labels.automerge)) {
    policyBlockers.push(`source issue missing label ${config.labels.automerge}`);
  }
  for (const label of config.automerge.blockedLabels) {
    if (prLabels.includes(label)) policyBlockers.push(`PR blocked by label ${label}`);
    if (sourceLabels.includes(label)) policyBlockers.push(`source issue blocked by label ${label}`);
  }

  if (combined?.sha !== pull.head?.sha) gateBlockers.push("commit statuses are not for the current PR head");
  for (const context of config.automerge.requiredStatuses) {
    const state = statusState(combined?.statuses ?? [], context, config);
    if (state !== "success") gateBlockers.push(`${context} status ${state}`);
  }

  const proofRequested =
    prLabels.includes(config.labels.proof) ||
    sourceLabels.includes(config.labels.proof) ||
    triage?.proofNeeded === "UI" ||
    triage?.proofNeeded === "GIF";
  if (proofRequested) {
    const state = statusState(combined?.statuses ?? [], config.automerge.proofStatus, config);
    if (state !== "success") gateBlockers.push(`${config.automerge.proofStatus} status ${state}`);
  }
  for (const name of config.automerge.requiredChecks) {
    const state = checkState(checks?.check_runs ?? [], name, pull.head?.sha, config);
    if (state !== "success") gateBlockers.push(`${name} check ${state}`);
  }

  const blockers = [...new Set([...policyBlockers, ...gateBlockers])];
  return {
    allowed: blockers.length === 0,
    staleRecoveryAllowed: trustedPull && policyBlockers.length === 0,
    trustedPull,
    blockers,
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

export function agentWorkflowLabels(config) {
  return [...new Set(Object.values(config.labels ?? {}).filter((label) => String(label).startsWith("agent:")))];
}

export function assertTrustedMergedAgentPull(pull, config, { files, sourceIssue, closingReferences }) {
  const expectedRepo = repoSlug(config).toLowerCase();
  const metadata = implementationMetadata(pull?.body);
  const branchMatch = String(pull?.head?.ref ?? "").match(/^agent\/issue-(\d+)-[a-z0-9]+(?:-[a-z0-9]+)*$/);
  const closingIssues = trustedClosingIssueNumbers(closingReferences, config);
  if (
    pull?.state !== "closed" ||
    !pull?.merged ||
    !pull?.merged_at ||
    String(pull?.head?.repo?.full_name ?? "").toLowerCase() !== expectedRepo ||
    String(pull?.base?.repo?.full_name ?? "").toLowerCase() !== expectedRepo ||
    pull?.base?.ref !== config.repo.defaultBranch ||
    String(pull?.user?.login ?? "").toLowerCase() !== "github-actions[bot]" ||
    String(pull?.merged_by?.login ?? "").toLowerCase() !== "github-actions[bot]" ||
    !/^[a-f0-9]{40}$/.test(String(pull?.head?.sha ?? "")) ||
    !branchMatch ||
    Number(branchMatch[1]) !== metadata.sourceIssue ||
    metadata.automergeEligible !== true ||
    !includesClosingReference(pull.body, metadata.sourceIssue)
  ) {
    throw new AgentError("merged pull request is not a trusted agent PR", 1);
  }
  if (
    !Array.isArray(files) ||
    files.length === 0 ||
    (Number.isInteger(pull.changed_files) && pull.changed_files !== files.length) ||
    privilegedCandidatePaths(files).length
  ) {
    throw new AgentError("merged agent PR has no trusted changed-file inventory", 1);
  }
  if (
    sourceIssue?.pull_request ||
    sourceIssue?.number !== metadata.sourceIssue ||
    issueSnapshotSha256(sourceIssue) !== metadata.issueSnapshotSha256 ||
    closingIssues.length !== 1 ||
    closingIssues[0] !== metadata.sourceIssue
  ) {
    throw new AgentError("merged agent PR source issue does not match its trusted snapshot", 1);
  }
  return metadata;
}

export function removeLabelArgs(number, config, label) {
  return ["issue", "edit", String(number), "--repo", repoSlug(config), "--remove-label", label];
}

export function closeIssueArgs(number, config) {
  return [
    "api",
    `repos/${config.repo.owner}/${config.repo.name}/issues/${number}`,
    "--method",
    "PATCH",
    "-f",
    "state=closed",
    "--silent"
  ];
}

export function closeAgentLoop(
  { config, prNumber, decision, dryRun = false },
  dependencies = {}
) {
  const execute = dependencies.runCommand ?? runCommand;
  const getIssue =
    dependencies.getIssue ??
    ((number) => ghApiJson(`repos/${config.repo.owner}/${config.repo.name}/issues/${number}`));
  const workflowLabels = agentWorkflowLabels(config);
  const sourceIssue = Number(decision.metadata?.sourceIssue);
  if (!Number.isInteger(sourceIssue) || sourceIssue <= 0) {
    return { ok: false, actions: [], errors: ["implementation source issue is invalid"] };
  }

  const fetchCurrent = (number) => {
    let lastError = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        return getIssue(number);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  };
  const pendingActions = (targets) => {
    const pending = [];
    for (const target of targets) {
      const labels = new Set(issueLabels(target));
      for (const label of workflowLabels.filter((item) => labels.has(item))) {
        pending.push({ kind: "remove-label", number: target.number, label });
      }
    }
    const currentSource = targets.find((target) => Number(target.number) === sourceIssue);
    if (currentSource?.state !== "closed") pending.push({ kind: "close-issue", number: sourceIssue });
    return pending;
  };
  const fetchTargets = () => [fetchCurrent(prNumber), fetchCurrent(sourceIssue)];
  const actionKey = (action) => `${action.kind}:${action.number}:${action.label ?? ""}`;
  const initialTargets = dryRun
    ? [
        { number: prNumber, labels: decision.prLabels ?? [], state: "open" },
        { number: sourceIssue, labels: decision.sourceLabels ?? [], state: "open" }
      ]
    : fetchTargets();
  if (dryRun) return { ok: true, dryRun: true, actions: pendingActions(initialTargets), errors: [] };

  const actions = [];
  const recorded = new Set();
  const mutationErrors = new Map();
  for (let pass = 1; pass <= 3; pass += 1) {
    const pending = pendingActions(pass === 1 ? initialTargets : fetchTargets());
    if (pending.length === 0) return { ok: true, actions, errors: [] };

    for (const action of pending) {
      const key = actionKey(action);
      if (!recorded.has(key)) {
        recorded.add(key);
        actions.push(action);
      }
      let lastError = null;
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          const args =
            action.kind === "remove-label"
              ? removeLabelArgs(action.number, config, action.label)
              : closeIssueArgs(action.number, config);
          execute("gh", args);
          lastError = null;
          break;
        } catch (error) {
          lastError = error;
          try {
            const current = fetchCurrent(action.number);
            const complete =
              action.kind === "remove-label"
                ? !issueLabels(current).includes(action.label)
                : current?.state === "closed";
            if (complete) {
              lastError = null;
              break;
            }
          } catch {
            // Keep the mutation error; the next bounded attempt may recover.
          }
        }
      }
      if (lastError) mutationErrors.set(key, lastError);
      else mutationErrors.delete(key);
    }
  }

  const remaining = pendingActions(fetchTargets());
  const errors = remaining.map((action) => {
    const error = mutationErrors.get(actionKey(action));
    return error
      ? `${action.kind} #${action.number}${action.label ? ` ${action.label}` : ""}: ${error?.message ?? String(error)}`
      : `${action.kind} #${action.number}${action.label ? ` ${action.label}` : ""} remained after cleanup reconciliation`;
  });
  return { ok: remaining.length === 0, actions, errors };
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
  { config, prNumber, pull, decision, baseState, dryRun = false },
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

  if (baseState?.stale ?? isStaleBase(pull)) {
    return {
      code: 1,
      result: {
        ok: false,
        message: `automerge requires stale-base recovery for PR #${prNumber}`,
        decision
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
  const cleanup = closeAgentLoop(
    { config, prNumber, decision, dryRun },
    { runCommand: execute, getIssue: dependencies.getIssue }
  );
  if (!cleanup.ok) {
    return {
      code: 1,
      result: {
        ok: false,
        merged: !dryRun,
        message: `${dryRun ? "would merge" : "merged"} PR #${prNumber}, but loop cleanup failed`,
        decision,
        cleanup
      }
    };
  }
  return {
    code: 0,
    result: {
      ok: true,
      message: `${dryRun ? "would merge" : "merged"} PR #${prNumber}`,
      decision,
      cleanup
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
  const expectedHead = String(args["expected-head"] ?? "");
  if (expectedHead && (!/^[a-f0-9]{40}$/.test(expectedHead) || pull?.head?.sha !== expectedHead)) {
    throw new AgentError("automerge target does not match the expected pull request head", 1);
  }
  const files = ghApiJson(
    `repos/${config.repo.owner}/${config.repo.name}/pulls/${prNumber}/files?per_page=100`,
    { paginate: true }
  ) ?? [];
  const closing = ghJson([
    "pr",
    "view",
    String(prNumber),
    "--repo",
    `${config.repo.owner}/${config.repo.name}`,
    "--json",
    "closingIssuesReferences"
  ]);
  const closingReferences = closing?.closingIssuesReferences ?? [];

  if (pull?.merged) {
    const metadata = implementationMetadata(pull.body);
    const sourceIssue = ghApiJson(
      `repos/${config.repo.owner}/${config.repo.name}/issues/${metadata.sourceIssue}`
    );
    assertTrustedMergedAgentPull(pull, config, { files, sourceIssue, closingReferences });
    const cleanup = closeAgentLoop({ config, prNumber, decision: { metadata }, dryRun });
    finish(
      {
        ok: cleanup.ok,
        message: cleanup.ok
          ? `closed agent loop for merged PR #${prNumber}`
          : `merged PR #${prNumber} still has cleanup failures`,
        cleanup
      },
      Boolean(args.json),
      cleanup.ok ? 0 : 1
    );
    return;
  }
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
  const statuses =
    ghApiJson(
      `repos/${config.repo.owner}/${config.repo.name}/commits/${pull.head.sha}/statuses?per_page=100`,
      { paginate: true },
    ) ?? [];
  const combined = { sha: pull.head.sha, statuses };
  const checks = ghApiJson(
    `repos/${config.repo.owner}/${config.repo.name}/commits/${pull.head.sha}/check-runs?per_page=100`,
  );
  const decision = evaluate({
    config,
    pull,
    pullIssue,
    sourceIssue,
    sourceComments,
    combined,
    checks,
    files,
    closingReferences
  });

  const baseState = decision.allowed || decision.staleRecoveryAllowed
    ? resolveBaseState({ config, pull })
    : null;
  const outcome =
    decision.staleRecoveryAllowed && baseState.stale
      ? await recoverStaleBase({ config, prNumber, pull, decision, baseState, dryRun })
      : settleAutomerge({ config, prNumber, pull, decision, baseState, dryRun });
  finish(outcome.result, Boolean(args.json), outcome.code);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => fail(error, Boolean(parseArgs().json)));
}
