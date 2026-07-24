#!/usr/bin/env node
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AgentError,
  extractJson,
  fail,
  finish,
  getIssueComments,
  ghApiJson,
  issueLabels,
  loadConfig,
  newestManagedComment,
  parseArgs,
  setGitHubOutput
} from "./agent-lib.mjs";

function numericCommentId(comment) {
  return Number(comment?.database_id ?? comment?.id);
}

function commentTime(comment) {
  return Date.parse(comment?.updated_at ?? comment?.created_at ?? "");
}

export function ownerFollowUpForComment(comments, commentId, repoOwner, requireLatest = true) {
  const expectedId = Number(commentId);
  if (!Number.isSafeInteger(expectedId) || expectedId < 1) {
    throw new AgentError("resume comment id is invalid", 1);
  }
  const owner = String(repoOwner ?? "").toLowerCase();
  const comment = (comments ?? []).find((entry) => numericCommentId(entry) === expectedId);
  if (!comment) throw new AgentError("resume comment no longer exists", 1);
  if (!owner || String(comment.user?.login ?? "").toLowerCase() !== owner) {
    throw new AgentError("resume comment is not authored by the repository owner", 1);
  }
  const body = String(comment.body ?? "").trim();
  if (!body) throw new AgentError("resume comment is empty", 1);

  if (requireLatest) {
    const latest = [...(comments ?? [])]
      .filter((entry) => String(entry.user?.login ?? "").toLowerCase() === owner)
      .sort((left, right) => {
        const timeDifference = (commentTime(right) || 0) - (commentTime(left) || 0);
        return timeDifference || numericCommentId(right) - numericCommentId(left);
      })[0];
    if (!latest || numericCommentId(latest) !== expectedId) {
      throw new AgentError("resume comment is not the latest repository-owner reply", 1);
    }
  }

  return {
    id: expectedId,
    body,
    sha256: createHash("sha256").update(body).digest("hex"),
    createdAt: comment.created_at ?? "",
    updatedAt: comment.updated_at ?? comment.created_at ?? ""
  };
}

function managedTriageDecision(config, comments) {
  const comment = newestManagedComment(comments, config.comments.triage, config.repo.owner);
  if (!comment) throw new AgentError("blocked issue has no trusted managed triage question", 1);
  const afterMarker = String(comment.body ?? "").slice(
    String(comment.body ?? "").indexOf(config.comments.triage) + config.comments.triage.length
  );
  const fences = [...afterMarker.matchAll(/```json\s*([\s\S]*?)```/gi)];
  if (fences.length !== 1) throw new AgentError("managed triage question has no authoritative decision", 1);
  return { comment, decision: extractJson(fences[0][1]) };
}

export function evaluateResumeRequest(config, issue, comments, commentId) {
  if (!issue || issue.pull_request) {
    return { shouldResume: false, reason: "target is not an issue" };
  }
  if (String(issue.state ?? "").toLowerCase() !== "open") {
    return { shouldResume: false, reason: "issue is not open" };
  }
  if (!issueLabels(issue).includes(config.labels.blocked)) {
    return { shouldResume: false, reason: "issue is no longer blocked" };
  }

  let followUp;
  let triage;
  try {
    followUp = ownerFollowUpForComment(comments, commentId, config.repo.owner);
    triage = managedTriageDecision(config, comments);
  } catch (error) {
    return { shouldResume: false, reason: error.message };
  }

  const question = String(triage.decision?.humanQuestion ?? "").trim();
  if (!question) {
    return { shouldResume: false, reason: "managed triage has no unresolved human question" };
  }
  const triageUpdatedAt = commentTime(triage.comment);
  const replyUpdatedAt = Date.parse(followUp.updatedAt);
  if (!Number.isFinite(triageUpdatedAt) || !Number.isFinite(replyUpdatedAt) || replyUpdatedAt <= triageUpdatedAt) {
    return { shouldResume: false, reason: "owner reply does not follow the managed triage question" };
  }
  return {
    shouldResume: true,
    reason: "repository owner answered the managed triage question",
    followUp
  };
}

async function main() {
  const args = parseArgs();
  const config = loadConfig();
  const issueNumber = Number(args["issue-number"]);
  const commentId = Number(args["comment-id"]);
  if (!Number.isSafeInteger(issueNumber) || issueNumber < 1) {
    throw new AgentError("missing --issue-number", 2);
  }
  if (!Number.isSafeInteger(commentId) || commentId < 1) {
    throw new AgentError("missing --comment-id", 2);
  }
  const issue = ghApiJson(`repos/${config.repo.owner}/${config.repo.name}/issues/${issueNumber}`);
  const comments = getIssueComments(config, issueNumber);
  const result = evaluateResumeRequest(config, issue, comments, commentId);
  setGitHubOutput({
    should_resume: result.shouldResume,
    reason: result.reason
  });
  finish(
    {
      ok: true,
      message: result.shouldResume ? `resume issue #${issueNumber}` : `no resume: ${result.reason}`,
      issueNumber,
      commentId,
      shouldResume: result.shouldResume,
      reason: result.reason
    },
    Boolean(args.json)
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => fail(error, Boolean(parseArgs().json)));
}
