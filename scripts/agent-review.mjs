#!/usr/bin/env node
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import {
  AgentError,
  addLabels,
  assertTrustedAgentPull,
  dispatchWorkflow,
  fail,
  finish,
  getIssueComments,
  getPullDiff,
  getPullSnapshot,
  ghApiJson,
  ghReadJson,
  gitOutput,
  implementationCommitMessage,
  issueLabels,
  loadConfig,
  markdownJsonBlock,
  newestManagedComment,
  parseImplementationMetadata,
  parseArgs,
  privilegedCandidatePaths,
  publisherEnvironment,
  readAgentJson,
  readText,
  removeLabels,
  repoRoot,
  runCommand,
  setCommitStatus,
  setGitHubOutput,
  skipsNoMistakesForCost,
  upsertManagedComment
} from "./agent-lib.mjs";
import {
  PROOF_KINDS,
  intentCapsuleForManagedTriage,
  parseImplementationAddendum
} from "./agent-intent.mjs";
import {
  MAX_SEMANTIC_REVISIONS,
  loadRepairLedger,
  openRepairFindings,
  recordRepairEvaluation,
  recordRepairRevision,
  repairEvaluationFor,
  saveRepairLedger,
  semanticInputDigest,
} from "./agent-repair-ledger.mjs";

export const MAX_REVIEW_DIFF_BYTES = 50000;
export const MAX_REVIEW_REPAIR_ATTEMPTS = MAX_SEMANTIC_REVISIONS;
export const REVIEW_WORKFLOW_FAILURE_MARKER = "<!-- agent-review-workflow-failure:v1 -->";

export function reviewReplayNextGate({
  config,
  evaluation,
  metadata,
  pullLabels,
  sourceLabels,
}) {
  if (evaluation?.outcome !== "ready") return "";
  return skipsNoMistakesForCost(config, {
    metadata,
    pullLabels,
    sourceLabels,
  })
    ? "automerge"
    : "no-mistakes";
}

function ciReproductionCommands(pull, ciChecks) {
  const commands = {
    quality: [
      `git diff --check ${pull.base.sha}...${pull.head.sha}`,
      "npm run typecheck",
      "npm run lint",
      "npm run lint:dead",
      "npm run lint:duplicates",
      "node --test scripts/agent-*.test.mjs",
    ],
    build: ["npm run build"],
    scenarios: ["npm run test:scenarios"],
    audit: ["npm audit --omit=dev"],
  };
  return ciChecks
    .filter((check) => check.state !== "success")
    .flatMap((check) => (commands[check.name] ?? []).map((command) => `- ${check.name}: \`${command}\``));
}

function newestCheck(checks) {
  return [...checks].sort((left, right) => {
    const timestamp = (check) =>
      Date.parse(check?.started_at ?? check?.created_at ?? check?.completed_at ?? "") || 0;
    return timestamp(right) - timestamp(left);
  })[0];
}

export function summarizeRequiredChecks(config, headSha, checkRuns) {
  const repo = `${config.repo.owner}/${config.repo.name}`.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const trustedUrl = new RegExp(
    `^https://github\\.com/${repo}/(?:actions/runs/\\d+(?:/job/\\d+)?|runs/\\d+)$`,
    "i"
  );
  return config.automerge.requiredChecks.map((name) => {
    const check = newestCheck(
      (checkRuns ?? []).filter(
        (candidate) =>
          candidate?.name === name &&
          candidate?.head_sha === headSha &&
          candidate?.app?.slug === "github-actions" &&
          trustedUrl.test(String(candidate?.details_url ?? ""))
      )
    );
    return {
      name,
      state: check?.conclusion ?? check?.status ?? "missing",
      detailsUrl: check?.details_url ?? ""
    };
  });
}

function fetchRequiredChecks(config, headSha) {
  const response = ghApiJson(
    `repos/${config.repo.owner}/${config.repo.name}/commits/${headSha}/check-runs?per_page=100`
  );
  return summarizeRequiredChecks(config, headSha, response?.check_runs ?? []);
}

export async function waitForRequiredChecks(config, prNumber, expectedHeadSha, dependencies = {}) {
  const fetchSnapshot = dependencies.fetchSnapshot ?? fetchPull;
  const fetchChecks = dependencies.fetchChecks ?? fetchRequiredChecks;
  const wait = dependencies.wait ?? delay;
  const maxAttempts = dependencies.maxAttempts ?? 120;
  const intervalMs = dependencies.intervalMs ?? 15000;
  let checks = [];
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const { pull } = fetchSnapshot(config, prNumber, dependencies);
    assertReviewedHead(pull, expectedHeadSha);
    checks = fetchChecks(config, expectedHeadSha);
    if (checks.every((check) => !["missing", "queued", "in_progress", "pending", "requested", "waiting"].includes(check.state))) {
      return { complete: true, attempts: attempt, checks };
    }
    if (attempt < maxAttempts) await wait(intervalMs);
  }
  throw new AgentError("required exact-head CI did not reach a terminal state", 1, {
    attempts: maxAttempts,
    checks,
  });
}

function fetchPull(config, prNumber, dependencies = {}) {
  const { pull, files } = getPullSnapshot(config, prNumber);
  const trust = assertTrustedAgentPull(pull, config, {
    files,
    rejectPrivilegedPaths: true,
    allowEmptyFiles: true
  }, dependencies);
  const issue = ghApiJson(`repos/${config.repo.owner}/${config.repo.name}/issues/${prNumber}`);
  const comments = getIssueComments(config, prNumber);
  return { pull, issue, comments, files, trust };
}

