#!/usr/bin/env node
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  AgentError,
  addLabels,
  dispatchWorkflow,
  fail,
  finish,
  gh,
  ghApiJson,
  gitOutput,
  issueLabels,
  loadConfig,
  markdownJsonBlock,
  parseArgs,
  readAgentJson,
  readText,
  removeLabels,
  repoRoot,
  runCommand,
  setCommitStatus,
  upsertManagedComment
} from "./agent-lib.mjs";

function fetchPull(config, prNumber) {
  const pull = ghApiJson(`repos/${config.repo.owner}/${config.repo.name}/pulls/${prNumber}`);
  if (pull.head.repo.full_name !== `${config.repo.owner}/${config.repo.name}`) {
    throw new AgentError("refusing agent review for cross-repository PR", 1, {
      head: pull.head.repo.full_name,
      base: `${config.repo.owner}/${config.repo.name}`
    });
  }
  const issue = ghApiJson(`repos/${config.repo.owner}/${config.repo.name}/issues/${prNumber}`);
  const comments = ghApiJson(`repos/${config.repo.owner}/${config.repo.name}/issues/${prNumber}/comments`, {
    paginate: true
  });
  const diff = gh(["pr", "diff", String(prNumber), "--repo", `${config.repo.owner}/${config.repo.name}`, "--patch"]).stdout;
  return { pull, issue, comments, diff };
}

function writePrompt(config, prNumber, outputPath) {
  const { pull, issue, comments, diff } = fetchPull(config, prNumber);
  const prompt = `${readText(join(repoRoot(), ".agent/prompts/review.md"))}

## Pull Request

Number: ${pull.number}
Title: ${pull.title}
Labels: ${issueLabels(issue).join(", ") || "none"}
Head: ${pull.head.ref} ${pull.head.sha}
Base: ${pull.base.ref}

Body:

${pull.body ?? ""}

## Comments

${comments.map((comment) => `### Comment ${comment.id}\n\n${comment.body ?? ""}`).join("\n\n") || "none"}

## Diff

\`\`\`diff
${diff.slice(0, 50000)}
\`\`\`
`;
  mkdirSync(join(repoRoot(), ".agent-output"), { recursive: true });
  writeFileSync(outputPath, prompt);
  return { prNumber, outputPath };
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
  runCommand("git", ["fetch", "origin", pull.head.ref]);
  runCommand("git", ["switch", "-C", pull.head.ref, "FETCH_HEAD"]);
}

function privilegedPatchPaths(paths) {
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

function applyReview(config, prNumber, reviewPath, patchPath, dryRun) {
  const { pull } = fetchPull(config, prNumber);
  const review = readAgentJson(reviewPath);
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

  if (!dryRun && hasPatch) {
    checkoutPullHead(pull);
    runCommand("git", ["apply", "--index", effectivePatchPath]);
    const staged = runCommand("git", ["diff", "--cached", "--name-only"]).stdout.trim();
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
      }
    }
  }

  const comment = upsertManagedComment({
    config,
    number: prNumber,
    marker: config.comments.review,
    body: reviewBody(review),
    dryRun
  });

  const add = [];
  const remove = [];
  let state = "success";
  let description = "agent review passed";
  if (review.proofNeeded === "UI" || review.proofNeeded === "GIF") add.push(config.labels.proof);
  const blocked =
    review.mergeRecommendation === "blocked" ||
    review.mergeRecommendation === "ready-human-review" ||
    review.remainingRisk === "high";
  if (blocked) {
    add.push(config.labels.blocked);
    remove.push(config.labels.automerge);
    state = "failure";
    description =
      review.mergeRecommendation === "ready-human-review"
        ? "agent review needs human review"
        : "agent review blocked";
  } else {
    remove.push(config.labels.blocked);
  }
  const labels = {
    added: addLabels(config, prNumber, [...new Set(add)], dryRun),
    removed: removeLabels(config, prNumber, [...new Set(remove)], dryRun)
  };
  const dispatch =
    add.includes(config.labels.proof) && !dryRun
      ? dispatchWorkflow(config, "agent-proof.yml", { "target-kind": "pr", "target-number": prNumber }, false)
      : null;
  const status = setCommitStatus({
    config,
    sha: statusSha,
    state,
    context: "agent-review",
    description,
    dryRun
  });
  return { review, comment, labels, dispatch, status, patchApplied: Boolean(hasPatch && !privilegedPaths.length), privilegedPaths };
}

async function main() {
  const args = parseArgs();
  const config = loadConfig();
  const prNumber = Number(args["pr-number"]);
  if (!Number.isInteger(prNumber)) throw new AgentError("missing --pr-number", 2);
  const dryRun = Boolean(args["dry-run"]);

  if (args["write-prompt"]) {
    finish({ ok: true, message: `wrote review prompt for #${prNumber}`, ...writePrompt(config, prNumber, args["write-prompt"]) }, Boolean(args.json));
    return;
  }
  if (args["create-patch"]) {
    finish({ ok: true, message: `created review patch for #${prNumber}`, ...createPatch(args["create-patch"]) }, Boolean(args.json));
    return;
  }
  if (args["from-file"]) {
    const result = applyReview(config, prNumber, args["from-file"], args["apply-patch"], dryRun);
    const blocked =
      result.review.mergeRecommendation === "blocked" ||
      result.review.mergeRecommendation === "ready-human-review" ||
      result.review.remainingRisk === "high";
    finish(
      { ok: !blocked, message: `${dryRun ? "would apply" : "applied"} review for #${prNumber}`, result },
      Boolean(args.json),
      blocked ? 1 : 0
    );
    return;
  }
  throw new AgentError("missing --write-prompt, --create-patch, or --from-file", 2);
}

main().catch((error) => fail(error, Boolean(parseArgs().json)));
