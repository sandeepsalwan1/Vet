#!/usr/bin/env node
import {
  AgentError,
  addLabels,
  fail,
  finish,
  loadConfig,
  parseArgs,
  readAgentJson,
  repoSlug,
  withTempJson,
  ghJson,
  markdownJsonBlock
} from "./agent-lib.mjs";

function issueBody(proposal) {
  return `${proposal.body.trim()}

---

Agent proposal metadata:
${markdownJsonBlock({
  value: proposal.value,
  priority: proposal.priority,
  risk: proposal.risk,
  proof: proposal.proof
})}`;
}

function createIssue(config, proposal, dryRun) {
  const labels = [config.labels.triage];
  const payload = {
    title: proposal.title,
    body: issueBody(proposal),
    labels
  };
  if (dryRun) {
    return { action: "would-create", title: proposal.title, labels };
  }
  return withTempJson(payload, (path) => {
    const issue = ghJson(["api", `repos/${config.repo.owner}/${config.repo.name}/issues`, "-X", "POST", "--input", path]);
    return { action: "created", number: issue.number, url: issue.html_url, labels };
  });
}

async function main() {
  const args = parseArgs();
  const config = loadConfig();
  const dryRun = Boolean(args["dry-run"]);
  const json = Boolean(args.json);
  const fromFile = args["from-file"];
  if (!fromFile) throw new AgentError("missing --from-file", 2);
  const data = readAgentJson(fromFile);
  const proposals = Array.isArray(data.issues) ? data.issues.slice(0, 3) : [];
  if (proposals.length === 0) throw new AgentError("proposal output contains no issues", 1);
  const results = proposals.map((proposal) => createIssue(config, proposal, dryRun));
  if (!dryRun && args["label-existing"]) {
    addLabels(config, args["label-existing"], [config.labels.triage], dryRun);
  }
  finish(
    {
      ok: true,
      repo: repoSlug(config),
      message: `${dryRun ? "would create" : "created"} ${results.length} proposed issues`,
      issues: results
    },
    json
  );
}

main().catch((error) => fail(error, Boolean(parseArgs().json)));