export function implementationMetadata(body) {
  return parseImplementationMetadata(body);
}

function referenceMatchesRepo(reference, config) {
  const expected = `${config.repo.owner}/${config.repo.name}`.toLowerCase();
  const referencedRepo =
    reference?.repository?.nameWithOwner ??
    reference?.repository?.name_with_owner ??
    reference?.repository?.fullName ??
    reference?.repository?.full_name;
  if (referencedRepo && String(referencedRepo).toLowerCase() !== expected) return false;
  if (reference?.url) {
    try {
      const url = new URL(reference.url);
      const pathRepo = url.pathname.split("/").filter(Boolean).slice(0, 2).join("/").toLowerCase();
      if (pathRepo && pathRepo !== expected) return false;
    } catch {
      return false;
    }
  }
  return true;
}

export function resolveSourceIssueNumber(pull, closingReferences, config) {
  const metadataIssue = Number(implementationMetadata(pull.body).sourceIssue);
  const candidates = [
    ...new Set(
      (closingReferences ?? [])
        .filter((reference) => referenceMatchesRepo(reference, config))
        .map((reference) => Number(reference.number))
        .filter((number) => Number.isInteger(number) && number > 0)
    )
  ];
  if (candidates.length !== 1 || candidates[0] !== metadataIssue) {
    throw new AgentError("agent review closing reference must exactly match implementation metadata", 1, {
      metadataIssue,
      issues: candidates
    });
  }
  return metadataIssue;
}

export function assertReviewDiffFits(diff) {
  const bytes = Buffer.byteLength(diff, "utf8");
  if (bytes > MAX_REVIEW_DIFF_BYTES) {
    throw new AgentError(`PR diff is too large for complete automated review (${bytes} bytes)`, 1, {
      bytes,
      limit: MAX_REVIEW_DIFF_BYTES
    });
  }
  return bytes;
}

export function buildReviewPrompt({
  template,
  pull,
  pullIssue,
  intentCapsule,
  implementationAddendum,
  repairLedger,
  ciChecks = [],
  diff
}) {
  assertReviewDiffFits(diff);
  return `${template}

## Pull Request

Number: ${pull.number}
Title: ${pull.title}
Labels: ${issueLabels(pullIssue).join(", ") || "none"}
Head: ${pull.head.ref} ${pull.head.sha}
Base: ${pull.base.ref}

## Sealed Intent Capsule

\`\`\`json
${JSON.stringify(intentCapsule, null, 2)}
\`\`\`

## Implementation Intent Addendum

\`\`\`json
${JSON.stringify(implementationAddendum, null, 2)}
\`\`\`

## Shared Repair Ledger

\`\`\`json
${JSON.stringify(repairLedger, null, 2)}
\`\`\`

## Exact-Head CI

${ciChecks.map((check) => `- ${check.name}: ${check.state}${check.detailsUrl ? ` (${check.detailsUrl})` : ""}`).join("\n") || "- unavailable"}

## Failed CI Reproduction

${ciReproductionCommands(pull, ciChecks).join("\n") || "- none"}

## Diff

\`\`\`diff
${diff}
\`\`\`
`;
}

export function requireManagedTriageComment(comments, marker, sourceIssueNumber, repoOwner) {
  const triageComment = newestManagedComment(comments, marker, repoOwner);
  if (!triageComment) throw new AgentError(`source issue #${sourceIssueNumber} has no managed triage context`, 1);
  return triageComment;
}

function fetchTrustedReviewContext(
  config,
  prNumber,
  expectedHeadSha,
  dependencies = {}
) {
  const { pull, issue, comments, files } = fetchPull(config, prNumber, dependencies);
  assertReviewedHead(pull, expectedHeadSha);
  const closing = ghReadJson([
    "pr",
    "view",
    String(prNumber),
    "--repo",
    `${config.repo.owner}/${config.repo.name}`,
    "--json",
    "closingIssuesReferences"
  ]);
  const sourceIssueNumber = resolveSourceIssueNumber(pull, closing?.closingIssuesReferences, config);
  const sourceIssue = ghApiJson(`repos/${config.repo.owner}/${config.repo.name}/issues/${sourceIssueNumber}`);
  assertTrustedAgentPull(pull, config, {
    files,
    sourceIssue,
    rejectPrivilegedPaths: true,
    allowEmptyFiles: true
  }, dependencies);
  return {
    pull,
    issue,
    comments,
    files,
    sourceIssueNumber,
    sourceIssue
  };
}

