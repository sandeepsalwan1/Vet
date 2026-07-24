#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AgentError,
  addLabels,
  dispatchWorkflow,
  fail,
  finish,
  getIssueComments,
  ghApiJson,
  issueLabels,
  issueSnapshotSha256,
  loadConfig,
  markdownJsonBlock,
  parseArgs,
  readText,
  removeLabels,
  repoRoot,
  upsertManagedComment
} from "./agent-lib.mjs";

const TRIAGE_MANIFEST_VERSION = 1;
const DECISION_FIELDS = [
  "value",
  "priority",
  "risk",
  "alignment",
  "implementationScope",
  "proofNeeded",
  "automationDecision",
  "humanQuestion"
];

function fetchIssue(config, issueNumber) {
  const issue = ghApiJson(`repos/${config.repo.owner}/${config.repo.name}/issues/${issueNumber}`);
  if (issue?.pull_request) throw new AgentError("refusing to triage a pull request as an issue", 1);
  const comments = getIssueComments(config, issueNumber);
  return { issue, comments };
}

function buildPrompt(config, issue, comments) {
  const docs = [
    ["VISION.md", readText(join(repoRoot(), "VISION.md"))],
    ["README.md", readText(join(repoRoot(), "README.md"))],
    ["CONTEXT.md", readText(join(repoRoot(), "CONTEXT.md")).slice(0, 16000)],
    ["docs/architecture.md", readText(join(repoRoot(), "docs/architecture.md"))],
    [".agent/agent-policy.md", readText(join(repoRoot(), ".agent/agent-policy.md"))]
  ];
  return `${readText(join(repoRoot(), ".agent/prompts/triage.md"))}

## Repository Context

${docs.map(([name, body]) => `### ${name}\n\n${body.trim()}`).join("\n\n")}

## Issue

Number: ${issue.number}
Title: ${issue.title}
Labels: ${issueLabels(issue).join(", ") || "none"}

Body:

${issue.body ?? ""}

## Comments

${comments.map((comment) => `### Comment ${comment.id}\n\n${comment.body ?? ""}`).join("\n\n") || "none"}
`;
}

function pendingBody(snapshotSha256) {
  return `## Agent Triage

- state: pending
- issue snapshot: ${snapshotSha256}

Triage generation is running against this exact title and body snapshot.`;
}

function failedBody(snapshotSha256) {
  return `## Agent Triage

- state: failed
- issue snapshot: ${snapshotSha256}

Triage did not complete. A trusted retriage is required before implementation.`;
}

export function writeTriageManifest(path, issue) {
  const manifest = {
    version: TRIAGE_MANIFEST_VERSION,
    issueNumber: Number(issue.number),
    issueSnapshotSha256: issueSnapshotSha256(issue)
  };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

export function readTriageManifest(path) {
  let manifest;
  try {
    manifest = JSON.parse(readText(path));
  } catch {
    throw new AgentError("triage manifest is not valid JSON", 1);
  }
  const keys = Object.keys(manifest ?? {}).sort();
  if (
    !manifest ||
    Array.isArray(manifest) ||
    JSON.stringify(keys) !== JSON.stringify(["issueNumber", "issueSnapshotSha256", "version"]) ||
    manifest.version !== TRIAGE_MANIFEST_VERSION ||
    !Number.isInteger(manifest.issueNumber) ||
    manifest.issueNumber < 1 ||
    !/^[a-f0-9]{64}$/.test(manifest.issueSnapshotSha256 ?? "")
  ) {
    throw new AgentError("triage manifest is invalid", 1);
  }
  return manifest;
}

export function assertTriageSnapshot(issue, manifest, issueNumber) {
  if (manifest.issueNumber !== issueNumber || Number(issue?.number) !== issueNumber) {
    throw new AgentError("triage manifest issue does not match", 1);
  }
  const current = issueSnapshotSha256(issue);
  if (current !== manifest.issueSnapshotSha256) {
    throw new AgentError("issue title or body changed after triage started", 1, {
      expected: manifest.issueSnapshotSha256,
      current
    });
  }
  return current;
}

export function parseAuthoritativeTriageJson(text) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) throw new AgentError("empty triage JSON input", 2);
  const fences = [...trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)];
  let candidate = trimmed;
  if (fences.length) {
    if (fences.length !== 1) throw new AgentError("triage output must contain one authoritative JSON block", 2);
    const match = fences[0];
    const prefix = trimmed.slice(0, match.index ?? 0).trim();
    if (/[\[{]/.test(prefix)) {
      throw new AgentError("triage output must contain one authoritative JSON value", 2);
    }
    if (trimmed.slice((match.index ?? 0) + match[0].length).trim()) {
      throw new AgentError("authoritative triage JSON block must be final", 2);
    }
    candidate = match[1].trim();
  }
  let decision;
  try {
    decision = JSON.parse(candidate);
  } catch {
    throw new AgentError("triage output is not authoritative JSON", 2);
  }
  return validateTriageDecision(decision);
}

export function validateTriageDecision(decision) {
  const keys = Object.keys(decision ?? {}).sort();
  if (
    !decision ||
    Array.isArray(decision) ||
    JSON.stringify(keys) !== JSON.stringify([...DECISION_FIELDS].sort()) ||
    !["low", "medium", "high"].includes(decision.value) ||
    !["low", "medium", "high"].includes(decision.priority) ||
    !["low", "medium", "high"].includes(decision.risk) ||
    !["yes", "no", "unclear"].includes(decision.alignment) ||
    typeof decision.implementationScope !== "string" ||
    decision.implementationScope.trim() === "" ||
    decision.implementationScope.includes("```") ||
    !["none", "CI", "UI", "GIF"].includes(decision.proofNeeded) ||
    !["implement", "manual-review", "blocked", "reject"].includes(decision.automationDecision) ||
    typeof decision.humanQuestion !== "string" ||
    decision.humanQuestion.includes("```")
  ) {
    throw new AgentError("triage decision is invalid", 2);
  }
  return decision;
}

