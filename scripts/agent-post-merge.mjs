#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  AgentError,
  addLabels,
  fail,
  finish,
  gh,
  ghApiJson,
  issueLabels,
  loadConfig,
  parseArgs,
  removeLabels,
  setCommitStatus,
  upsertManagedComment
} from "./agent-lib.mjs";

export function validateRenderRecord(record, targetSha) {
  if (
    !record ||
    Array.isArray(record) ||
    record.version !== 2 ||
    !["passed", "failed"].includes(record.status) ||
    record.expectedSha !== targetSha ||
    !["observed", "latest-branch", "unknown"].includes(
      record.deploymentSource
    ) ||
    (record.previousLiveSha &&
      !/^[a-f0-9]{40}$/.test(record.previousLiveSha)) ||
    typeof record.summary !== "string" ||
    !record.summary ||
    typeof record.blocker !== "string" ||
    !record.logs ||
    !Array.isArray(record.health)
  ) {
    throw new AgentError("post-merge Render record is invalid", 1);
  }
  if (
    record.status === "passed" &&
    (!/^[a-f0-9]{40}$/.test(record.deployedSha) ||
      record.deploymentSource === "unknown" ||
      (record.deploymentSource === "observed" &&
        record.deployedSha !== targetSha) ||
      record.deployStatus !== "live" ||
      record.logs.count <= 0 ||
      record.health.length === 0 ||
      record.health.some((check) => check?.passed !== true))
  ) {
    throw new AgentError("post-merge Render success record is inconsistent", 1);
  }
  return record;
}

function comparisonProvesAncestor(comparison, ancestorSha) {
  return (
    comparison?.status === "ahead" &&
    comparison?.merge_base_commit?.sha === ancestorSha &&
    comparison?.behind_by === 0
  );
}

export function validateDeploymentLineage({
  mergeSha,
  deploySha,
  currentMainSha,
  previousLiveSha = "",
  mergeToDeploy = null,
  deployToMain = null,
  previousToDeploy = null
}) {
  for (const [label, sha] of Object.entries({
    "merge SHA": mergeSha,
    "deployment SHA": deploySha,
    "current main SHA": currentMainSha
  })) {
    if (!/^[a-f0-9]{40}$/.test(String(sha ?? ""))) {
      throw new AgentError(`post-merge ${label} is invalid`, 1);
    }
  }
  if (
    mergeSha !== deploySha &&
    !comparisonProvesAncestor(mergeToDeploy, mergeSha)
  ) {
    throw new AgentError(
      "selected Render revision does not contain the merged commit",
      1
    );
  }
  if (
    deploySha !== currentMainSha &&
    !comparisonProvesAncestor(deployToMain, deploySha)
  ) {
    throw new AgentError(
      "selected Render revision is not on current main",
      1
    );
  }
  if (
    previousLiveSha &&
    previousLiveSha !== deploySha &&
    !comparisonProvesAncestor(previousToDeploy, previousLiveSha)
  ) {
    throw new AgentError(
      "selected Render revision would roll back the prior live revision",
      1
    );
  }
  return { mergeSha, deploySha, currentMainSha };
}

export function postMergeLabelChanges(config, currentLabels, passed) {
  const hadFailure = currentLabels.includes(config.labels.postMergeFailed);
  return passed
    ? {
        add: [],
        remove: [
          config.labels.postMergeFailed,
          ...(hadFailure ? [config.labels.blocked] : [])
        ]
      }
    : {
        add: [config.labels.postMergeFailed, config.labels.blocked],
        remove: []
      };
}

export function postMergeBody(record, mergeSha, runUrl = "") {
  const health = record.health.length
    ? record.health
        .map(
          (check) =>
            `- ${check.passed ? "pass" : "fail"}: ${new URL(check.url).hostname} ` +
            `HTTP ${check.status}, clinic \`${check.clinicSlug || "unknown"}\``
        )
        .join("\n")
    : "- none";
  return `## Agent Post-Merge Verification

Status: ${record.status}
Merge: \`${mergeSha}\`
Deployed revision: ${record.deployedSha ? `\`${record.deployedSha}\`` : "unknown"}
Deploy: ${record.deployStatus}
Deployment source: ${record.deploymentSource}
Logs observed: ${record.logs.count}
Error-level logs observed: ${record.logs.errorCount}
Run: ${runUrl ? `[trusted Actions run](${runUrl})` : "not available"}

Health:

${health}

Summary:

${record.summary}