function writePrompt(config, prNumber, outputPath, expectedHeadSha, dependencies = {}) {
  const {
    pull,
    issue,
    comments,
    sourceIssueNumber,
    sourceIssue
  } = fetchTrustedReviewContext(
    config,
    prNumber,
    expectedHeadSha,
    dependencies
  );
  const sourceComments = getIssueComments(config, sourceIssueNumber);
  const triageComment = requireManagedTriageComment(
    sourceComments,
    config.comments.triage,
    sourceIssueNumber,
    config.repo.owner
  );
  const { capsule } = intentCapsuleForManagedTriage({
    issue: sourceIssue,
    comments: sourceComments,
    triageComment,
    marker: config.comments.triage,
    repoOwner: config.repo.owner
  });
  const metadata = implementationMetadata(pull.body);
  const implementationAddendum = parseImplementationAddendum(pull.body);
  if (
    metadata.intentDigest !== capsule.intentDigest ||
    metadata.implementationAddendumDigest !== implementationAddendum.digest
  ) {
    throw new AgentError(
      "review intent context does not match immutable implementation metadata",
      1
    );
  }
  const diff = getPullDiff(config, pull);
  const ciChecks = fetchRequiredChecks(config, pull.head.sha);
  const repairLedger = loadRepairLedger(
    comments,
    capsule.intentDigest,
    config.repo.owner,
  );
  const inputDigest = semanticInputDigest({
    lane: "review",
    head: pull.head.sha,
    intentDigest: capsule.intentDigest,
    findings: openRepairFindings(repairLedger).filter(
      (finding) => finding.lane !== "review",
    ),
    checks: ciChecks,
  });
  const replayEvaluation = repairEvaluationFor(repairLedger, {
    lane: "review",
    head: pull.head.sha,
    inputDigest,
  });
  const skipModel = Boolean(replayEvaluation);
  const replayNextGate = reviewReplayNextGate({
    config,
    evaluation: replayEvaluation,
    metadata,
    pullLabels: issueLabels(issue),
    sourceLabels: issueLabels(sourceIssue),
  });
  const prompt = buildReviewPrompt({
    template: readText(join(repoRoot(), ".agent/prompts/review.md")),
    pull,
    pullIssue: issue,
    intentCapsule: capsule,
    implementationAddendum,
    repairLedger,
    ciChecks,
    diff
  });
  mkdirSync(join(repoRoot(), ".agent-output"), { recursive: true });
  writeFileSync(outputPath, prompt);
  setGitHubOutput({
    "skip-model": skipModel,
    "replay-next-gate": replayNextGate,
    "semantic-input-digest": inputDigest,
    "shared-revision-count": repairLedger.revisionCount,
  });
  return {
    prNumber,
    sourceIssueNumber,
    diffBytes: Buffer.byteLength(diff, "utf8"),
    outputPath,
    inputDigest,
    skipModel,
    replayNextGate,
    sharedRevisionCount: repairLedger.revisionCount,
  };
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
  return { outputPath, bytes: Buffer.byteLength(diff), hasPatch: Boolean(diff.trim()) };
}

export function blankLineAtEofPaths(output) {
  return [
    ...new Set(
      String(output ?? "")
        .split("\n")
        .map((line) => line.match(/^(.+?):\d+: new blank line at EOF\.$/)?.[1])
        .filter(Boolean)
    )
  ];
}

export function normalizeTrailingBlankLines(text) {
  const trailingNewlines = String(text).match(/(?:(?:\r\n)|\n)+$/)?.[0] ?? "";
  if (!trailingNewlines || !/(?:(?:\r\n)|\n){2,}/.test(trailingNewlines)) return String(text);
  const newline = trailingNewlines.includes("\r\n") ? "\r\n" : "\n";
  return String(text).slice(0, -trailingNewlines.length) + newline;
}

function safeWhitespaceRepairPath(candidate) {
  const path = String(candidate ?? "");
  if (
    !path ||
    isAbsolute(path) ||
    path.includes("\\") ||
    path.split("/").includes("..") ||
    path === ".git" ||
    path.startsWith(".git/") ||
    privilegedPatchPaths([path]).length
  ) {
    throw new AgentError("deterministic whitespace repair rejected an unsafe path", 1, { path });
  }
  const root = repoRoot();
  const absolute = resolve(root, path);
  const fromRoot = relative(root, absolute);
  if (!fromRoot || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new AgentError("deterministic whitespace repair escaped the repository", 1, { path });
  }
  if (!lstatSync(absolute).isFile()) {
    throw new AgentError("deterministic whitespace repair requires a regular file", 1, { path });
  }
  return absolute;
}

export function repairWhitespaceFailures(baseSha, expectedHeadSha) {
  const base = String(baseSha ?? "").trim();
  const expected = String(expectedHeadSha ?? "").trim();
  if (!/^[0-9a-f]{40}$/.test(base)) throw new AgentError("invalid review base SHA", 2);
  if (!/^[0-9a-f]{40}$/.test(expected)) throw new AgentError("invalid reviewed head SHA", 2);
  const actual = gitOutput(["rev-parse", "HEAD"]);
  if (actual !== expected) {
    throw new AgentError("review checkout does not match the prepared head", 1, {
      expectedHeadSha: expected,
      currentHeadSha: actual
    });
  }
  const mergeBase = gitOutput(["merge-base", base, expected]);
  const before = runCommand("git", ["diff", "--no-ext-diff", "--check", mergeBase, "--", "."], {
    check: false
  });
  const paths = blankLineAtEofPaths(`${before.stdout}\n${before.stderr}`);
  const fixed = [];
  for (const path of paths) {
    const absolute = safeWhitespaceRepairPath(path);
    const bytes = readFileSync(absolute);
    if (bytes.includes(0)) {
      throw new AgentError("deterministic whitespace repair rejected a binary file", 1, { path });
    }
    const text = bytes.toString("utf8");
    if (!Buffer.from(text, "utf8").equals(bytes)) {
      throw new AgentError("deterministic whitespace repair requires UTF-8 text", 1, { path });
    }
    const normalized = normalizeTrailingBlankLines(text);
    if (normalized !== text) {
      writeFileSync(absolute, normalized);
      fixed.push(path);
    }
  }
  const after = runCommand("git", ["diff", "--no-ext-diff", "--check", mergeBase, "--", "."], {
    check: false
  });
  const unresolved = blankLineAtEofPaths(`${after.stdout}\n${after.stderr}`);
  if (unresolved.length) {
    throw new AgentError("deterministic blank-line repair did not converge", 1, { paths: unresolved });
  }
  return { mergeBase, detected: paths, fixed };
}

