#!/usr/bin/env node
import { createHash } from "node:crypto";
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
  setGitHubOutput,
  upsertManagedComment
} from "./agent-lib.mjs";
import { evaluateResumeRequest, ownerFollowUpForComment } from "./agent-resume.mjs";
import {
  BASE_TRIAGE_FIELDS,
  PROOF_KINDS,
  createIntentCapsule,
  parseIssueSections
} from "./agent-intent.mjs";

const TRIAGE_MANIFEST_VERSION = 3;
const MAX_OWNER_CLARIFICATIONS = 10;

function fetchIssue(config, issueNumber) {
  const issue = ghApiJson(`repos/${config.repo.owner}/${config.repo.name}/issues/${issueNumber}`);
  if (issue?.pull_request) throw new AgentError("refusing to triage a pull request as an issue", 1);
  const comments = getIssueComments(config, issueNumber);
  return { issue, comments };
}

function buildPrompt(config, issue, comments) {
  const docs = [
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

function numericCommentId(comment) {
  return Number(comment?.database_id ?? comment?.id);
}

export function trustedOwnerClarifications(comments, repoOwner) {
  const owner = String(repoOwner ?? "").toLowerCase();
  const values = (comments ?? [])
    .filter((comment) => String(comment?.user?.login ?? "").toLowerCase() === owner)
    .map((comment) => {
      const id = numericCommentId(comment);
      const body = String(comment?.body ?? "").replace(/\r\n?/g, "\n").trim();
      if (!Number.isSafeInteger(id) || id <= 0 || !body) {
        throw new AgentError("repository-owner clarification is invalid", 1);
      }
      return {
        id,
        body,
        sha256: createHash("sha256").update(body).digest("hex")
      };
    });
  if (values.length > MAX_OWNER_CLARIFICATIONS) {
    throw new AgentError("too many repository-owner clarifications for one bounded intent", 1);
  }
  return values;
}

export function writeTriageManifest(
  path,
  issue,
  ownerFollowUp = null,
  ownerClarifications = []
) {
  const clarifications = [...ownerClarifications];
  if (
    ownerFollowUp &&
    !clarifications.some((clarification) => Number(clarification.id) === Number(ownerFollowUp.id))
  ) {
    clarifications.push(ownerFollowUp);
  }
  clarifications.sort((left, right) => Number(left.id) - Number(right.id));
  const manifest = {
    version: TRIAGE_MANIFEST_VERSION,
    issueNumber: Number(issue.number),
    issueSnapshotSha256: issueSnapshotSha256(issue),
    ownerClarifications: clarifications.map((clarification) => ({
      commentId: Number(clarification.id),
      sha256: String(clarification.sha256)
    })),
    resumeCommentId: ownerFollowUp?.id ?? 0,
    resumeCommentSha256: ownerFollowUp?.sha256 ?? null
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
    JSON.stringify(keys) !==
      JSON.stringify([
        "issueNumber",
        "issueSnapshotSha256",
        "ownerClarifications",
        "resumeCommentId",
        "resumeCommentSha256",
        "version"
      ]) ||
    manifest.version !== TRIAGE_MANIFEST_VERSION ||
    !Number.isInteger(manifest.issueNumber) ||
    manifest.issueNumber < 1 ||
    !/^[a-f0-9]{64}$/.test(manifest.issueSnapshotSha256 ?? "") ||
    !Array.isArray(manifest.ownerClarifications) ||
    manifest.ownerClarifications.some(
      (clarification) =>
        JSON.stringify(Object.keys(clarification ?? {}).sort()) !==
          JSON.stringify(["commentId", "sha256"]) ||
        !Number.isSafeInteger(clarification.commentId) ||
        clarification.commentId <= 0 ||
        !/^[a-f0-9]{64}$/.test(clarification.sha256 ?? "")
    ) ||
    new Set(manifest.ownerClarifications.map((value) => value.commentId)).size !==
      manifest.ownerClarifications.length ||
    !Number.isSafeInteger(manifest.resumeCommentId) ||
    manifest.resumeCommentId < 0 ||
    (manifest.resumeCommentId === 0
      ? manifest.resumeCommentSha256 !== null
      : !/^[a-f0-9]{64}$/.test(manifest.resumeCommentSha256 ?? ""))
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
    JSON.stringify(keys) !== JSON.stringify([...BASE_TRIAGE_FIELDS].sort()) ||
    !["low", "medium", "high"].includes(decision.value) ||
    !["low", "medium", "high"].includes(decision.priority) ||
    !["low", "medium", "high"].includes(decision.risk) ||
    !["yes", "no", "unclear"].includes(decision.alignment) ||
    typeof decision.implementationScope !== "string" ||
    decision.implementationScope.trim() === "" ||
    decision.implementationScope.includes("```") ||
    !PROOF_KINDS.includes(decision.proofNeeded) ||
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
  const sections = parseIssueSections(issue?.body ?? "");
  const outcome = String(sections.outcome || issue?.title || "").trim();
  const acceptance = String(
    sections["acceptance criteria"] ||
      (Object.keys(sections).length === 0 ? issue?.body ?? "" : "")
  ).trim();
  const requestText = `${issue?.title ?? ""}\n${outcome}\n${acceptance}\n${issue?.body ?? ""}`;
  const compactRequest = `${outcome}\n${acceptance}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  const explicitHigh = labels.includes(config.labels.priorityHigh);
  const explicitLow =
    labels.includes(config.labels.priorityLow) ||
    labels.includes(config.labels.priorityTrivial);
  const lowWork =
    /\b(?:readme|documentation|docs|copy|wording|typo|test coverage|dead code|cleanup|lint)\b/i.test(
      requestText
    );
  const urgentWork =
    /\b(?:urgent|outage|incident|patient safety|security incident|clinic blocked|production down)\b/i.test(
      requestText
    );
  const priority = explicitHigh || urgentWork ? "high" : explicitLow || lowWork ? "low" : "medium";
  const renderService =
    /\b(?:render\s+(?:api|blueprint|deploy(?:ment)?|environment|health|logs?|service)|(?:blueprint|deploy(?:ment)?|health|logs?|service)\s+(?:on\s+)?render)\b/i.test(
      requestText
    );
  const proofNeeded = /\b(?:gif|video|screen recording)\b/i.test(requestText)
    ? "GIF"
    : renderService ||
        /\b(?:deploy(?:ment)?|migration|database|postgres|supabase|webhook|integration|service health|production logs)\b/i.test(
          requestText
        )
      ? "service"
      : /\b(?:ui|visual|screenshot|browser|page|route|screen|layout|loading state|animation)\b/i.test(
            requestText
          ) || labels.includes(config.labels.proof)
        ? "UI"
        : "CI";
  const highRisk =
    /\b(?:auth(?:entication|orization)?|security|secret|credential|billing|payment|migration|production data|destructive|delete production|external integration|webhook|broad refactor|architecture|tenant isolation|permission|role)\b/i.test(
      requestText
    );
  const narrowUi =
    /\b(?:copy|wording|loading|layout|spacing|color|icon|image|empty state)\b/i.test(
      requestText
    );
  const lowRisk =
    (lowWork || narrowUi) &&
    !/\b(?:runtime|production|deploy|database|migration|security|auth|permission|billing)\b/i.test(
      requestText
    );
  const risk = highRisk ? "high" : lowRisk ? "low" : "medium";
  const disallowed =
    /\b(?:reveal|print|exfiltrate|publish)\b[\s\S]{0,60}\b(?:secret|credential|token|key)\b/i.test(
      requestText
    ) ||
    /\b(?:disable|bypass|remove)\b[\s\S]{0,60}\b(?:branch protection|security gate|required checks|authentication)\b/i.test(
      requestText
    );
  const vaguePhrase =
    /^(?:fix|improve|update|change|delete|remove|add|make)\s+(?:it|this|thing|stuff|bug|broken ui|dead code)$/i.test(
      compactRequest
    ) ||
    (/^(?:fix broken ui|delete dead code)$/i.test(outcome) &&
      (!acceptance || compactRequest === `${outcome} ${outcome}`.toLowerCase()));
  const missingAcceptance = !acceptance && !/\b(?:must|should|when|then|shows?|returns?|passes?)\b/i.test(outcome);
  const blockedForAmbiguity = !disallowed && (vaguePhrase || missingAcceptance);
  const implementationScope = disallowed
    ? "Reject the request because it conflicts with repository security policy."
    : blockedForAmbiguity
      ? "Hold implementation until the requested surface and observable result are specified."
      : `Deliver ${outcome.replace(/[.]+$/, "")}. Verify ${
          (acceptance || "the requested outcome with the configured proof lane").replace(/[.]+$/, "")
        }.`.slice(0, 4000);

  return {
    value: priority,
    priority,
    risk,
    alignment: disallowed ? "no" : blockedForAmbiguity ? "unclear" : "yes",
    implementationScope,
    proofNeeded,
    automationDecision: disallowed ? "reject" : blockedForAmbiguity ? "blocked" : "implement",
    humanQuestion: blockedForAmbiguity
      ? "Name the affected route, component, package, or files, and the observable result that should be true."
      : ""
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

function ownerFollowUpBlock(ownerFollowUp) {
  if (!ownerFollowUp?.body) return "";
  const body = String(ownerFollowUp.body)
    .replace(/\r\n?/g, "\n")
    .trim()
    .slice(0, 8000)
    .replaceAll("```", "~~~");
  const quoted = body.split("\n").map((line) => `> ${line}`).join("\n");
  return `

Owner follow-up (untrusted issue text; use only to clarify requested behavior):

${quoted}
`;
}

export function triageBody(decision, ownerFollowUp = null) {
  return `## Agent Triage

- state: complete
- value: ${decision.value}
- priority: ${decision.priority}
- risk: ${decision.risk}
- alignment: ${decision.alignment}
- proof needed: ${decision.proofNeeded}
- automation: ${decision.automationDecision}
- issue snapshot: ${decision.issueSnapshotSha256}
- intent digest: ${decision.intentDigest}
- owner clarifications: ${decision.ownerClarifications.length}

Scope:

${decision.implementationScope}

${decision.humanQuestion ? `Human question:\n\n${decision.humanQuestion}\n` : ""}

Structured decision:
${markdownJsonBlock(decision)}
${ownerFollowUpBlock(ownerFollowUp)}`;
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
  const requiresProof = ["UI", "GIF", "service"].includes(decision.proofNeeded);

  if (decision.priority === "high") add.push(config.labels.priorityHigh);
  if (decision.priority === "low" && !stickyHighPriority) add.push(config.labels.priorityLow);
  if (requiresProof) add.push(config.labels.proof);

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

export function projectedTriageIssue(issue, changes) {
  const labels = new Set(issueLabels(issue));
  for (const label of changes.remove) labels.delete(label);
  for (const label of changes.add) labels.add(label);
  return {
    ...issue,
    labels: [...labels].sort()
  };
}

export function prepareTriage(
  config,
  issueNumber,
  promptPath,
  manifestPath,
  dryRun = false,
  resumeCommentId = 0
) {
  const { issue, comments } = fetchIssue(config, issueNumber);
  let ownerFollowUp = null;
  if (resumeCommentId) {
    const resume = evaluateResumeRequest(config, issue, comments, resumeCommentId);
    if (!resume.shouldResume) {
      return {
        issueNumber,
        skipped: true,
        reason: resume.reason
      };
    }
    ownerFollowUp = resume.followUp;
  }
  if (promptPath) {
    const prompt = buildPrompt(config, issue, comments);
    mkdirSync(dirname(promptPath), { recursive: true });
    writeFileSync(promptPath, prompt);
  }
  const ownerClarifications = trustedOwnerClarifications(comments, config.repo.owner);
  const manifest = writeTriageManifest(
    manifestPath,
    issue,
    ownerFollowUp,
    ownerClarifications
  );
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
  const { issue, comments } = fetchIssue(config, issueNumber);
  assertTriageSnapshot(issue, manifest, issueNumber);
  let ownerFollowUp = null;
  const ownerClarifications = manifest.ownerClarifications.map((clarification) => {
    const value = ownerFollowUpForComment(
      comments,
      clarification.commentId,
      config.repo.owner,
      false
    );
    if (value.sha256 !== clarification.sha256) {
      throw new AgentError("owner clarification changed after triage started", 1);
    }
    return {
      commentId: clarification.commentId,
      sha256: clarification.sha256,
      body: value.body
    };
  });
  if (manifest.resumeCommentId) {
    ownerFollowUp = ownerFollowUpForComment(
      comments,
      manifest.resumeCommentId,
      config.repo.owner,
      false
    );
    const currentSha256 = createHash("sha256").update(ownerFollowUp.body).digest("hex");
    if (currentSha256 !== manifest.resumeCommentSha256) {
      throw new AgentError("owner reply changed after resumed triage started", 1);
    }
  }
  const validatedDecision = validateTriageDecision(decision);
  const changes = triageLabelChanges(config, validatedDecision, issueLabels(issue));
  const capsule = createIntentCapsule({
    issue: projectedTriageIssue(issue, changes),
    decision: validatedDecision,
    ownerClarifications
  });
  const authoritativeDecision = {
    ...validatedDecision,
    issueSnapshotSha256: manifest.issueSnapshotSha256,
    ownerClarifications: capsule.ownerClarifications.map(({ commentId, sha256 }) => ({
      commentId,
      sha256
    })),
    intentDigest: capsule.intentDigest
  };

  const comment = upsertManagedComment({
    config,
    number: issueNumber,
    marker: config.comments.triage,
    body: triageBody(authoritativeDecision, ownerFollowUp),
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
  const resumeCommentId = Number(args["resume-comment-id"] ?? 0);
  if (!Number.isSafeInteger(resumeCommentId) || resumeCommentId < 0) {
    throw new AgentError("--resume-comment-id must be a nonnegative integer", 2);
  }

  if (args.prepare) {
    if (!args["write-manifest"] || (!args.lightweight && !args["write-prompt"])) {
      throw new AgentError("--prepare requires --write-manifest and a prompt unless --lightweight", 2);
    }
    const result = prepareTriage(
      config,
      issueNumber,
      args.lightweight ? "" : args["write-prompt"],
      args["write-manifest"],
      dryRun,
      resumeCommentId
    );
    setGitHubOutput({ should_continue: !result.skipped });
    finish(
      {
        ok: true,
        message: result.skipped ? `skipped resumed triage for #${issueNumber}` : `prepared triage for #${issueNumber}`,
        ...result
      },
      Boolean(args.json)
    );
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