${record.blocker ? `Blocker:\n\n${record.blocker}\n` : ""}`;
}

function updateIssueState(config, number, state) {
  gh([
    "api",
    `repos/${config.repo.owner}/${config.repo.name}/issues/${number}`,
    "--method",
    "PATCH",
    "-f",
    `state=${state}`,
    "--silent"
  ]);
}

async function main(args = parseArgs()) {
  const config = loadConfig();
  const sourceIssue = Number(args["source-issue"]);
  const prNumber = Number(args["pr-number"]);
  const mergeSha = String(args["merge-sha"] ?? "").toLowerCase();
  const targetSha = String(args["target-sha"] ?? mergeSha).toLowerCase();
  if (
    !Number.isInteger(sourceIssue) ||
    sourceIssue <= 0 ||
    !Number.isInteger(prNumber) ||
    prNumber <= 0 ||
    !/^[a-f0-9]{40}$/.test(mergeSha) ||
    !/^[a-f0-9]{40}$/.test(targetSha)
  ) {
    throw new AgentError("post-merge target is invalid", 2);
  }
  let record;
  try {
    record = validateRenderRecord(
      JSON.parse(readFileSync(resolve(args["render-record"]), "utf8")),
      targetSha
    );
  } catch (error) {
    record = {
      version: 2,
      status: "failed",
      expectedSha: targetSha,
      deployedSha: "",
      deploymentSource: "unknown",
      previousLiveSha: "",
      deployStatus: "unknown",
      logs: { count: 0, errorCount: 0 },
      health: [],
      summary: "Trusted post-merge verification did not produce a valid record.",
      blocker: error?.message ?? String(error)
    };
  }
  const renderPassed = record.status === "passed";
  let lineageError = "";
  if (renderPassed) {
    try {
      const deploySha = record.deployedSha;
      const currentMainSha = String(
        ghApiJson(
          `repos/${config.repo.owner}/${config.repo.name}/commits/${config.repo.defaultBranch}`
        )?.sha ?? ""
      ).toLowerCase();
      const mergeToDeploy =
        mergeSha === deploySha
          ? null
          : ghApiJson(
              `repos/${config.repo.owner}/${config.repo.name}/compare/${mergeSha}...${deploySha}`
            );
      const deployToMain =
        deploySha === currentMainSha
          ? null
          : ghApiJson(
              `repos/${config.repo.owner}/${config.repo.name}/compare/${deploySha}...${currentMainSha}`
            );
      const previousToDeploy =
        !record.previousLiveSha || record.previousLiveSha === deploySha
          ? null
          : ghApiJson(
              `repos/${config.repo.owner}/${config.repo.name}/compare/${record.previousLiveSha}...${deploySha}`
            );
      validateDeploymentLineage({
        mergeSha,
        deploySha,
        currentMainSha,
        previousLiveSha: record.previousLiveSha,
        mergeToDeploy,
        deployToMain,
        previousToDeploy
      });
    } catch (error) {
      lineageError = error?.message ?? String(error);
    }
  }
  const passed =
    args["verification-conclusion"] === "success" &&
    renderPassed &&
    !lineageError;
  if (!passed) {
    record.status = "failed";
    if (lineageError && renderPassed) {
      record.summary =
        "Trusted post-merge verification rejected the deployment lineage.";
      record.blocker = lineageError;
    } else if (lineageError) {
      record.blocker = [record.blocker, `Deployment lineage: ${lineageError}`]
        .filter(Boolean)
        .join(" ");
    }
  }
  const issue = ghApiJson(
    `repos/${config.repo.owner}/${config.repo.name}/issues/${sourceIssue}`
  );
  const changes = postMergeLabelChanges(
    config,
    issueLabels(issue),
    passed
  );
  addLabels(config, sourceIssue, changes.add);
  removeLabels(config, sourceIssue, changes.remove);
  updateIssueState(config, sourceIssue, passed ? "closed" : "open");
  const runUrl =
    process.env.GITHUB_SERVER_URL &&
    process.env.GITHUB_REPOSITORY &&
    process.env.GITHUB_RUN_ID
      ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
      : "";
  const comment = upsertManagedComment({
    config,
    number: sourceIssue,
    marker: config.comments.postMerge,
    body: postMergeBody(record, mergeSha, runUrl)
  });
  const status = setCommitStatus({
    config,
    sha: mergeSha,
    state: passed ? "success" : "failure",
    context: "agent-post-merge",
    description: passed
      ? "Render revision containing merge, logs, and health passed"
      : "trusted post-merge verification failed"
  });
  finish(
    {
      ok: passed,
      message: passed
        ? `post-merge verification passed for PR #${prNumber}`
        : `post-merge verification failed for PR #${prNumber}`,
      record,
      comment,
      status
    },
    Boolean(args.json),
    passed ? 0 : 1
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => fail(error, Boolean(parseArgs().json)));
}