function checkoutPullHead(pull) {
  runCommand("gh", ["auth", "setup-git", "--hostname", "github.com"]);
  runCommand("git", ["fetch", "origin", pull.head.sha]);
  runCommand("git", ["switch", "-C", pull.head.ref, "FETCH_HEAD"]);
}

export function privilegedPatchPaths(paths) {
  return privilegedCandidatePaths(paths);
}

export function assertReviewedHead(pull, expectedHeadSha) {
  const expected = String(expectedHeadSha ?? "").trim();
  const current = String(pull?.head?.sha ?? "").trim();
  if (!expected) throw new AgentError("missing reviewed head SHA", 2);
  if (current !== expected) {
    throw new AgentError("PR head changed after agent review generation", 1, {
      expectedHeadSha: expected,
      currentHeadSha: current || null
    });
  }
  return current;
}

export function dispatchPullSecurity(
  config,
  prNumber,
  expectedHeadSha,
  dependencies = {},
) {
  const fetchSnapshot = dependencies.fetchSnapshot ?? fetchPull;
  const fetchSourceIssue =
    dependencies.fetchSourceIssue ??
    ((number) =>
      ghApiJson(
        `repos/${config.repo.owner}/${config.repo.name}/issues/${number}`,
      ));
  const dispatch = dependencies.dispatchWorkflow ?? dispatchWorkflow;
  const snapshot = fetchSnapshot(config, prNumber, dependencies);
  assertReviewedHead(snapshot.pull, expectedHeadSha);
  const sourceIssue = fetchSourceIssue(snapshot.trust.sourceIssue);
  assertTrustedAgentPull(snapshot.pull, config, {
    files: snapshot.files,
    sourceIssue,
    rejectPrivilegedPaths: true,
    allowEmptyFiles: true,
  }, dependencies);
  const getWorkflowRuns =
    dependencies.getWorkflowRuns ??
    (() => {
      const response = ghApiJson(
        `repos/${config.repo.owner}/${config.repo.name}/actions/workflows/codeql.yml/runs?event=workflow_dispatch&branch=${encodeURIComponent(config.repo.defaultBranch)}&per_page=100`,
      );
      return response?.workflow_runs ?? [];
    });
  const existing = getWorkflowRuns().find(
    (run) =>
      run?.event === "workflow_dispatch" &&
      run?.display_title === `CodeQL ${expectedHeadSha}` &&
      (run?.status !== "completed" || run?.conclusion === "success"),
  );
  if (existing) {
    return {
      ok: true,
      skipped: true,
      reason: "exact security run already active or successful",
      runId: existing.id ?? null,
    };
  }
  return dispatch(
    config,
    "codeql.yml",
    {
      "candidate-ref": `refs/heads/${snapshot.pull.head.ref}`,
      "candidate-sha": expectedHeadSha,
    },
    false,
    config.repo.defaultBranch,
  );
}

export function classifyReviewWorkflowFailure(text) {
  const evidence = String(text ?? "");
  if (
    /quota exceeded(?:\. check your plan and billing details)?|insufficient_quota|billing_hard_limit_reached/i.test(
      evidence,
    )
  ) {
    return {
      kind: "model-quota",
      summary: "The OpenAI API project quota is exhausted.",
      requiredAction:
        "Increase or restore the OpenAI API project quota, then rerun the failed Agent Review workflow on this unchanged head.",
    };
  }
  if (/invalid api key|incorrect api key|authentication failed|status(?: code)?:? 401/i.test(evidence)) {
    return {
      kind: "model-auth",
      summary: "The configured model credential was rejected.",
      requiredAction:
        "Replace the OPENAI_API_KEY repository secret with a valid project key, then rerun the failed Agent Review workflow on this unchanged head.",
    };
  }
  if (/rate limit|too many requests|status(?: code)?:? 429/i.test(evidence)) {
    return {
      kind: "model-capacity",
      summary: "The model provider rejected the review because capacity was temporarily unavailable.",
      requiredAction:
        "Wait for provider capacity, then rerun the failed Agent Review workflow on this unchanged head.",
    };
  }
  return {
    kind: "review-infrastructure",
    summary: "The Agent Review workflow failed before it could publish a trusted result.",
    requiredAction:
      "Inspect the linked Actions run, correct the provider or workflow failure, then rerun Agent Review on this unchanged head.",
  };
}

export function classifyReviewWorkflowFailurePath(path) {
  const root = String(path ?? "").trim();
  if (!root || !existsSync(root)) return classifyReviewWorkflowFailure("");
  const pending = [resolve(root)];
  const parts = [];
  let bytes = 0;
  while (pending.length && parts.length < 12 && bytes < 1_000_000) {
    const current = pending.shift();
    const info = lstatSync(current);
    if (info.isSymbolicLink()) continue;
    if (info.isDirectory()) {
      for (const name of readdirSync(current).sort()) pending.push(join(current, name));
      continue;
    }
    if (!info.isFile() || !/\.(?:json|log|txt)$/i.test(current)) continue;
    const text = readFileSync(current, "utf8");
    const bounded = text.slice(-Math.min(text.length, 250_000));
    parts.push(bounded);
    bytes += Buffer.byteLength(bounded);
  }
  return classifyReviewWorkflowFailure(parts.join("\n"));
}

