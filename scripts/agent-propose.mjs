#!/usr/bin/env node
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import {
  AgentError,
  addLabels,
  fail,
  finish,
  ghApiJson,
  loadConfig,
  parseArgs,
  readAgentJson,
  repoSlug,
  withTempJson,
  ghJson,
  markdownJsonBlock
} from "./agent-lib.mjs";

export function normalizeProposalText(value) {
  return String(value ?? "")
    .trim()
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n");
}

export function proposalIdentity(proposal) {
  const canonical = JSON.stringify({
    title: normalizeProposalText(proposal.title).toLowerCase(),
    body: normalizeProposalText(proposal.body)
  });
  return createHash("sha256").update(canonical).digest("hex");
}

export function proposalIdentityMarker(proposal) {
  return `<!-- agent-proposal-id:v1:${proposalIdentity(proposal)} -->`;
}

export function validateProposalOutput(data) {
  const levels = new Set(["low", "medium", "high"]);
  const proofKinds = new Set(["none", "CI", "UI", "GIF"]);
  const issues = data?.issues;
  if (
    !data ||
    Array.isArray(data) ||
    JSON.stringify(Object.keys(data).sort()) !== JSON.stringify(["issues"]) ||
    !Array.isArray(issues) ||
    issues.length === 0 ||
    issues.length > 3
  ) {
    throw new AgentError("proposal output is invalid", 1);
  }
  const expectedKeys = ["body", "priority", "proof", "risk", "title", "value"];
  for (const proposal of issues) {
    if (
      !proposal ||
      Array.isArray(proposal) ||
      JSON.stringify(Object.keys(proposal).sort()) !== JSON.stringify(expectedKeys) ||
      typeof proposal.title !== "string" ||
      proposal.title.trim().length < 8 ||
      proposal.title.length > 120 ||
      typeof proposal.body !== "string" ||
      proposal.body.trim().length < 20 ||
      !levels.has(proposal.value) ||
      !levels.has(proposal.priority) ||
      !levels.has(proposal.risk) ||
      !proofKinds.has(proposal.proof)
    ) {
      throw new AgentError("proposal output is invalid", 1);
    }
  }
  return issues;
}

export function issueBody(config, proposal) {
  return `${proposal.body.trim()}

---

Agent proposal metadata:
${markdownJsonBlock({
  value: proposal.value,
  priority: proposal.priority,
  risk: proposal.risk,
  proof: proposal.proof
})}
${config.comments.propose}
${proposalIdentityMarker(proposal)}
`;
}

export function findExistingProposal(existingIssues, proposal) {
  const marker = proposalIdentityMarker(proposal);
  const title = normalizeProposalText(proposal.title).toLowerCase();
  const body = normalizeProposalText(proposal.body);
  return (
    existingIssues.find((issue) => {
      if (issue.pull_request) return false;
      const existingBody = String(issue.body ?? "");
      if (existingBody.includes(marker)) return true;
      return normalizeProposalText(issue.title).toLowerCase() === title && normalizeProposalText(existingBody).includes(body);
    }) ?? null
  );
}

function listExistingIssues(config) {
  const endpoint = `repos/${config.repo.owner}/${config.repo.name}/issues?state=all&per_page=100`;
  return ghApiJson(endpoint, { paginate: true }) ?? [];
}

export function createIssue(config, proposal, existingIssues, dryRun, dependencies = {}) {
  const apiJson = dependencies.ghJson ?? ghJson;
  const tempJson = dependencies.withTempJson ?? withTempJson;
  const applyLabels = dependencies.addLabels ?? addLabels;
  const existing = findExistingProposal(existingIssues, proposal);
  const labels = [config.labels.triage];
  const identity = proposalIdentity(proposal);
  if (existing) {
    const existingLabels = (existing.labels ?? [])
      .map((label) => (typeof label === "string" ? label : label.name))
      .filter(Boolean);
    if (!dryRun && existing.state === "open" && !existingLabels.includes(config.labels.triage)) {
      applyLabels(config, existing.number, labels, false);
      existingLabels.push(config.labels.triage);
    }
    return {
      action: existing.state === "open" ? (dryRun ? "would-reuse" : "reused") : "skipped-existing-closed",
      number: existing.number,
      url: existing.html_url,
      labels: existingLabels,
      identity
    };
  }
  const payload = {
    title: proposal.title,
    body: issueBody(config, proposal),
    labels
  };
  if (dryRun) {
    return { action: "would-create", title: proposal.title, labels, identity };
  }
  return tempJson(payload, (path) => {
    const issue = apiJson(["api", `repos/${config.repo.owner}/${config.repo.name}/issues`, "-X", "POST", "--input", path]);
    return { action: "created", number: issue.number, url: issue.html_url, labels, identity };
  });
}

export async function main() {
  const args = parseArgs();
  const config = loadConfig();
  const dryRun = Boolean(args["dry-run"]);
  const json = Boolean(args.json);
  const fromFile = args["from-file"];
  if (!fromFile) throw new AgentError("missing --from-file", 2);
  const data = readAgentJson(fromFile);
  const proposals = validateProposalOutput(data);
  const existingIssues = dryRun ? [] : listExistingIssues(config);
  const results = [];
  for (const proposal of proposals) {
    const result = createIssue(config, proposal, existingIssues, dryRun);
    results.push(result);
    if (result.action === "created" || result.action === "would-create") {
      existingIssues.push({
        number: result.number ?? `dry-run-${results.length}`,
        title: proposal.title,
        body: issueBody(config, proposal),
        state: "open",
        html_url: result.url,
        labels: result.labels
      });
    }
  }
  if (!dryRun && args["label-existing"]) {
    addLabels(config, args["label-existing"], [config.labels.triage], dryRun);
  }
  const counts = Object.fromEntries(
    [...new Set(results.map((result) => result.action))].map((action) => [
      action,
      results.filter((result) => result.action === action).length
    ])
  );
  finish(
    {
      ok: true,
      repo: repoSlug(config),
      message: `processed ${results.length} proposed issues`,
      counts,
      issues: results
    },
    json
  );
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    const normalized = error instanceof AgentError && [1, 2].includes(error.code)
      ? error
      : new AgentError(error?.message ?? String(error), 1);
    fail(normalized, Boolean(parseArgs().json));
  });
}
