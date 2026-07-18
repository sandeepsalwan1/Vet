#!/usr/bin/env node
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
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
  issueLabels,
  loadConfig,
  markdownJsonBlock,
  newestManagedComment,
  parseImplementationMetadata,
  parseArgs,
  privilegedCandidatePaths,
  readAgentJson,
  readText,
  removeLabels,
  repoRoot,
  runCommand,
  setCommitStatus,
  upsertManagedComment
} from "./agent-lib.mjs";

export const MAX_REVIEW_DIFF_BYTES = 50000;
export const MAX_REVIEW_REPAIR_ATTEMPTS = 2;

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
    const { pull } = fetchSnapshot(config, prNumber);
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

function fetchPull(config, prNumber) {
  const { pull, files } = getPullSnapshot(config, prNumber);
  const trust = assertTrustedAgentPull(pull, config, { files, rejectPrivilegedPaths: true });
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
  pullComments,
  sourceIssue,
  triageComment,
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

Body:

${pull.body ?? ""}

## Comments

${pullComments.map((comment) => `### Comment ${comment.id}\n\n${comment.body ?? ""}`).join("\n\n") || "none"}

## Source Issue

Number: ${sourceIssue.number}
Title: ${sourceIssue.title}
Labels: ${issueLabels(sourceIssue).join(", ") || "none"}

Body:

${sourceIssue.body ?? ""}

## Managed Agent Triage

${triageComment.body}

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

function writePrompt(config, prNumber, outputPath, expectedHeadSha) {
  const { pull, issue, comments, files } = fetchPull(config, prNumber);
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
  assertTrustedAgentPull(pull, config, { files, sourceIssue, rejectPrivilegedPaths: true });
  const sourceComments = getIssueComments(config, sourceIssueNumber);
  const triageComment = requireManagedTriageComment(
    sourceComments,
    config.comments.triage,
    sourceIssueNumber,
    config.repo.owner
  );
  const diff = getPullDiff(config, pull);
  const ciChecks = fetchRequiredChecks(config, pull.head.sha);
  const prompt = buildReviewPrompt({
    template: readText(join(repoRoot(), ".agent/prompts/review.md")),
    pull,
    pullIssue: issue,
    pullComments: comments,
    sourceIssue,
    triageComment,
    ciChecks,
    diff
  });
  mkdirSync(join(repoRoot(), ".agent-output"), { recursive: true });
  writeFileSync(outputPath, prompt);
  return { prNumber, sourceIssueNumber, diffBytes: Buffer.byteLength(diff, "utf8"), outputPath };
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
  const snapshot = fetchSnapshot(config, prNumber);
  assertReviewedHead(snapshot.pull, expectedHeadSha);
  const sourceIssue = fetchSourceIssue(snapshot.trust.sourceIssue);
  assertTrustedAgentPull(snapshot.pull, config, {
    files: snapshot.files,
    sourceIssue,
    rejectPrivilegedPaths: true,
  });
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

function reviewBody(review, cycle) {
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

${review.humanQuestion ? `Human question:\n\n${review.humanQuestion}\n` : ""}

Structured review:
${markdownJsonBlock(review)}`;
}

export function normalizeReviewPolicy(review) {
  validateReviewResult(review);
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
    !["none", "CI", "UI", "GIF"].includes(review.proofNeeded) ||
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
  if (review.proofNeeded === "UI" || review.proofNeeded === "GIF") add.push(config.labels.proof);
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
  { repairAttempt: attemptValue = 0, patchApplied = false, ciPassed = true } = {}
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
  const technicalRepairNeeded =
    patchApplied || review.mergeRecommendation === "blocked" || !ciPassed;
  if (technicalRepairNeeded && attempt < MAX_REVIEW_REPAIR_ATTEMPTS) {
    return {
      state: "retry",
      nextAttempt: attempt + 1,
      continueToNoMistakes: false,
      statusState: "pending",
      statusDescription: `agent review repairing (${attempt + 1}/${MAX_REVIEW_REPAIR_ATTEMPTS})`
    };
  }
  if (technicalRepairNeeded) {
    return {
      state: "repair-exhausted",
      nextAttempt: null,
      continueToNoMistakes: false,
      statusState: "failure",
      statusDescription: "agent review repair limit exhausted"
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
  if (cycle.state === "ready" && (review.proofNeeded === "UI" || review.proofNeeded === "GIF")) {
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
  dryRun,
  expectedHeadSha,
  repairAttemptValue = 0
) {
  const { pull, files } = fetchPull(config, prNumber);
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
  assertTrustedAgentPull(pull, config, { files, sourceIssue, rejectPrivilegedPaths: true });
  const automergeEligible =
    implementationMetadata(pull.body).automergeEligible === true &&
    issueLabels(sourceIssue).includes(config.labels.automerge);
  const ciChecks = fetchRequiredChecks(config, pull.head.sha);
  const ciPassed = ciChecks.every((check) => check.state === "success");
  let review = readAgentJson(reviewPath);
  validateReviewResult(review);
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

  if (!dryRun && hasPatch) {
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
        runCommand("git", ["commit", "-m", `fix: address agent review for #${prNumber}`]);
        statusSha = gitOutput(["rev-parse", "HEAD"]);
        runCommand("gh", ["auth", "setup-git", "--hostname", "github.com"]);
        runCommand("git", ["push", "origin", `HEAD:${pull.head.ref}`]);
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
  const cycle = reviewCycleDecision(review, {
    repairAttempt: repairAttemptValue,
    patchApplied,
    ciPassed: patchApplied ? false : ciPassed
  });
  const policy = reviewCycleLabelChanges(config, review, cycle, { automergeEligible });

  const comment = upsertManagedComment({
    config,
    number: prNumber,
    marker: config.comments.review,
    body: reviewBody(review, cycle),
    dryRun
  });

  const labels = {
    added: addLabels(config, prNumber, policy.add, dryRun),
    removed: removeLabels(config, prNumber, policy.remove, dryRun)
  };
  const proofDispatch =
    policy.add.includes(config.labels.proof) && !dryRun
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
  return {
    review,
    cycle,
    ciChecks,
    comment,
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
        ...writePrompt(config, prNumber, args["write-prompt"], args["expected-head-sha"])
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
        result: await waitForRequiredChecks(config, prNumber, args["expected-head-sha"])
      },
      Boolean(args.json)
    );
    return;
  }
  if (args["create-patch"]) {
    finish({ ok: true, message: `created review patch for #${prNumber}`, ...createPatch(args["create-patch"]) }, Boolean(args.json));
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
        ),
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
      dryRun,
      args["expected-head-sha"],
      args["repair-attempt"]
    );
    finish(
      { ok: true, message: `${dryRun ? "would apply" : "applied"} review for #${prNumber}`, result },
      Boolean(args.json)
    );
    return;
  }
  throw new AgentError(
    "missing --wait-for-ci, --write-prompt, --create-patch, --dispatch-pr-security, or --from-file",
    2,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => fail(error, Boolean(parseArgs().json)));
}