export function reviewFailureOwnedBlockedLabel(comments, config) {
  const prior = newestManagedComment(comments, config.comments.review, config.repo.owner);
  return Boolean(
    prior?.body?.includes(REVIEW_WORKFLOW_FAILURE_MARKER) &&
      /"ownsBlockedLabel"\s*:\s*true/.test(prior.body),
  );
}

export function markReviewWorkflowFailure(
  config,
  prNumber,
  expectedHeadSha,
  failure,
  dryRun = false,
  dependencies = {},
) {
  const api = dependencies.ghApiJson ?? ghApiJson;
  const snapshot =
    dependencies.fetchSnapshot?.(config, prNumber, dependencies) ??
    getPullSnapshot(config, prNumber, dependencies);
  assertReviewedHead(snapshot.pull, expectedHeadSha);
  const metadata = implementationMetadata(snapshot.pull.body);
  const sourceIssue =
    dependencies.fetchSourceIssue?.(metadata.sourceIssue) ??
    api(`repos/${config.repo.owner}/${config.repo.name}/issues/${metadata.sourceIssue}`);
  assertTrustedAgentPull(
    snapshot.pull,
    config,
    {
      files: snapshot.files,
      sourceIssue,
      rejectPrivilegedPaths: true,
      allowEmptyFiles: true,
    },
    { ...dependencies, ghApiJson: api },
  );
  const pullIssue =
    dependencies.fetchPullIssue?.(prNumber) ??
    api(`repos/${config.repo.owner}/${config.repo.name}/issues/${prNumber}`);
  const comments =
    dependencies.fetchComments?.(prNumber) ??
    getIssueComments(config, prNumber);
  const ownsBlockedLabel =
    reviewFailureOwnedBlockedLabel(comments, config) ||
    !issueLabels(pullIssue).includes(config.labels.blocked);
  const actionsRun =
    process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
      ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
      : "";
  const blocker = failure ?? classifyReviewWorkflowFailure("");
  const comment = upsertManagedComment({
    config,
    number: prNumber,
    marker: config.comments.review,
    body: `${REVIEW_WORKFLOW_FAILURE_MARKER}
## Agent Review

Review blocked by an automation failure.

${blocker.summary}

Required action: ${blocker.requiredAction}

Structured blocker:
${markdownJsonBlock({
  failureKind: blocker.kind,
  headSha: expectedHeadSha,
  actionsRun,
  requiredAction: blocker.requiredAction,
  ownsBlockedLabel,
})}`,
    dryRun,
  });
  const labels = {
    added: addLabels(config, prNumber, [config.labels.blocked], dryRun),
    removed: removeLabels(config, prNumber, [config.labels.automerge], dryRun),
  };
  const status = setCommitStatus({
    config,
    sha: expectedHeadSha,
    state: "failure",
    context: "agent-review",
    description: blocker.summary,
    targetUrl: actionsRun,
    dryRun,
  });
  return { blocker, comment, labels, status, ownsBlockedLabel };
}

export function validateReviewRemoteRecord(config, path) {
  const record = readAgentJson(path);
  const providers = new Set(config.crabbox?.nonVisualProviders ?? []);
  if (
    record?.ok !== true ||
    record?.attempted !== true ||
    record?.lane !== "reviewRemote" ||
    !providers.has(record?.provider) ||
    !/^[A-Za-z0-9._:-]+$/.test(String(record?.leaseId ?? "")) ||
    record?.timing?.provider !== record.provider ||
    record?.timing?.leaseId !== record.leaseId ||
    record?.timing?.exitCode !== 0 ||
    !Number.isFinite(record?.timing?.totalMs) ||
    record.timing.totalMs < 0 ||
    String(record?.reason ?? "")
  ) {
    throw new AgentError("Crabbox review provenance is invalid", 1);
  }
  return {
    provider: record.provider,
    leaseId: record.leaseId,
    totalMs: record.timing.totalMs,
  };
}

function reviewBody(review, cycle, remote) {
  return `## Agent Review

Findings:

${review.bugsFound.length ? review.bugsFound.map((item) => `- ${item}`).join("\n") : "- none"}

Fixes made:

${review.fixesMade.length ? review.fixesMade.map((item) => `- ${item}`).join("\n") : "- none"}

Checks run:

${review.checksRun.length ? review.checksRun.map((item) => `- ${item}`).join("\n") : "- none"}

Remaining risk: ${review.remainingRisk}
Proof needed: ${review.proofNeeded}
Recommendation: ${review.mergeRecommendation}
Cycle: ${cycle.state}${cycle.state === "retry" ? ` ${cycle.nextAttempt}/${MAX_REVIEW_REPAIR_ATTEMPTS}` : ""}
Crabbox provider: ${remote.provider}
Crabbox lease: ${remote.leaseId}
Crabbox duration: ${remote.totalMs} ms

${review.humanQuestion ? `Human question:\n\n${review.humanQuestion}\n` : ""}

Structured review:
${markdownJsonBlock(review)}`;
}

export function normalizeReviewPolicy(review) {
  validateReviewResult(review);
  if (
    review.mergeRecommendation === "ready-human-review" &&
    review.remainingRisk !== "high" &&
    review.bugsFound.length === 0 &&
    !review.humanQuestion.trim()
  ) {
    return {
      ...review,
      mergeRecommendation: "ready"
    };
  }
  if (
    review.mergeRecommendation !== "ready" ||
    (review.remainingRisk !== "high" && !review.humanQuestion.trim())
  ) {
    return review;
  }
  return {
    ...review,
    mergeRecommendation: "ready-human-review",
    humanQuestion: review.humanQuestion || "High-risk work requires human review before merge."
  };
}

