#!/usr/bin/env node
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AgentError,
  addLabels,
  assertTrustedAgentPull,
  dispatchWorkflow,
  fail,
  finish,
  gh,
  ghApiJson,
  ghJson,
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

function fetchPull(config, prNumber) {
  const pull = ghApiJson(`repos/${config.repo.owner}/${config.repo.name}/pulls/${prNumber}`);
  const files = ghApiJson(
    `repos/${config.repo.owner}/${config.repo.name}/pulls/${prNumber}/files?per_page=100`,
    { paginate: true }
  ) ?? [];
  const trust = assertTrustedAgentPull(pull, config, { files, rejectPrivilegedPaths: true });
  const issue = ghApiJson(`repos/${config.repo.owner}/${config.repo.name}/issues/${prNumber}`);
  const comments = ghApiJson(`repos/${config.repo.owner}/${config.repo.name}/issues/${prNumber}/comments`, {
    paginate: true
  });
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

export function buildReviewPrompt({ template, pull, pullIssue, pullComments, sourceIssue, triageComment, diff }) {
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
  const closing = ghJson([
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
  const sourceComments = ghApiJson(`repos/${config.repo.owner}/${config.repo.name}/issues/${sourceIssueNumber}/comments`, {
    paginate: true
  });
  const triageComment = requireManagedTriageComment(
    sourceComments,
    config.comments.triage,
    sourceIssueNumber,
    config.repo.owner
  );
  const diff = gh(["pr", "diff", String(prNumber), "--repo", `${config.repo.owner}/${config.repo.name}`, "--patch"]).stdout;
  const prompt = buildReviewPrompt({
    template: readText(join(repoRoot(), ".agent/prompts/review.md")),
    pull,
    pullIssue: issue,
    pullComments: comments,
    sourceIssue,
    triageComment,
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

function reviewBody(review) {
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

function applyReview(config, prNumber, reviewPath, patchPath, dryRun, expectedHeadSha) {
  const { pull, files } = fetchPull(config, prNumber);
  assertReviewedHead(pull, expectedHeadSha);
  const closing = ghJson([
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
  const policy = reviewLabelChanges(config, review);

  const comment = upsertManagedComment({
    config,
    number: prNumber,
    marker: config.comments.review,
    body: reviewBody(review),
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
    state: policy.statusState,
    context: "agent-review",
    description: policy.statusDescription,
    dryRun
  });
  return {
    review,
    comment,
    labels,
    dispatch: { ci: ciDispatch, codeql: codeqlDispatch, proof: proofDispatch },
    status,
    patchApplied: Boolean(hasPatch && !privilegedPaths.length),
    privilegedPaths,
    technicalSuccess: policy.technicalSuccess,
    manualBlock: policy.manualBlock
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
      args["expected-head-sha"]
    );
    finish(
      { ok: result.technicalSuccess, message: `${dryRun ? "would apply" : "applied"} review for #${prNumber}`, result },
      Boolean(args.json),
      result.technicalSuccess ? 0 : 1
    );
    return;
  }
  throw new AgentError(
    "missing --write-prompt, --create-patch, --dispatch-pr-security, or --from-file",
    2,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => fail(error, Boolean(parseArgs().json)));
}
