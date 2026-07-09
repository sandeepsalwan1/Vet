#!/usr/bin/env node
import {
  fail,
  finish,
  loadConfig,
  parseArgs,
  readJson,
  requireValue,
  setGitHubOutput
} from "./agent-lib.mjs";

function routeEvent(event, config) {
  const label = event.label?.name;
  const labels = config.labels;
  const issue = event.issue;
  const pull = event.pull_request;
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
    return { lane: "implement", kind: "issue", issueNumber: number };
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

main().catch((error) => fail(error, Boolean(parseArgs().json)));