export function validateReviewResult(review) {
  const expectedKeys = [
    "bugsFound",
    "checksRun",
    "fixesMade",
    "humanQuestion",
    "mergeRecommendation",
    "proofNeeded",
    "remainingRisk",
    "unifiedDiff"
  ];
  const stringArrays = ["bugsFound", "fixesMade", "checksRun"];
  if (
    !review ||
    Array.isArray(review) ||
    JSON.stringify(Object.keys(review).sort()) !== JSON.stringify(expectedKeys) ||
    !stringArrays.every((key) => Array.isArray(review[key]) && review[key].every((item) => typeof item === "string")) ||
    !["low", "medium", "high"].includes(review.remainingRisk) ||
    !PROOF_KINDS.includes(review.proofNeeded) ||
    !["ready", "ready-human-review", "blocked"].includes(review.mergeRecommendation) ||
    typeof review.humanQuestion !== "string" ||
    typeof review.unifiedDiff !== "string"
  ) {
    throw new AgentError("agent review result is invalid", 1);
  }
  return review;
}

export function reviewPolicyOutcome(review) {
  const hardBlocked = review.mergeRecommendation === "blocked";
  const requiresHumanReview = review.mergeRecommendation === "ready-human-review" || review.remainingRisk === "high";
  const manualBlock = hardBlocked || requiresHumanReview;
  return {
    hardBlocked,
    requiresHumanReview,
    manualBlock,
    technicalSuccess: !hardBlocked,
    statusState: manualBlock ? "failure" : "success",
    statusDescription: hardBlocked
      ? "agent review blocked"
      : requiresHumanReview
        ? "agent review needs human review"
        : "agent review passed"
  };
}

export function reviewLabelChanges(config, review) {
  const policy = reviewPolicyOutcome(review);
  const add = [];
  const remove = [];
  if (["UI", "GIF", "service"].includes(review.proofNeeded)) {
    add.push(config.labels.proof);
  }
  if (policy.manualBlock) {
    add.push(config.labels.blocked);
    remove.push(config.labels.automerge);
  }
  return {
    ...policy,
    add: [...new Set(add)],
    remove: [...new Set(remove)]
  };
}

function repairAttempt(value) {
  const attempt = Number(value ?? 0);
  if (!Number.isInteger(attempt) || attempt < 0 || attempt > MAX_REVIEW_REPAIR_ATTEMPTS) {
    throw new AgentError("review repair attempt is invalid", 2);
  }
  return attempt;
}

export function reviewCycleDecision(
  review,
  {
    repairAttempt: attemptValue = 0,
    patchApplied = false,
    patchRejectedByBudget = false,
    ciPassed = true,
  } = {}
) {
  const attempt = repairAttempt(attemptValue);
  const humanBlocked =
    review.mergeRecommendation === "ready-human-review" ||
    review.remainingRisk === "high" ||
    Boolean(review.humanQuestion.trim());
  if (humanBlocked) {
    return {
      state: "human-blocked",
      nextAttempt: null,
      continueToNoMistakes: false,
      statusState: "failure",
      statusDescription: "agent review needs human review"
    };
  }
  if (patchApplied) {
    return {
      state: "retry",
      nextAttempt: attempt,
      continueToNoMistakes: false,
      statusState: "pending",
      statusDescription: `agent review validating revision (${attempt}/${MAX_REVIEW_REPAIR_ATTEMPTS})`
    };
  }
  if (patchRejectedByBudget) {
    return {
      state: "repair-exhausted",
      nextAttempt: null,
      continueToNoMistakes: false,
      statusState: "failure",
      statusDescription: "agent review repair limit exhausted"
    };
  }
  if (!ciPassed) {
    return {
      state: "deterministic-blocked",
      nextAttempt: null,
      continueToNoMistakes: false,
      statusState: "failure",
      statusDescription: "agent review blocked by exact-head CI"
    };
  }
  if (review.mergeRecommendation === "blocked") {
    return {
      state: "unchanged-blocked",
      nextAttempt: null,
      continueToNoMistakes: false,
      statusState: "failure",
      statusDescription: "agent review blocked without a material repair"
    };
  }
  return {
    state: "ready",
    nextAttempt: null,
    continueToNoMistakes: true,
    statusState: "success",
    statusDescription: "agent review passed"
  };
}

export function reviewCycleLabelChanges(
  config,
  review,
  cycle,
  { automergeEligible = false } = {}
) {
  const add = [];
  const remove = [];
  if (cycle.state === "ready" && ["UI", "GIF", "service"].includes(review.proofNeeded)) {
    add.push(config.labels.proof);
  }
  if (cycle.state === "ready" || cycle.state === "retry") {
    if (automergeEligible) add.push(config.labels.automerge);
  } else {
    add.push(config.labels.blocked);
    remove.push(config.labels.automerge);
  }
  return { add: [...new Set(add)], remove: [...new Set(remove)] };
}

