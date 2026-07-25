#!/usr/bin/env node
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  fail,
  finish,
  loadConfig,
  parseArgs,
  readJson,
  requireValue,
  setGitHubOutput
} from "./agent-lib.mjs";

export function routeEvent(event, config) {
  const labels = config.labels;
  const issue = event.issue;
  const pull = event.pull_request;
  const comment = event.comment;
  const issueNumber = Number(issue?.number);

  if (comment) {
    const commentId = Number(comment.id);
    const issueLabelNames = (issue?.labels ?? [])
      .map((entry) => (typeof entry === "string" ? entry : entry?.name))
      .filter(Boolean);
    const owner = String(config.repo?.owner ?? "").toLowerCase();
    const author = String(comment.user?.login ?? "").toLowerCase();
    const body = String(comment.body ?? "").trim();
    if (
      event.action === "created" &&
      Number.isSafeInteger(issueNumber) &&
      issueNumber > 0 &&
      !issue?.pull_request &&
      Number.isSafeInteger(commentId) &&
      commentId > 0 &&
      owner &&
      author === owner &&
      body &&
      issueLabelNames.includes(labels.blocked)
    ) {
      return {
        lane: "resume",
        kind: "issue",
        issueNumber,
        commentId,
        reason: "repository owner answered a blocked issue"
      };
    }
    return { lane: "none", reason: "comment does not qualify for blocked-issue resume" };
  }

  const label = event.label?.name;
  const isPull = Boolean(pull);
  const target = isPull ? pull : issue;
  const number = target?.number;

  if (!label || !number) {
    return { lane: "none", reason: "event has no label target" };
  }

  if (!Object.values(labels).includes(label)) {
    return { lane: "none", reason: `ignored label ${label}` };
  }

  if (!isPull && label === labels.triage) {
    return { lane: "triage", kind: "issue", issueNumber: number };
  }
  if (!isPull && label === labels.implement) {
    return {
      lane: "triage",
      kind: "issue",
      issueNumber: number,
      reason: "implementation request requires trusted triage"
    };
  }
  if (!isPull && label === labels.proof) {
    return { lane: "proof", kind: "issue", issueNumber: number, targetKind: "issue", targetNumber: number };
  }
  if (isPull && label === labels.review) {
    return { lane: "review", kind: "pull_request", prNumber: number };
  }
  if (isPull && label === labels.proof) {
    return { lane: "proof", kind: "pull_request", prNumber: number, targetKind: "pr", targetNumber: number };
  }
  if (isPull && label === labels.automerge) {
    return { lane: "automerge", kind: "pull_request", prNumber: number };
  }
  return { lane: "none", reason: `label ${label} has no route for ${isPull ? "pull_request" : "issue"}` };
}

async function main() {
  const args = parseArgs();
  const config = loadConfig();
  const eventPath = requireValue(args["event-file"] ?? process.env.GITHUB_EVENT_PATH, "event file");
  const event = readJson(eventPath);
  const route = routeEvent(event, config);
  setGitHubOutput({
    lane: route.lane,
    issue_number: route.issueNumber ?? "",
    pr_number: route.prNumber ?? "",
    target_kind: route.targetKind ?? "",
    target_number: route.targetNumber ?? "",
    comment_id: route.commentId ?? "",
    reason: route.reason ?? ""
  });
  finish(
    {
      ok: true,
      message: route.lane === "none" ? `no route: ${route.reason}` : `route: ${route.lane}`,
      route
    },
    Boolean(args.json)
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => fail(error, Boolean(parseArgs().json)));
}