export function lightweightTriageDecision(config, issue) {
  const labels = issueLabels(issue);
  const priority = labels.includes(config.labels.priorityHigh)
    ? "high"
    : labels.includes(config.labels.priorityLow) || labels.includes(config.labels.priorityTrivial)
      ? "low"
      : "medium";
  const issueText = `${issue?.title ?? ""}\n${issue?.body ?? ""}`;
  const proofNeeded = /\b(?:gif|video|screen recording)\b/i.test(issueText)
    ? "GIF"
    : labels.includes(config.labels.proof)
      ? "UI"
      : "none";

  return {
    value: priority,
    priority,
    risk: priority === "low" ? "low" : "medium",
    alignment: "yes",
    implementationScope:
      "Implement the requested outcome using repository context and reasonable defaults. Resolve routine ambiguity during implementation instead of asking for exhaustive requirements.",
    proofNeeded,
    automationDecision: "implement",
    humanQuestion: ""
  };
}

export function writeLightweightTriageDecision(config, issueNumber, manifestPath, outputPath) {
  const manifest = readTriageManifest(manifestPath);
  const { issue } = fetchIssue(config, issueNumber);
  assertTriageSnapshot(issue, manifest, issueNumber);
  const decision = lightweightTriageDecision(config, issue);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(decision, null, 2)}\n`);
  return decision;
}

export function triageBody(decision) {
  return `## Agent Triage

- state: complete
- value: ${decision.value}
- priority: ${decision.priority}
- risk: ${decision.risk}
- alignment: ${decision.alignment}
- proof needed: ${decision.proofNeeded}
- automation: ${decision.automationDecision}
- issue snapshot: ${decision.issueSnapshotSha256}

Scope:

${decision.implementationScope}

${decision.humanQuestion ? `Human question:\n\n${decision.humanQuestion}\n` : ""}