function applyReview(
  config,
  prNumber,
  reviewPath,
  patchPath,
  remoteRecordPath,
  dryRun,
  expectedHeadSha,
  repairAttemptValue = 0,
  dependencies = {},
) {
  const {
    pull,
    issue,
    comments,
    sourceIssue
  } = fetchTrustedReviewContext(
    config,
    prNumber,
    expectedHeadSha,
    dependencies
  );
  const metadata = implementationMetadata(pull.body);
  const sourceLabels = issueLabels(sourceIssue);
  const automergeEligible =
    metadata.automergeEligible === true &&
    sourceLabels.includes(config.labels.automerge);
  const skipNoMistakes = skipsNoMistakesForCost(config, {
    metadata,
    pullLabels: issueLabels(issue),
    sourceLabels
  });
  const ciChecks = fetchRequiredChecks(config, pull.head.sha);
  const ciPassed = ciChecks.every((check) => check.state === "success");
  let repairLedger = loadRepairLedger(
    comments,
    metadata.intentDigest,
    config.repo.owner,
  );
  repairAttempt(repairAttemptValue);
  const priorOpenFindings = openRepairFindings(repairLedger).filter(
    (finding) => finding.lane !== "review",
  );
  const inputDigest = semanticInputDigest({
    lane: "review",
    head: pull.head.sha,
    intentDigest: metadata.intentDigest,
    findings: priorOpenFindings,
    checks: ciChecks,
  });
  let review = readAgentJson(reviewPath);
  validateReviewResult(review);
  const remote = validateReviewRemoteRecord(config, remoteRecordPath);
  let effectivePatchPath = patchPath;
  let patchText = patchPath && existsSync(patchPath) ? readText(patchPath) : "";
  if (!patchText.trim() && typeof review.unifiedDiff === "string" && review.unifiedDiff.trim()) {
    const outputDir = join(repoRoot(), ".agent-output");
    mkdirSync(outputDir, { recursive: true });
    effectivePatchPath = join(outputDir, "review-inline.patch");
    patchText = review.unifiedDiff;
    writeFileSync(effectivePatchPath, patchText);
  }
  const hasPatch = patchText.trim();
  let statusSha = pull.head.sha;
  let privilegedPaths = [];
  let ciDispatch = null;
  let codeqlDispatch = null;
  let patchApplied = false;
  let patchRejectedByBudget = false;

  if (hasPatch && repairLedger.revisionCount >= MAX_SEMANTIC_REVISIONS) {
    patchRejectedByBudget = true;
    review.bugsFound.push("The shared semantic repair budget is exhausted.");
    review.mergeRecommendation = "blocked";
  } else if (!dryRun && hasPatch) {
    checkoutPullHead(pull);
    runCommand("git", ["apply", "--index", effectivePatchPath]);
    const staged = runCommand("git", ["diff", "--cached", "--no-renames", "--name-only"]).stdout.trim();
    if (staged) {
      privilegedPaths = privilegedPatchPaths(staged.split("\n").filter(Boolean));
      if (privilegedPaths.length) {
        review.bugsFound.push(`Review patch touched privileged paths: ${privilegedPaths.join(", ")}`);
        review.remainingRisk = "high";
        review.mergeRecommendation = "ready-human-review";
        review.humanQuestion = review.humanQuestion || "Review patch touches privileged automation/runtime paths. Approve or rewrite manually?";
      } else {
        runCommand("git", ["config", "user.name", "github-actions[bot]"]);
        runCommand("git", ["config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com"]);
        runCommand("git", [
          "commit",
          "-m",
          implementationCommitMessage(`fix: address agent review for #${prNumber}`, metadata),
        ]);
        statusSha = gitOutput(["rev-parse", "HEAD"]);
        const publishEnv = publisherEnvironment();
        runCommand("gh", ["auth", "setup-git", "--hostname", "github.com"], {
          env: publishEnv
        });
        runCommand("git", ["push", "origin", `HEAD:${pull.head.ref}`], {
          env: publishEnv
        });
        patchApplied = true;
        ciDispatch = dispatchWorkflow(
          config,
          "ci.yml",
          { "pr-number": prNumber, "expected-head-sha": statusSha },
          false,
          config.repo.defaultBranch
        );
        codeqlDispatch = dispatchWorkflow(
          config,
          "codeql.yml",
          {
            "candidate-ref": `refs/heads/${pull.head.ref}`,
            "candidate-sha": statusSha,
          },
          false,
          config.repo.defaultBranch,
        );
      }
    }
  }

  review = normalizeReviewPolicy(review);
  if (
    !patchApplied &&
    !ciPassed &&
    review.mergeRecommendation === "ready" &&
    !review.humanQuestion.trim()
  ) {
    const failures = ciChecks
      .filter((check) => check.state !== "success")
      .map((check) => `${check.name}=${check.state}`)
      .join(", ");
    review.bugsFound.push(`Required exact-head CI is not passing: ${failures}`);
    review.mergeRecommendation = "blocked";
  }
  const evaluation = recordRepairEvaluation(repairLedger, {
    lane: "review",
    head: pull.head.sha,
    inputDigest,
    findings: review.mergeRecommendation === "blocked" ? review.bugsFound : [],
    outcome: review.mergeRecommendation,
  });
  repairLedger = evaluation.ledger;
  if (patchApplied) {
    repairLedger = recordRepairRevision(repairLedger, {
      lane: "review",
      fromHead: pull.head.sha,
      toHead: statusSha,
      findingDigest: evaluation.findingDigest,
    }).ledger;
  }
  const cycle = reviewCycleDecision(review, {
    repairAttempt: repairLedger.revisionCount,
    patchApplied,
    patchRejectedByBudget,
    ciPassed: patchApplied ? false : ciPassed
  });
  const policy = reviewCycleLabelChanges(config, review, cycle, { automergeEligible });
  if (
    ["ready", "retry"].includes(cycle.state) &&
    reviewFailureOwnedBlockedLabel(comments, config)
  ) {
    policy.remove = [...new Set([...policy.remove, config.labels.blocked])];
  }

  const comment = upsertManagedComment({
    config,
    number: prNumber,
    marker: config.comments.review,
    body: reviewBody(review, cycle, remote),
    dryRun
  });
  const labels = {
    added: addLabels(config, prNumber, policy.add, dryRun),
    removed: removeLabels(config, prNumber, policy.remove, dryRun)
  };
  const proofRequested =
    issueLabels(issue).includes(config.labels.proof) ||
    sourceLabels.includes(config.labels.proof) ||
    review.proofNeeded === "UI" ||
    review.proofNeeded === "GIF" ||
    review.proofNeeded === "service";
  const proofDispatch =
    cycle.state === "ready" && proofRequested && !dryRun
      ? dispatchWorkflow(
          config,
          "agent-proof.yml",
          { "target-kind": "pr", "target-number": prNumber, "expected-head-sha": statusSha },
          false,
          config.repo.defaultBranch
        )
      : null;
  const status = setCommitStatus({
    config,
    sha: statusSha,
    state: cycle.statusState,
    context: "agent-review",
    description: cycle.statusDescription,
    dryRun
  });
  const repairDispatch =
    cycle.state === "retry" && !dryRun
      ? dispatchWorkflow(
          config,
          "agent-review.yml",
          {
            "pr-number": prNumber,
            "expected-head-sha": statusSha,
            "repair-attempt": cycle.nextAttempt
          },
          false,
          config.repo.defaultBranch
        )
      : null;
  const ledgerComment = saveRepairLedger({
    config,
    prNumber,
    ledger: repairLedger,
    dryRun,
  });
  return {
    review,
    cycle,
    ciChecks,
    comment,
    ledgerComment,
    repairLedger,
    remote,
    labels,
    dispatch: {
      ci: ciDispatch,
      codeql: codeqlDispatch,
      proof: proofDispatch,
      repair: repairDispatch
    },
    status,
    patchApplied,
    privilegedPaths,
    skipNoMistakes,
    continueToNoMistakes: cycle.continueToNoMistakes,
    manualBlock: cycle.state === "human-blocked" || cycle.state === "repair-exhausted"
  };
}

async function main() {
  const args = parseArgs();
  const config = loadConfig();
  const prNumber = Number(args["pr-number"]);
  if (!Number.isInteger(prNumber)) throw new AgentError("missing --pr-number", 2);
  const dryRun = Boolean(args["dry-run"]);

  if (args["write-prompt"]) {
    finish(
      {
        ok: true,
        message: `wrote review prompt for #${prNumber}`,
        ...writePrompt(config, prNumber, args["write-prompt"], args["expected-head-sha"], { ghApiJson })
      },
      Boolean(args.json)
    );
    return;
  }
  if (args["wait-for-ci"]) {
    finish(
      {
        ok: true,
        message: `waited for exact-head CI for #${prNumber}`,
        result: await waitForRequiredChecks(
          config,
          prNumber,
          args["expected-head-sha"],
          { ghApiJson },
        )
      },
      Boolean(args.json)
    );
    return;
  }
  if (args["create-patch"]) {
    finish({ ok: true, message: `created review patch for #${prNumber}`, ...createPatch(args["create-patch"]) }, Boolean(args.json));
    return;
  }
  if (args["repair-whitespace"]) {
    finish(
      {
        ok: true,
        message: `repaired deterministic whitespace failures for #${prNumber}`,
        result: repairWhitespaceFailures(args["base-sha"], args["expected-head-sha"])
      },
      Boolean(args.json)
    );
    return;
  }
  if (args["dispatch-pr-security"]) {
    finish(
      {
        ok: true,
        message: `dispatched trusted pull request security for #${prNumber}`,
        result: dispatchPullSecurity(
          config,
          prNumber,
          args["expected-head-sha"],
          { ghApiJson },
        ),
      },
      Boolean(args.json),
    );
    return;
  }
  if (args["mark-failed"]) {
    const failure = classifyReviewWorkflowFailurePath(args["failure-evidence"]);
    const result = markReviewWorkflowFailure(
      config,
      prNumber,
      args["expected-head-sha"],
      failure,
      dryRun,
    );
    finish(
      {
        ok: true,
        message: `${dryRun ? "would record" : "recorded"} review workflow failure for #${prNumber}`,
        result,
      },
      Boolean(args.json),
    );
    return;
  }
  if (args["from-file"]) {
    const result = applyReview(
      config,
      prNumber,
      args["from-file"],
      args["apply-patch"],
      args["remote-record"],
      dryRun,
      args["expected-head-sha"],
      args["repair-attempt"],
      { ghApiJson },
    );
    setGitHubOutput({ "next-gate": result.skipNoMistakes ? "automerge" : "no-mistakes" });
    finish(
      { ok: true, message: `${dryRun ? "would apply" : "applied"} review for #${prNumber}`, result },
      Boolean(args.json)
    );
    return;
  }
  throw new AgentError(
    "missing --wait-for-ci, --write-prompt, --create-patch, --repair-whitespace, --dispatch-pr-security, --mark-failed, or --from-file",
    2,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => fail(error, Boolean(parseArgs().json)));
}