Structured decision:
${markdownJsonBlock(decision)}`;
}

export function triageLabelChanges(config, decision, currentLabels = []) {
  const add = [];
  const remove = [];
  const stickyHighPriority = currentLabels.includes(config.labels.priorityHigh);
  const blocked =
    decision.alignment !== "yes" ||
    decision.automationDecision === "blocked" ||
    decision.automationDecision === "manual-review" ||
    decision.automationDecision === "reject" ||
    decision.humanQuestion.trim() !== "";
  const requiresVisualProof = decision.proofNeeded === "UI" || decision.proofNeeded === "GIF";

  if (decision.priority === "high") add.push(config.labels.priorityHigh);
  if (decision.priority === "low" && !stickyHighPriority) add.push(config.labels.priorityLow);
  if (requiresVisualProof) add.push(config.labels.proof);

  if (blocked) {
    add.push(config.labels.blocked);
    remove.push(config.labels.implement, config.labels.automerge);
  } else if (decision.automationDecision === "implement") {
    add.push(config.labels.implement);
    remove.push(config.labels.blocked);
    if (decision.risk !== "high" && decision.priority !== "high" && !stickyHighPriority) {
      add.push(config.labels.automerge);
    } else {
      remove.push(config.labels.automerge);
    }
  }

  if (stickyHighPriority || decision.priority !== "low") remove.push(config.labels.priorityLow);

  return {
    blocked,
    add: [...new Set(add)],
    remove: [...new Set(remove)]
  };
}

export function prepareTriage(config, issueNumber, promptPath, manifestPath, dryRun = false) {
  const { issue, comments } = fetchIssue(config, issueNumber);
  if (promptPath) {
    const prompt = buildPrompt(config, issue, comments);
    mkdirSync(dirname(promptPath), { recursive: true });
    writeFileSync(promptPath, prompt);
  }
  const manifest = writeTriageManifest(manifestPath, issue);
  const comment = upsertManagedComment({
    config,
    number: issueNumber,
    marker: config.comments.triage,
    body: pendingBody(manifest.issueSnapshotSha256),
    dryRun
  });
  const removed = removeLabels(config, issueNumber, [config.labels.implement, config.labels.automerge], dryRun);
  return { issueNumber, promptPath, manifestPath, manifest, comment, removed };
}

export function applyDecision(config, issueNumber, decision, manifestPath, dryRun = false) {
  const manifest = readTriageManifest(manifestPath);
  const { issue } = fetchIssue(config, issueNumber);
  assertTriageSnapshot(issue, manifest, issueNumber);
  const authoritativeDecision = {
    ...validateTriageDecision(decision),
    issueSnapshotSha256: manifest.issueSnapshotSha256
  };
  const changes = triageLabelChanges(config, authoritativeDecision, issueLabels(issue));

  const comment = upsertManagedComment({
    config,
    number: issueNumber,
    marker: config.comments.triage,
    body: triageBody(authoritativeDecision),
    dryRun
  });
  const added = addLabels(config, issueNumber, changes.add, dryRun);
  const removed = removeLabels(config, issueNumber, changes.remove, dryRun);
  let dispatch = null;
  if (changes.add.includes(config.labels.implement) && !dryRun) {
    try {
      const { issue: currentIssue } = fetchIssue(config, issueNumber);
      assertTriageSnapshot(currentIssue, manifest, issueNumber);
    } catch (error) {
      addLabels(config, issueNumber, [config.labels.blocked], false);
      removeLabels(config, issueNumber, [config.labels.implement, config.labels.automerge], false);
      throw error;
    }
    dispatch = dispatchWorkflow(config, "agent-implement.yml", { "issue-number": issueNumber }, false);
  }
  return {
    decision: authoritativeDecision,
    comment,
    added,
    removed,
    dispatch,
    blocked: changes.blocked
  };
}

export function markTriageFailed(config, issueNumber, dryRun = false) {
  const { issue } = fetchIssue(config, issueNumber);
  const snapshotSha256 = issueSnapshotSha256(issue);
  return {
    comment: upsertManagedComment({
      config,
      number: issueNumber,
      marker: config.comments.triage,
      body: failedBody(snapshotSha256),
      dryRun
    }),
    added: addLabels(config, issueNumber, [config.labels.blocked], dryRun),
    removed: removeLabels(config, issueNumber, [config.labels.implement, config.labels.automerge], dryRun),
    snapshotSha256
  };
}

async function main() {
  const args = parseArgs();
  const config = loadConfig();
  const issueNumber = Number(args["issue-number"]);
  if (!Number.isInteger(issueNumber)) throw new AgentError("missing --issue-number", 2);
  const dryRun = Boolean(args["dry-run"]);

  if (args.prepare) {
    if (!args["write-manifest"] || (!args.lightweight && !args["write-prompt"])) {
      throw new AgentError("--prepare requires --write-manifest and a prompt unless --lightweight", 2);
    }
    const result = prepareTriage(
      config,
      issueNumber,
      args.lightweight ? "" : args["write-prompt"],
      args["write-manifest"],
      dryRun
    );
    finish({ ok: true, message: `prepared triage for #${issueNumber}`, ...result }, Boolean(args.json));
    return;
  }

  if (args["mark-failed"]) {
    const result = markTriageFailed(config, issueNumber, dryRun);
    finish({ ok: true, message: `marked triage failed for #${issueNumber}`, ...result }, Boolean(args.json));
    return;
  }

  if (args["write-lightweight"]) {
    if (!args.manifest) throw new AgentError("--write-lightweight requires --manifest", 2);
    const decision = writeLightweightTriageDecision(
      config,
      issueNumber,
      args.manifest,
      args["write-lightweight"]
    );
    finish(
      {
        ok: true,
        message: `wrote lightweight triage for #${issueNumber}`,
        outputPath: args["write-lightweight"],
        decision
      },
      Boolean(args.json)
    );
    return;
  }

  const fromFile = args["from-file"];
  if (!fromFile || !args.manifest) throw new AgentError("missing --from-file or --manifest", 2);
  const decision = parseAuthoritativeTriageJson(readText(fromFile));
  const applied = applyDecision(config, issueNumber, decision, args.manifest, dryRun);
  finish(
    {
      ok: true,
      message: `${dryRun ? "would apply" : "applied"} triage for #${issueNumber}`,
      decision: applied.decision,
      applied
    },
    Boolean(args.json)
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => fail(error, Boolean(parseArgs().json)));
}
