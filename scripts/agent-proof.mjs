#!/usr/bin/env node
import { createHash } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync
} from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AgentError,
  addLabels,
  dispatchWorkflow,
  extractJson,
  fail,
  finish,
  getIssueComments,
  getPullRequest,
  getPullSnapshot,
  gh,
  ghApiJson,
  ghReadJson,
  issueLabels,
  loadConfig,
  markdownJsonBlock,
  newestManagedComment,
  parseArgs,
  parseImplementationMetadata,
  removeLabels,
  runCommand,
  runShell,
  setCommitStatus,
  setGitHubOutput,
  upsertManagedComment
} from "./agent-lib.mjs";
import { runCrabboxLane } from "./agent-crabbox-run.mjs";
import {
  checkEvidenceLanes,
  combineBehaviorReports,
  commandBehaviorReport,
  requiredEvidenceLanes,
  validateBehaviorReport
} from "./agent-behavior-report.mjs";
import {
  PROOF_KINDS as INTENT_PROOF_KINDS,
  deriveAffectedRoutes,
  intentCapsuleForManagedTriage,
  normalizeExplicitRoute,
  parseImplementationAddendum,
  validateBrowserProofPlan,
  validateProofPlan
} from "./agent-intent.mjs";

const PROOF_KINDS = new Set(INTENT_PROOF_KINDS);
export { deriveAffectedRoutes };

function commentsFor(config, number) {
  return getIssueComments(config, number);
}

function managedJson(comments, marker, owner) {
  const comment = newestManagedComment(comments, marker, owner);
  if (!comment) return null;
  const body = String(comment.body ?? "");
  const afterMarker = body.slice(body.indexOf(marker) + marker.length);
  const fences = [...afterMarker.matchAll(/```json\s*([\s\S]*?)```/gi)];
  for (const fence of fences.reverse()) {
    try {
      return extractJson(fence[1]);
    } catch {
      // Ignore malformed stale output and continue to the next structured block.
    }
  }
  return null;
}

function implementationSourceIssue(body) {
  const marker = "<!-- agent-implementation:v1 -->";
  const text = String(body ?? "");
  const index = text.indexOf(marker);
  if (index === -1) return null;
  const fence = text.slice(index + marker.length).match(/```json\s*([\s\S]*?)```/i);
  if (!fence) return null;
  try {
    const number = Number(extractJson(fence[1]).sourceIssue);
    return Number.isInteger(number) && number > 0 ? number : null;
  } catch {
    return null;
  }
}

function sourceIssueNumber(config, pull) {
  const metadataNumber = implementationSourceIssue(pull.body);
  if (metadataNumber) return metadataNumber;
  const closing = ghReadJson([
    "pr",
    "view",
    String(pull.number),
    "--repo",
    `${config.repo.owner}/${config.repo.name}`,
    "--json",
    "closingIssuesReferences"
  ]);
  const sameRepo = (closing?.closingIssuesReferences ?? []).filter(
    (reference) =>
      !reference.repository?.nameWithOwner ||
      String(reference.repository.nameWithOwner).toLowerCase() === `${config.repo.owner}/${config.repo.name}`.toLowerCase()
  );
  return sameRepo.length === 1 ? Number(sameRepo[0].number) : null;
}

function targetDetails(config, kind, number) {
  if (kind === "pr") {
    const { pull, files } = getPullSnapshot(config, number);
    const headRepo = String(pull.head?.repo?.full_name ?? "").toLowerCase();
    const baseRepo = String(pull.base?.repo?.full_name ?? "").toLowerCase();
    if (!headRepo || headRepo !== baseRepo) {
      throw new AgentError("refusing proof run for cross-repository PR", 1, {
        head: pull.head?.repo?.full_name ?? "unknown",
        base: pull.base?.repo?.full_name ?? "unknown"
      });
    }
    const issue = ghApiJson(`repos/${config.repo.owner}/${config.repo.name}/issues/${number}`);
    const sourceNumber = sourceIssueNumber(config, pull);
    const source = sourceNumber
      ? {
          issue: ghApiJson(`repos/${config.repo.owner}/${config.repo.name}/issues/${sourceNumber}`),
          comments: commentsFor(config, sourceNumber)
        }
      : null;
    if (!source) throw new AgentError("proof target has no trusted source issue", 1);
    const triageComment = newestManagedComment(
      source.comments,
      config.comments.triage,
      config.repo.owner
    );
    if (!triageComment) {
      throw new AgentError("proof target has no trusted managed triage", 1);
    }
    const { capsule } = intentCapsuleForManagedTriage({
      issue: source.issue,
      comments: source.comments,
      triageComment,
      marker: config.comments.triage,
      repoOwner: config.repo.owner
    });
    const metadata = parseImplementationMetadata(pull.body);
    const implementationAddendum = parseImplementationAddendum(pull.body);
    if (
      metadata.intentDigest !== capsule.intentDigest ||
      metadata.implementationAddendumDigest !== implementationAddendum.digest
    ) {
      throw new AgentError(
        "proof intent context does not match immutable implementation metadata",
        1
      );
    }
    return {
      title: pull.title,
      body: pull.body ?? "",
      labels: issueLabels(issue),
      comments: commentsFor(config, number),
      source,
      intentCapsule: capsule,
      implementationAddendum,
      files,
      sha: pull.head.sha,
      pull
    };
  }
  const issue = ghApiJson(`repos/${config.repo.owner}/${config.repo.name}/issues/${number}`);
  return {
    title: issue.title,
    body: issue.body ?? "",
    labels: issueLabels(issue),
    comments: commentsFor(config, number),
    source: null,
    files: [],
    sha: null
  };
}

export function untrustedCodeEnvironment(config, source = process.env) {
  const env = { ...source };
  const configuredSecrets = new Set(
    [
      config?.secrets?.agentAuth,
      config?.secrets?.githubWrite,
      config?.secrets?.githubPublisher,
      config?.secrets?.githubPat,
      config?.secrets?.crabboxCoordinator,
      ...(config?.secrets?.crabboxProviders ?? []),
      ...(config?.secrets?.vercel ?? []),
      "GH_TOKEN",
      "GITHUB_TOKEN",
      "AGENT_GITHUB_TOKEN",
      "AGENT_PAT",
      "OPENAI_API_KEY",
      "CODEX_API_KEY",
      "CRABBOX_COORDINATOR_TOKEN",
      "HCLOUD_TOKEN",
      "HETZNER_TOKEN",
      "HETZNER_API_TOKEN",
      "VERCEL_TOKEN",
      "VERCEL_OIDC_TOKEN"
    ].filter(Boolean)
  );
  for (const name of Object.keys(env)) {
    if (configuredSecrets.has(name) || name.startsWith("GITHUB_") || name.startsWith("ACTIONS_")) {
      delete env[name];
    }
  }
  return env;
}

function proofEnvironment(config) {
  return untrustedCodeEnvironment(config);
}

function checkoutPullHead(pull) {
  if (pull.head.repo.full_name !== pull.base.repo.full_name) {
    throw new AgentError("refusing proof run for cross-repository PR", 1, {
      head: pull.head.repo.full_name,
      base: pull.base.repo.full_name
    });
  }
  runCommand("gh", ["auth", "setup-git", "--hostname", "github.com"]);
  runCommand("git", ["fetch", "origin", pull.head.ref]);
  runCommand("git", ["switch", "-C", pull.head.ref, "FETCH_HEAD"]);
}

export function structuredProofKind(config, details) {
  const candidates = [
    managedJson(details.comments, config.comments.review, config.repo?.owner)?.proofNeeded,
    managedJson(details.source?.comments, config.comments.triage, config.repo?.owner)?.proofNeeded,
    managedJson(details.comments, config.comments.triage, config.repo?.owner)?.proofNeeded
  ];
  return candidates.find((value) => PROOF_KINDS.has(value)) ?? null;
}

export function isProofRequested(config, details, explicit = false) {
  return explicit || details.labels.includes(config.labels.proof);
}

function requestedProofKind(config, details, explicitKind) {
  if (explicitKind) {
    if (!PROOF_KINDS.has(explicitKind)) throw new AgentError(`invalid proof kind: ${explicitKind}`, 2);
    return explicitKind === "none" ? "CI" : explicitKind;
  }
  const structured = structuredProofKind(config, details);
  return !structured || structured === "none" ? "CI" : structured;
}

function proofContract(details) {
  return details.intentCapsule?.behaviorContract ?? null;
}

function implementationProofPlan(details) {
  return validateProofPlan(
    details.implementationAddendum?.intentAddendum?.proofPlan ?? {
      version: 1,
      tasks: []
    }
  );
}

export function visualRoutes(details, explicitRoute = "") {
  const plannedRoutes = implementationProofPlan(details).tasks.map(
    (task) => task.route
  );
  const explicitRoutes = deriveAffectedRoutes([], explicitRoute);
  if (
    explicitRoutes.length &&
    plannedRoutes.some((route) => route !== explicitRoutes[0])
  ) {
    throw new AgentError(
      `explicit proof route ${explicitRoutes[0]} does not match the implementation browser plan`,
      1
    );
  }
  let routes = plannedRoutes;
  if (!routes.length) {
    routes = explicitRoutes.length
      ? explicitRoutes
      : [
          ...deriveAffectedRoutes(details.files),
          ...(proofContract(details)?.routes ?? [])
        ];
  }
  return [...new Set(routes)].sort();
}

export function validateVisualBehaviorPlan({
  proofKind,
  routes,
  behaviorContract,
  proofPlan,
  evidenceLanes = null
}) {
  return validateBrowserProofPlan({
    proofKind,
    routes,
    behaviorContract,
    proofPlan,
    evidenceLanes
  });
}

function browserBehaviorReport({ contract, observations, routes }) {
  const results = observations.flatMap((observation) => observation.taskResults);
  const checks = contract.checks.map((check) => {
    const browserAssigned = checkEvidenceLanes(check, contract).includes(
      "browser"
    );
    const matching = results.filter((result) => result.clauseIds.includes(check.id));
    const status =
      !browserAssigned
        ? "out_of_scope"
        : matching.length === 0
        ? "blocked"
        : matching.every((result) => result.status === "pass")
          ? "pass"
          : "fail";
    return {
      contract_clause: `${check.id}: ${check.statement}`,
      status,
      severity: status === "fail" ? "high" : null,
      evidence:
        !browserAssigned
          ? "This clause is assigned to a non-browser evidence lane."
          : matching.length === 0
          ? "No route-bound browser task returned evidence for this clause."
          : matching.map((result) => `${result.route}: ${result.evidence}`).join(" "),
      reproduction_steps: browserAssigned
        ? matching.flatMap((result) => result.reproductionSteps)
        : [],
      confidence:
        status === "pass" ? 0.95 : status === "out_of_scope" ? 1 : 0.99
    };
  });
  const statuses = checks.map((check) => check.status);
  const blocked = statuses.includes("blocked");
  const failed = statuses.includes("fail");
  return validateBehaviorReport(
    {
      overall_behavior: failed
        ? "violates_contract"
        : blocked
          ? "blocked"
          : "satisfies_contract",
      overall_confidence: failed || blocked ? 0.99 : 0.95,
      target: {
        type: "web app",
        access: routes.map((route) => `http://127.0.0.1:3000${route}`).join(", ")
      },
      checks,
      anti_cheat_probes: observations.flatMap(
        (observation) => observation.antiCheatProbes
      ),
      blockers: blocked
        ? ["At least one sealed contract clause produced no browser evidence."]
        : []
    },
    contract
  );
}

function artifactRecordName(path) {
  const normalized = resolve(path).replaceAll("\\", "/");
  const marker = "/.agent-output/";
  const index = normalized.lastIndexOf(marker);
  return index === -1
    ? basename(path)
    : normalized.slice(index + marker.length);
}

function artifactDigestRecords(paths) {
  return paths
    .filter((path) => {
      try {
        return readFileSync(path).length > 0;
      } catch {
        return false;
      }
    })
    .map((path) => ({
      name: artifactRecordName(path),
      sha256: createHash("sha256").update(readFileSync(path)).digest("hex")
    }));
}

function publishedArtifactFiles(root) {
  const base = resolve(root);
  const baseInfo = lstatSync(base);
  if (!baseInfo.isDirectory() || baseInfo.isSymbolicLink()) {
    throw new AgentError("published proof artifact directory is invalid", 1);
  }
  const realBase = realpathSync(base);
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new AgentError("published proof artifact contains a symlink", 1);
      }
      if (entry.isDirectory()) {
        visit(path);
        continue;
      }
      const info = lstatSync(path);
      if (!info.isFile() || info.size <= 0) {
        throw new AgentError("published proof artifact contains an invalid file", 1);
      }
      const realPath = realpathSync(path);
      const offset = relative(realBase, realPath);
      if (!offset || offset.startsWith("..")) {
        throw new AgentError("published proof artifact path escapes its bundle", 1);
      }
      files.push({
        name: offset.replaceAll("\\", "/"),
        path: realPath,
        sha256: createHash("sha256")
          .update(readFileSync(realPath))
          .digest("hex")
      });
    }
  };
  visit(base);
  return files.sort((left, right) => left.name.localeCompare(right.name));
}

function publishedMediaKind(name) {
  const extension = extname(name).toLowerCase();
  if (extension === ".gif") return "gif";
  if (extension === ".mp4" || extension === ".webm") return "video";
  if (extension === ".png") return "screenshot";
  return "";
}

function ffprobePublishedMedia(path, kind) {
  const probe = runCommand(
    "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-count_frames",
      "-show_entries",
      "stream=codec_name,width,height,nb_read_frames,duration:format=duration",
      "-of",
      "json",
      path
    ],
    { check: false }
  );
  if (probe.status !== 0) {
    throw new AgentError(`published ${kind} proof media is not playable`, 1);
  }
  let value;
  try {
    value = JSON.parse(probe.stdout);
  } catch {
    throw new AgentError(`published ${kind} proof media probe is invalid`, 1);
  }
  const stream = value?.streams?.[0];
  const codec = String(stream?.codec_name ?? "");
  const width = Number(stream?.width);
  const height = Number(stream?.height);
  const frames = Number(stream?.nb_read_frames ?? 0);
  const durationSeconds = Number(
    stream?.duration ?? value?.format?.duration ?? 0
  );
  const expectedCodec =
    kind === "gif" ? "gif" : kind === "screenshot" ? "png" : "";
  if (
    !stream ||
    !codec ||
    (expectedCodec && codec !== expectedCodec) ||
    !Number.isFinite(width) ||
    width <= 0 ||
    !Number.isFinite(height) ||
    height <= 0 ||
    (kind === "gif" && (!Number.isFinite(frames) || frames < 2)) ||
    (kind === "video" &&
      (!Number.isFinite(durationSeconds) || durationSeconds <= 0))
  ) {
    throw new AgentError(`published ${kind} proof media is not playable`, 1);
  }
  return {
    codec,
    width,
    height,
    frames: Number.isFinite(frames) ? frames : 0,
    durationSeconds: Number.isFinite(durationSeconds)
      ? durationSeconds
      : 0
  };
}

export function validatePublishedMedia({
  request,
  remoteOutcome,
  artifactDir,
  probe = ffprobePublishedMedia
}) {
  validateRequest(request);
  if (!request.evidenceLanes.includes("browser")) {
    throw new AgentError("published media validation requires browser proof", 1);
  }
  if (remoteOutcome?.terminal !== true) {
    throw new AgentError("published media validation has no terminal remote proof", 1);
  }
  const remoteResult = normalizeResult(remoteOutcome.result, request);
  if (remoteResult.status !== "passed") {
    throw new AgentError("published media validation requires passing remote proof", 1);
  }
  const files = publishedArtifactFiles(artifactDir);
  const expected = remoteResult.artifactDigests;
  const expectedFor = (file) => {
    const exact = expected.filter((record) => record.name === file.name);
    if (exact.length === 1) return exact[0];
    const byBasename = expected.filter(
      (record) => basename(record.name) === basename(file.name)
    );
    return byBasename.length === 1 ? byBasename[0] : null;
  };
  for (const record of expected) {
    const exact = files.filter((file) => file.name === record.name);
    const matches = exact.length
      ? exact
      : files.filter(
          (file) => basename(file.name) === basename(record.name)
        );
    if (
      matches.length !== 1 ||
      matches[0].sha256 !== record.sha256
    ) {
      throw new AgentError(
        `published proof artifact digest mismatch: ${record.name}`,
        1
      );
    }
  }
  const headMarker = `AGENT_PROOF_HEAD_OK ${request.sha}`;
  if (
    request.kind === "pr" &&
    !files.some(
      (file) =>
        extname(file.name).toLowerCase() === ".log" &&
        readFileSync(file.path, "utf8").includes(headMarker)
    )
  ) {
    throw new AgentError(
      "published proof artifact is not bound to the exact pull request head",
      1
    );
  }
  const media = files
    .map((file) => ({ ...file, kind: publishedMediaKind(file.name) }))
    .filter((file) => file.kind);
  const requiredKinds =
    request.proofKind === "GIF"
      ? ["gif", "video"]
      : ["screenshot"];
  for (const kind of requiredKinds) {
    if (!media.some((file) => file.kind === kind)) {
      throw new AgentError(
        `published proof artifact has no reviewable ${kind} media`,
        1
      );
    }
  }
  const verifiedFiles = media.map((file) => {
    const expectedRecord = expectedFor(file);
    if (!expectedRecord || expectedRecord.sha256 !== file.sha256) {
      throw new AgentError(
        `published proof media digest mismatch: ${file.name}`,
        1
      );
    }
    return {
      name: file.name,
      sha256: file.sha256,
      kind: file.kind,
      ...probe(file.path, file.kind)
    };
  });
  return {
    version: 1,
    status: "passed",
    headSha: request.sha,
    proofKind: request.proofKind,
    files: verifiedFiles,
    summary: `Downloaded and opened ${verifiedFiles.length} exact-head proof media file(s).`
  };
}

export function validatePublishedMediaOutcome(
  outcome,
  request,
  proofResult = null
) {
  if (
    !outcome ||
    Array.isArray(outcome) ||
    JSON.stringify(Object.keys(outcome).sort()) !==
      JSON.stringify(
        ["files", "headSha", "proofKind", "status", "summary", "version"].sort()
      ) ||
    outcome.version !== 1 ||
    outcome.status !== "passed" ||
    outcome.headSha !== request.sha ||
    outcome.proofKind !== request.proofKind ||
    typeof outcome.summary !== "string" ||
    !outcome.summary ||
    !Array.isArray(outcome.files) ||
    outcome.files.length === 0 ||
    outcome.files.some(
      (file) =>
        !file ||
        typeof file.name !== "string" ||
        !file.name ||
        !/^[a-f0-9]{64}$/.test(file.sha256 ?? "") ||
        !["gif", "video", "screenshot"].includes(file.kind) ||
        typeof file.codec !== "string" ||
        !file.codec ||
        !Number.isFinite(file.width) ||
        file.width <= 0 ||
        !Number.isFinite(file.height) ||
        file.height <= 0 ||
        !Number.isFinite(file.frames) ||
        file.frames < 0 ||
        !Number.isFinite(file.durationSeconds) ||
        file.durationSeconds < 0 ||
        (file.kind === "gif" && file.frames < 2) ||
        (file.kind === "video" && file.durationSeconds <= 0)
    )
  ) {
    throw new AgentError("published proof media outcome is invalid", 1);
  }
  const requiredKinds =
    request.proofKind === "GIF"
      ? ["gif", "video"]
      : ["screenshot"];
  if (
    requiredKinds.some(
      (kind) => !outcome.files.some((file) => file.kind === kind)
    )
  ) {
    throw new AgentError("published proof media outcome is incomplete", 1);
  }
  if (
    proofResult &&
    outcome.files.some(
      (file) =>
        !proofResult.artifactDigests?.some(
          (record) =>
            record.sha256 === file.sha256 &&
            (record.name === file.name ||
              basename(record.name) === basename(file.name))
        )
    )
  ) {
    throw new AgentError(
      "published proof media outcome does not match the proof result",
      1
    );
  }
  return outcome;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

export function visualServerCommand(
  config,
  routes,
  { includeDeterministic = false } = {}
) {
  const probes = routes.flatMap((route) => {
    const url = `http://127.0.0.1:3000${route}`;
    return [
      "route_ready=0",
      `for attempt in $(seq 1 90); do route_status="$(curl -sS -o /dev/null -w '%{http_code}' ${shellQuote(url)} || true)"; case "$route_status" in 2??) echo ${shellQuote(`AGENT_PROOF_ROUTE_OK ${route}`)}; route_ready=1; break ;; esac; sleep 1; done`,
      'if [ "$route_ready" -ne 1 ]; then tail -n 80 /tmp/vet-agent-proof-next.log >&2 || true; exit 1; fi'
    ];
  });
  return [
    "set -eu",
    config.commands.install,
    config.commands.build,
    ...(includeDeterministic
      ? config.commands.proof.filter(
          (command) => command !== config.commands.build
        )
      : []),
    ...(includeDeterministic
      ? ["echo AGENT_PROOF_DETERMINISTIC_OK"]
      : []),
    "(nohup npm --workspace @central-vet/internal run start -- --port 3000 --hostname 127.0.0.1 >/tmp/vet-agent-proof-next.log 2>&1 </dev/null &)",
    ...probes
  ].join("; ");
}

export function validateArtifactUrl(value, config) {
  const candidate = String(value ?? "").trim();
  if (!candidate) return "";
  let url;
  try {
    url = new URL(candidate);
  } catch {
    throw new AgentError("proof artifact URL is invalid", 1);
  }
  const expectedPath = new RegExp(
    `^/${config.repo.owner}/${config.repo.name}/actions/runs/[0-9]+/artifacts/[0-9]+$`
  );
  if (
    url.protocol !== "https:" ||
    url.hostname !== "github.com" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !expectedPath.test(url.pathname)
  ) {
    throw new AgentError("proof artifact URL is outside the trusted GitHub Actions run", 1);
  }
  return url.toString();
}

export function proofBody(result, routes, timingRecord) {
  const timing = timingRecord
    ? `${timingRecord.totalMs}ms total, ${timingRecord.commandMs ?? 0}ms command`
    : "none";
  const artifactLabel =
    result.proofKind === "GIF"
      ? "Open reviewer GIF/video proof bundle"
      : result.proofKind === "UI"
        ? "Open reviewer visual proof bundle"
        : "Open or download the proof bundle";
  return `## Agent Proof

Status: ${result.status}
Kind: ${result.proofKind}
Provider: ${result.provider || "none"}
Lease: ${result.leaseId || "none"}
Timing: ${timing}

Routes:

${routes.length ? routes.map((route) => `- ${route}`).join("\n") : "- none"}

Commands:

${result.commands.length ? result.commands.map((command) => `- ${command}`).join("\n") : "- none"}

Artifacts:

${result.artifactUrl ? `- [${artifactLabel}](${result.artifactUrl})` : "- none"}

Artifact digests:

${result.artifactDigests?.length ? result.artifactDigests.map((record) => `- \`${record.sha256}\` ${record.name}`).join("\n") : "- none"}

Published media validation:

${result.publishedMedia?.files?.length ? result.publishedMedia.files.map((file) => `- ${file.kind}: \`${file.name}\` (${file.width}x${file.height}, ${file.codec}${file.frames ? `, ${file.frames} frames` : ""}${file.durationSeconds ? `, ${file.durationSeconds}s` : ""})`).join("\n") : "- none"}

<details>
<summary>Runner artifact inventory</summary>

${result.artifactPaths.length ? result.artifactPaths.map((path) => `- \`${path}\``).join("\n") : "- none"}
</details>

Summary:

${result.summary}

${result.blocker ? `Blocker:\n\n${result.blocker}\n` : ""}

Behavior contract results:

${result.behaviorReport?.checks?.length ? result.behaviorReport.checks.map((check) => `- ${check.status}: ${check.contract_clause}`).join("\n") : "- none"}

Structured behavior report:
${markdownJsonBlock(result.behaviorReport ?? null)}

Structured proof:
${markdownJsonBlock(result)}`;
}

export function proofLabelChanges(config, status, { repairing = false } = {}) {
  if ((status === "blocked" || status === "failed") && !repairing) {
    return { add: [config.labels.proofFailed], remove: [] };
  }
  if (status === "passed") {
    return { add: [], remove: [config.labels.proofFailed] };
  }
  return { add: [], remove: [] };
}

export function isProofHeadFresh(expectedSha, currentSha) {
  return Boolean(expectedSha && currentSha && expectedSha === currentSha);
}

export function mayMutateProofTarget(requestSha, currentSha, statusSha) {
  return isProofHeadFresh(requestSha, currentSha) && isProofHeadFresh(statusSha, requestSha);
}

export function proofRepairEligible(request, result, mayMutateTarget = true) {
  if (
    !mayMutateTarget ||
    request?.kind !== "pr" ||
    request?.requested !== true ||
    result?.status !== "failed" ||
    !request?.behaviorContract ||
    !result?.behaviorReport
  ) {
    return false;
  }
  try {
    const report = validateBehaviorReport(
      result.behaviorReport,
      request.behaviorContract,
    );
    return (
      report.overall_behavior === "violates_contract" &&
      report.target.access ===
        `pull request #${request.number} head ${request.sha}` &&
      report.checks.some((check) => check.status === "fail")
    );
  } catch {
    return false;
  }
}

async function legacyMain(args = parseArgs(), config = loadConfig()) {
  const kind = args["target-kind"] ?? args.kind;
  const number = Number(args["target-number"] ?? args.number);
  if (!["issue", "pr"].includes(kind)) throw new AgentError("missing --target-kind issue|pr", 2);
  if (!Number.isInteger(number) || number <= 0) throw new AgentError("missing --target-number", 2);
  if (args["artifact-path"] || args.provider || args["lease-id"]) {
    throw new AgentError("external artifact, provider, and lease claims are not accepted as proof", 2);
  }

  const dryRun = Boolean(args["dry-run"]);
  const run = Boolean(args.run);
  const explicit = Boolean(args.explicit);
  const details = targetDetails(config, kind, number);
  if (!isProofRequested(config, details, explicit)) {
    finish(
      {
        ok: true,
        message: `proof not requested for ${kind} #${number}`,
        result: { proofKind: "none", status: "skipped", reason: "missing agent:proof label or explicit dispatch" }
      },
      Boolean(args.json)
    );
    return;
  }

  const proofKind = requestedProofKind(config, details, args["proof-kind"]);
  const routes = proofKind === "UI" || proofKind === "GIF" ? deriveAffectedRoutes(details.files, args.route) : [];
  let timingRecord = null;
  const result = {
    proofKind,
    status: run && !dryRun ? "pending" : "skipped",
    commands: [],
    artifactPaths: [],
    artifactUrl: "",
    provider: "",
    leaseId: "",
    summary: dryRun ? "Proof dry run; no commands executed." : run ? "Proof has not completed." : "Proof requested but not run.",
    blocker: ""
  };

  if (run && !dryRun && kind === "pr") checkoutPullHead(details.pull);
  if (run && !dryRun) {
    const install = runShell(config.commands.install, { check: false, env: proofEnvironment(config) });
    result.commands.push(config.commands.install);
    if (install.status !== 0) {
      result.status = "failed";
      result.summary = `${config.commands.install} failed on the proof checkout`;
    }
  }

  if (result.status === "pending" && proofKind === "CI") {
    const remoteCommand = [config.commands.install, ...config.commands.proof].join(" && ");
    const remote = runCrabboxLane({ config, lane: "ciRemote", command: remoteCommand, dryRun });
    if (remote.attempted) {
      result.commands.push(`crabbox run (${remote.provider}) ${remoteCommand}`);
      for (const path of [remote.recordPath, remote.logPath]) {
        if (path) result.artifactPaths.push(path);
      }
    }
    if (remote.ok && remote.attempted) {
      result.status = "passed";
      result.provider = remote.provider;
      result.leaseId = remote.leaseId;
      timingRecord = remote.timing;
      result.summary = "Configured CI proof passed in Crabbox.";
    } else {
      const fallbackReason = remote.reason || "Crabbox provider unavailable";
      for (const command of config.commands.proof) {
        const output = runShell(command, { check: false, env: proofEnvironment(config) });
        result.commands.push(command);
        if (output.status !== 0) {
          result.status = "failed";
          result.summary = `${command} failed after GitHub-hosted fallback (${fallbackReason})`;
          break;
        }
      }
      if (result.status === "pending") {
        result.status = "passed";
        result.provider = "github-actions";
        result.summary = `GitHub-hosted CI proof passed; Crabbox fallback reason: ${fallbackReason}.`;
      }
    }
  }

  if (result.status === "pending" && (proofKind === "UI" || proofKind === "GIF")) {
    result.status = "blocked";
    result.blocker =
      "Direct visual proof has no sealed behavior plan. Dispatch the trusted Agent Proof workflow.";
    result.summary = "Visual proof did not run without semantic acceptance criteria.";
  }

  if (kind === "pr" && result.status === "passed" && run && !dryRun) {
    const current = getPullRequest(config, number);
    if (!isProofHeadFresh(details.sha, current.head.sha)) {
      result.status = "failed";
      result.summary = "PR head changed while proof was running; proof must rerun on the current head.";
      result.blocker = `Proof ran on ${details.sha}; current head is ${current.head.sha}.`;
    }
  }

  const comment = upsertManagedComment({
    config,
    number,
    marker: config.comments.proof,
    body: proofBody(result, routes, timingRecord),
    dryRun
  });
  const changes = proofLabelChanges(config, result.status);
  const labels = {
    added: addLabels(config, number, changes.add, dryRun),
    removed: removeLabels(config, number, changes.remove, dryRun)
  };
  const status =
    kind === "pr" && details.sha && result.status !== "skipped"
      ? setCommitStatus({
          config,
          sha: details.sha,
          state: result.status === "passed" ? "success" : "failure",
          context: "agent-proof",
          description: result.summary,
          dryRun
        })
      : null;
  const dispatch =
    kind === "pr" && result.status === "passed"
      ? dispatchWorkflow(
          config,
          "agent-automerge.yml",
          { "pr-number": number, "expected-head-sha": details.sha },
          dryRun,
          config.repo.defaultBranch
        )
      : null;
  const ok = result.status === "passed" || result.status === "skipped";
  finish(
    { ok, message: `proof ${result.status} for ${kind} #${number}`, result, comment, labels, status, dispatch },
    Boolean(args.json),
    ok ? 0 : 1
  );
}

function writeJsonFile(path, value) {
  if (!path) throw new AgentError("missing JSON output path", 2);
  const target = resolve(path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

function readJsonFile(path, label) {
  if (!path) throw new AgentError(`missing ${label}`, 2);
  try {
    return JSON.parse(readFileSync(resolve(path), "utf8"));
  } catch (error) {
    throw new AgentError(`invalid ${label}: ${error.message}`, 1);
  }
}

function encodeJson(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

function decodeJson(value, label) {
  if (!value) throw new AgentError(`missing ${label}`, 2);
  try {
    return JSON.parse(Buffer.from(String(value), "base64").toString("utf8"));
  } catch (error) {
    throw new AgentError(`invalid ${label}: ${error.message}`, 1);
  }
}

function readModeDocument(args, name) {
  const encoded = args[`${name}-base64`];
  if (encoded) return decodeJson(encoded, `${name} base64`);
  return readJsonFile(args[`${name}-file`], `${name} file`);
}

function validateRequest(request) {
  if (!request || typeof request !== "object") throw new AgentError("invalid proof request", 1);
  request.intentDigest ??= "";
  request.behaviorContract ??= null;
  request.proofPlan = validateProofPlan(
    request.proofPlan ?? { version: 1, tasks: [] }
  );
  request.evidenceLanes ??= request.behaviorContract
    ? requiredEvidenceLanes(request.behaviorContract)
    : request.proofKind === "UI" || request.proofKind === "GIF"
      ? ["browser"]
      : request.proofKind === "service"
        ? ["service"]
        : ["deterministic"];
  if (!["issue", "pr"].includes(request.kind)) throw new AgentError("invalid proof request kind", 1);
  if (!Number.isInteger(request.number) || request.number <= 0) throw new AgentError("invalid proof request number", 1);
  if (typeof request.requested !== "boolean") throw new AgentError("invalid proof request decision", 1);
  if (!PROOF_KINDS.has(request.proofKind) || request.proofKind === "none") {
    throw new AgentError("invalid proof request kind", 1);
  }
  if (!Array.isArray(request.routes) || request.routes.length > 50) throw new AgentError("invalid proof request routes", 1);
  if (
    !Array.isArray(request.evidenceLanes) ||
    request.evidenceLanes.length === 0 ||
    request.evidenceLanes.some(
      (lane) =>
        !["deterministic", "browser", "service"].includes(lane)
    ) ||
    new Set(request.evidenceLanes).size !== request.evidenceLanes.length ||
    JSON.stringify(request.evidenceLanes) !==
      JSON.stringify(
        request.behaviorContract
          ? requiredEvidenceLanes(request.behaviorContract)
          : request.evidenceLanes
      )
  ) {
    throw new AgentError("invalid proof request evidence lanes", 1);
  }
  for (const route of request.routes) {
    if (normalizeExplicitRoute(route) !== route) throw new AgentError(`invalid proof route: ${route}`, 1);
  }
  if (request.kind === "pr") {
    if (!/^[0-9a-f]{40}$/i.test(String(request.sha ?? "")) || request.checkoutRef !== request.sha) {
      throw new AgentError("invalid exact PR proof ref", 1);
    }
    if (
      request.behaviorContract &&
      (!/^[a-f0-9]{64}$/.test(request.intentDigest) ||
        !/^[a-f0-9]{64}$/.test(request.behaviorContract.contractDigest ?? "") ||
        !Array.isArray(request.behaviorContract.checks))
    ) {
      throw new AgentError("invalid sealed behavior proof context", 1);
    }
  }
  validateVisualBehaviorPlan(request);
  return request;
}

function baseResult(proofKind, overrides = {}) {
  return {
    proofKind,
    status: "pending",
    commands: [],
    artifactPaths: [],
    artifactUrl: "",
    provider: "",
    leaseId: "",
    summary: "Proof has not completed.",
    blocker: "",
    behaviorReport: null,
    evidenceLanes: [],
    artifactDigests: [],
    ...overrides
  };
}

function normalizeResult(result, request) {
  if (!result || typeof result !== "object") throw new AgentError("proof outcome has no result", 1);
  if (result.proofKind !== request.proofKind) throw new AgentError("proof outcome kind mismatch", 1);
  if (!["passed", "failed", "blocked", "skipped"].includes(result.status)) {
    throw new AgentError("proof outcome is not terminal", 1);
  }
  result.evidenceLanes ??=
    request.evidenceLanes.length === 1 ? [...request.evidenceLanes] : [];
  for (const name of ["commands", "artifactPaths", "evidenceLanes"]) {
    if (!Array.isArray(result[name]) || result[name].some((item) => typeof item !== "string")) {
      throw new AgentError(`proof outcome has invalid ${name}`, 1);
    }
  }
  if (
    new Set(result.evidenceLanes).size !== result.evidenceLanes.length ||
    result.evidenceLanes.some(
      (lane) => !request.evidenceLanes.includes(lane)
    )
  ) {
    throw new AgentError("proof outcome has invalid evidence lanes", 1);
  }
  result.artifactUrl ??= "";
  result.artifactDigests ??= [];
  result.behaviorReport ??= null;
  for (const name of ["artifactUrl", "provider", "leaseId", "summary", "blocker"]) {
    if (typeof result[name] !== "string") throw new AgentError(`proof outcome has invalid ${name}`, 1);
  }
  if (
    !Array.isArray(result.artifactDigests) ||
    result.artifactDigests.some(
      (record) =>
        typeof record?.name !== "string" ||
        !record.name ||
        !/^[a-f0-9]{64}$/.test(record?.sha256 ?? "")
    )
  ) {
    throw new AgentError("proof outcome has invalid artifact digests", 1);
  }
  if (result.behaviorReport) {
    validateBehaviorReport(result.behaviorReport, request.behaviorContract);
  } else if (
    request.requested &&
    request.behaviorContract &&
    result.status === "passed"
  ) {
    throw new AgentError("passing proof outcome has no behavior report", 1);
  }
  return result;
}

function terminalOutcome(result, timing = null) {
  return { terminal: true, needsLocal: false, result, timing };
}

export function terminalMarker(result, sha) {
  const success = result.status === "passed" || result.status === "skipped";
  return {
    sha: String(sha ?? ""),
    state: success ? "success" : "failure",
    description: String(result.summary || `agent proof ${result.status}`).slice(0, 140),
    status: result.status
  };
}

function writeTerminalMarker(path, result, sha) {
  if (!path) return;
  writeJsonFile(path, terminalMarker(result, sha));
}

function writeFailureTerminalMarker(args, error) {
  if (!args["terminal-marker"]) return;
  const summary = `Agent proof failed: ${error?.message ?? String(error)}`;
  writeTerminalMarker(
    args["terminal-marker"],
    baseResult("CI", { status: "failed", summary, blocker: summary }),
    args["status-sha"] ?? ""
  );
}

export function preparationFailureRecord(args, error) {
  const kind = ["issue", "pr"].includes(args["target-kind"])
    ? args["target-kind"]
    : "issue";
  const number = Number(args["target-number"]);
  const requestedKind = String(args["proof-kind"] ?? "");
  const proofKind =
    PROOF_KINDS.has(requestedKind) && requestedKind !== "none"
      ? requestedKind
      : PROOF_KINDS.has(args["resolved-proof-kind"]) &&
          args["resolved-proof-kind"] !== "none"
        ? args["resolved-proof-kind"]
        : "CI";
  const message = String(error?.message ?? error ?? "unknown preparation failure")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1_000);
  return {
    version: 1,
    phase: "prepare",
    targetKind: kind,
    targetNumber: Number.isInteger(number) && number > 0 ? number : 0,
    statusSha: /^[0-9a-f]{40}$/.test(String(args["status-sha"] ?? ""))
      ? String(args["status-sha"])
      : "",
    proofKind,
    summary: `Proof preparation failed: ${message}`
  };
}

function writePreparationFailureOutput(args, error) {
  const name = String(args["failure-output"] ?? "");
  if (!name) return;
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new AgentError("invalid proof failure output name", 2);
  }
  setGitHubOutput({
    [name]: encodeJson(preparationFailureRecord(args, error))
  });
}

function validateTargetArgs(args) {
  const kind = args["target-kind"] ?? args.kind;
  const number = Number(args["target-number"] ?? args.number);
  if (!["issue", "pr"].includes(kind)) throw new AgentError("missing --target-kind issue|pr", 2);
  if (!Number.isInteger(number) || number <= 0) throw new AgentError("missing --target-number", 2);
  if (args["artifact-path"] || args.provider || args["lease-id"]) {
    throw new AgentError("external artifact, provider, and lease claims are not accepted as proof", 2);
  }
  return { kind, number };
}

async function prepareMain(args, config) {
  const { kind, number } = validateTargetArgs(args);
  const details = targetDetails(config, kind, number);
  const statusSha = String(args["status-sha"] ?? "");
  if (kind === "pr" && (!statusSha || !isProofHeadFresh(statusSha, details.sha))) {
    throw new AgentError("pending proof status does not match the current PR head", 1, {
      pending: statusSha || "missing",
      current: details.sha
    });
  }
  const requested = isProofRequested(config, details, Boolean(args.explicit));
  const proofKind = requestedProofKind(config, details, args["proof-kind"]);
  args["resolved-proof-kind"] = proofKind;
  const behaviorContract = proofContract(details);
  const proofPlan = implementationProofPlan(details);
  const evidenceLanes = behaviorContract
    ? requiredEvidenceLanes(behaviorContract)
    : proofKind === "UI" || proofKind === "GIF"
      ? ["browser"]
      : proofKind === "service"
        ? ["service"]
        : ["deterministic"];
  const routes = evidenceLanes.includes("browser")
    ? visualRoutes(details, args.route)
    : [];
  if (requested) {
    validateVisualBehaviorPlan({
      proofKind,
      routes,
      behaviorContract,
      proofPlan
    });
  }
  const request = validateRequest({
    kind,
    number,
    requested,
    proofKind,
    routes,
    sha: details.sha ?? "",
    checkoutRef: details.sha ?? config.repo.defaultBranch,
    intentDigest: details.intentCapsule?.intentDigest ?? "",
    behaviorContract,
    proofPlan,
    evidenceLanes
  });
  if (args["prepare-file"]) writeJsonFile(args["prepare-file"], request);
  setGitHubOutput({
    request_b64: encodeJson(request),
    requested,
    proof_kind: proofKind,
    needs_browser: evidenceLanes.includes("browser"),
    needs_deterministic: evidenceLanes.includes("deterministic"),
    needs_remote:
      evidenceLanes.includes("browser") ||
      (evidenceLanes.includes("deterministic") &&
        !evidenceLanes.includes("service")),
    needs_service: evidenceLanes.includes("service"),
    sha: request.sha,
    checkout_ref: request.checkoutRef
  });
  finish({ ok: true, message: `prepared proof request for ${kind} #${number}`, request }, Boolean(args.json));
}

function remoteArtifacts(remote) {
  return [remote.recordPath, remote.logPath, ...(remote.artifacts ?? [])].filter(Boolean);
}

export function exactRemoteProofCommand(config, request, proofCommand) {
  if (request.kind !== "pr") return proofCommand;
  const repoUrl = `https://github.com/${config.repo.owner}/${config.repo.name}.git`;
  return [
    "rm -rf .agent-proof-source",
    "git init -q .agent-proof-source",
    "cd .agent-proof-source",
    `git remote add origin ${shellQuote(repoUrl)}`,
    `git fetch --quiet --depth=1 origin ${shellQuote(`pull/${request.number}/head`)}`,
    "git checkout --quiet --detach FETCH_HEAD",
    `test "$(git rev-parse HEAD)" = ${shellQuote(request.sha)}`,
    `echo ${shellQuote(`AGENT_PROOF_HEAD_OK ${request.sha}`)}`,
    proofCommand
  ].join(" && ");
}

async function executeRemoteMain(args, config) {
  const request = validateRequest(readModeDocument(args, "request"));
  const workdir = resolve(args.workdir ?? process.cwd());
  let outcome;
  if (!request.requested) {
    outcome = terminalOutcome(
      baseResult(request.proofKind, {
        status: "skipped",
        summary: "Proof was not requested.",
        blocker: ""
      })
    );
  } else if (
    request.evidenceLanes.includes("service") &&
    !request.evidenceLanes.includes("browser") &&
    !request.evidenceLanes.includes("deterministic")
  ) {
    throw new AgentError(
      "service-only proof must run through the trusted disposable-service lane",
      1
    );
  } else if (
    request.evidenceLanes.includes("browser") &&
    request.routes.length === 0
  ) {
    outcome = terminalOutcome(
      baseResult(request.proofKind, {
        status: "blocked",
        summary: "Visual proof did not exercise an affected route.",
        blocker: "Visual proof has no explicit route and no safely derivable changed Next.js page route."
      })
    );
  } else {
    const visual = request.evidenceLanes.includes("browser");
    const deterministic = request.evidenceLanes.includes("deterministic");
    const lane = request.proofKind === "GIF" ? "gifProof" : visual ? "visualProof" : "ciRemote";
    const proofCommand = visual
      ? visualServerCommand(config, request.routes, {
          includeDeterministic: deterministic
        })
      : [config.commands.install, ...config.commands.proof].join(" && ");
    const command = exactRemoteProofCommand(config, request, proofCommand);
    const remote = runCrabboxLane({
      config,
      lane,
      command,
      routes: request.routes,
      workdir,
      env: process.env,
      noSync: request.kind === "pr",
      behaviorPlan: visual ? request.proofPlan : null
    });
    const commands = remote.attempted ? [`crabbox run (${remote.provider}) ${command}`] : [];
    const artifactPaths = remoteArtifacts(remote);
    const artifactDigests = artifactDigestRecords(artifactPaths);
    const access = request.sha
      ? `pull request #${request.number} head ${request.sha}`
      : request.checkoutRef;
    const evidenceReports = [];
    if (request.behaviorContract && visual) {
      evidenceReports.push({
        evidenceLanes: ["browser"],
        report: remote.behaviorObservations?.length
          ? browserBehaviorReport({
              contract: request.behaviorContract,
              observations: remote.behaviorObservations,
              routes: request.routes
            })
          : commandBehaviorReport({
              contract: request.behaviorContract,
              passed: false,
              access,
              commands: [`Open ${request.routes.join(", ")}`],
              blocker:
                remote.reason || "Crabbox browser proof did not complete.",
              evidenceLanes: ["browser"]
            })
      });
    }
    if (request.behaviorContract && deterministic) {
      evidenceReports.push({
        evidenceLanes: ["deterministic"],
        report: commandBehaviorReport({
          contract: request.behaviorContract,
          passed: Boolean(remote.ok && remote.attempted),
          access,
          commands: config.commands.proof,
          blocker:
            remote.ok && remote.attempted
              ? ""
              : remote.reason || "Crabbox deterministic proof did not complete.",
          evidenceLanes: ["deterministic"]
        })
      });
    }
    const behaviorReport = request.behaviorContract
      ? combineBehaviorReports({
          contract: request.behaviorContract,
          reports: evidenceReports,
          access
        })
      : null;
    const coveredEvidenceLanes = [
      ...(visual ? ["browser"] : []),
      ...(deterministic ? ["deterministic"] : [])
    ];
    if (remote.ok && remote.attempted) {
      outcome = terminalOutcome(
        baseResult(request.proofKind, {
          status: "passed",
          commands,
          artifactPaths,
          artifactDigests,
          provider: remote.provider,
          leaseId: remote.leaseId,
          behaviorReport,
          evidenceLanes: coveredEvidenceLanes,
          summary: visual
            ? request.proofKind === "GIF"
              ? "Sealed behavior clauses passed in a recorded Crabbox browser run."
              : "Sealed behavior clauses passed in a source-blind Crabbox browser run."
            : "Sealed behavior clauses passed with configured CI proof in Crabbox."
        }),
        remote.timing ?? null
      );
    } else if (!visual) {
      outcome = {
        terminal: false,
        needsLocal: true,
        remoteReason: remote.reason || "Crabbox provider unavailable",
        remoteCommands: commands,
        remoteArtifacts: artifactPaths
      };
    } else {
      outcome = terminalOutcome(
        baseResult(request.proofKind, {
          status: remote.attempted ? "failed" : "blocked",
          commands,
          artifactPaths,
          artifactDigests,
          provider: remote.provider ?? "",
          leaseId: remote.leaseId ?? "",
          behaviorReport,
          evidenceLanes: coveredEvidenceLanes,
          summary: "Required visual proof is unavailable.",
          blocker: remote.reason || "Crabbox visual proof did not complete."
        }),
        remote.timing ?? null
      );
    }
  }
  if (args["outcome-file"]) writeJsonFile(args["outcome-file"], outcome);
  setGitHubOutput({
    outcome_b64: encodeJson(outcome),
    terminal: outcome.terminal,
    needs_local: outcome.needsLocal,
    proof_passed:
      outcome.terminal === true &&
      outcome.result?.status === "passed" &&
      (!request.behaviorContract ||
        outcome.result?.behaviorReport?.overall_behavior ===
          "satisfies_contract"),
  });
  finish({ ok: true, message: "remote proof orchestration completed", outcome }, Boolean(args.json));
}

async function verifyPublishedMediaMain(args) {
  const request = validateRequest(readModeDocument(args, "request"));
  const remoteOutcome = readModeDocument(args, "remote-outcome");
  const outcome = validatePublishedMedia({
    request,
    remoteOutcome,
    artifactDir: args["artifact-dir"]
  });
  if (args["outcome-file"]) {
    writeJsonFile(args["outcome-file"], outcome);
  }
  setGitHubOutput({ outcome_b64: encodeJson(outcome) });
  finish(
    {
      ok: true,
      message: outcome.summary,
      outcome
    },
    Boolean(args.json)
  );
}

function assertExactCheckout(request, workdir) {
  if (request.kind !== "pr") return;
  const actual = runCommand("git", ["rev-parse", "HEAD"], { cwd: workdir }).stdout.trim();
  if (!isProofHeadFresh(request.sha, actual)) {
    throw new AgentError("local proof checkout does not match the prepared PR head", 1, {
      expected: request.sha,
      actual
    });
  }
}

async function executeServiceMain(args, config) {
  const request = validateRequest(readModeDocument(args, "request"));
  if (
    request.kind !== "pr" ||
    !request.evidenceLanes.includes("service")
  ) {
    throw new AgentError(
      "trusted service proof requires an exact pull request service request",
      1
    );
  }
  const workdir = resolve(args.workdir ?? process.cwd());
  assertExactCheckout(request, workdir);
  const commands = config.commands.serviceProof;
  if (!Array.isArray(commands) || !commands.length) {
    throw new AgentError("trusted service proof commands are not configured", 1);
  }
  const env = untrustedCodeEnvironment(config);
  if (!String(process.env.DATABASE_URL ?? "").startsWith("postgres")) {
    throw new AgentError("trusted service proof has no disposable database", 1);
  }
  env.DATABASE_URL = process.env.DATABASE_URL;
  let failedCommand = "";
  for (const command of commands) {
    const result = runShell(command, {
      cwd: workdir,
      check: false,
      env
    });
    if (result.status !== 0) {
      failedCommand = command;
      break;
    }
  }
  const passed = !failedCommand;
  const evidencePath = resolve(
    workdir,
    ".agent-output/service-proof.json"
  );
  writeJsonFile(evidencePath, {
    version: 1,
    headSha: request.sha,
    database: "disposable-pgvector-postgres-17",
    compatibilityRoles: ["anon", "authenticated"],
    commands,
    status: passed ? "passed" : "failed",
    failedCommand
  });
  const coveredEvidenceLanes = [
    "service",
    ...(request.evidenceLanes.includes("deterministic")
      ? ["deterministic"]
      : [])
  ];
  const behaviorReport = request.behaviorContract
    ? commandBehaviorReport({
        contract: request.behaviorContract,
        passed,
        access: `pull request #${request.number} head ${request.sha} with disposable pgvector Postgres 17`,
        commands,
        evidenceLanes: coveredEvidenceLanes
      })
    : null;
  const result = baseResult(request.proofKind, {
    status: passed ? "passed" : "failed",
    commands,
    artifactPaths: [evidencePath],
    artifactDigests: artifactDigestRecords([evidencePath]),
    provider: "github-actions",
    behaviorReport,
    evidenceLanes: coveredEvidenceLanes,
    summary: passed
      ? "Exact-head build, scenarios, and migrations passed against disposable pgvector Postgres 17."
      : `Trusted service proof failed while running ${failedCommand}.`,
    blocker: failedCommand
      ? `${failedCommand} exited unsuccessfully.`
      : ""
  });
  const outcome = terminalOutcome(result);
  if (args["outcome-file"]) writeJsonFile(args["outcome-file"], outcome);
  setGitHubOutput({ outcome_b64: encodeJson(outcome) });
  finish(
    {
      ok: passed,
      message: `service proof ${result.status}`,
      outcome
    },
    Boolean(args.json),
    passed ? 0 : 1
  );
}

async function executeLocalMain(args, config) {
  const request = validateRequest(readModeDocument(args, "request"));
  const prior = args["prior-base64"]
    ? decodeJson(args["prior-base64"], "prior outcome")
    : String(args["remote-job-result"] ?? "") !== "success"
      ? {
          terminal: false,
          needsLocal: true,
          remoteReason: "remote proof orchestration job failed",
          remoteCommands: [],
          remoteArtifacts: []
        }
      : null;
  if (
    !request.evidenceLanes.includes("deterministic") ||
    request.evidenceLanes.includes("browser")
  ) {
    throw new AgentError(
      "local fallback is allowed only for non-browser deterministic proof",
      1
    );
  }
  if (prior?.terminal || prior?.needsLocal !== true) throw new AgentError("local CI fallback was not requested", 1);
  const workdir = resolve(args.workdir ?? process.cwd());
  assertExactCheckout(request, workdir);
  const commands = [...(prior.remoteCommands ?? [])];
  const artifactPaths = [...(prior.remoteArtifacts ?? [])];
  let failedCommand = "";
  for (const command of [config.commands.install, ...config.commands.proof]) {
    const output = runShell(command, {
      cwd: workdir,
      check: false,
      env: untrustedCodeEnvironment(config)
    });
    commands.push(command);
    if (output.status !== 0) {
      failedCommand = command;
      break;
    }
  }
  const result = baseResult(request.proofKind, {
    status: failedCommand ? "failed" : "passed",
    commands,
    artifactPaths,
    provider: failedCommand ? "" : "github-actions",
    evidenceLanes: ["deterministic"],
    summary: failedCommand
      ? `${failedCommand} failed in the credential-free GitHub-hosted fallback.`
      : `GitHub-hosted CI proof passed; Crabbox fallback reason: ${prior.remoteReason}.`,
    blocker: failedCommand ? `${failedCommand} exited unsuccessfully.` : "",
    behaviorReport: request.behaviorContract
      ? commandBehaviorReport({
          contract: request.behaviorContract,
          passed: !failedCommand,
          access: request.sha
            ? `pull request #${request.number} head ${request.sha}`
            : request.checkoutRef,
          commands: [config.commands.install, ...config.commands.proof],
          evidenceLanes: ["deterministic"]
        })
      : null
  });
  const outcome = terminalOutcome(result);
  if (args["outcome-file"]) writeJsonFile(args["outcome-file"], outcome);
  setGitHubOutput({ outcome_b64: encodeJson(outcome), failed_command: failedCommand });
  finish(
    { ok: result.status === "passed", message: `local proof ${result.status}`, outcome },
    Boolean(args.json),
    result.status === "passed" ? 0 : 1
  );
}

function failedWorkflowResult(request, summary) {
  return baseResult(request.proofKind, {
    status: "failed",
    summary,
    blocker: summary,
    behaviorReport: request.behaviorContract
      ? commandBehaviorReport({
          contract: request.behaviorContract,
          passed: false,
          access: request.sha
            ? `pull request #${request.number} head ${request.sha}`
            : request.checkoutRef,
          commands: [],
          blocker: summary,
          evidenceLanes: request.evidenceLanes
        })
      : null
  });
}

export function combineProofResults(request, results, workflowBlockers = []) {
  validateRequest(request);
  const normalized = results.map((result) => normalizeResult(result, request));
  const missing = request.evidenceLanes.filter(
    (lane) =>
      !normalized.some(
        (result) =>
          result.evidenceLanes.includes(lane) && result.status === "passed"
      )
  );
  const failed = normalized.some(
    (result) =>
      result.status === "failed" &&
      result.evidenceLanes.some((lane) =>
        request.evidenceLanes.includes(lane)
      )
  );
  const blocked = normalized.some(
    (result) =>
      result.status === "blocked" &&
      result.evidenceLanes.some((lane) =>
        request.evidenceLanes.includes(lane)
      )
  );
  const status =
    failed || workflowBlockers.length
      ? "failed"
      : blocked
        ? "blocked"
        : missing.length
          ? "failed"
          : "passed";
  const access = request.sha
    ? `pull request #${request.number} head ${request.sha}`
    : request.checkoutRef;
  const behaviorReport = request.behaviorContract
    ? combineBehaviorReports({
        contract: request.behaviorContract,
        reports: normalized
          .filter((result) => result.behaviorReport)
          .map((result) => ({
            evidenceLanes: result.evidenceLanes,
            report: result.behaviorReport
          })),
        access
      })
    : null;
  const blockers = [
    ...workflowBlockers,
    ...normalized.map((result) => result.blocker).filter(Boolean),
    ...missing.map((lane) => `Required ${lane} evidence did not pass.`)
  ];
  const providers = [
    ...new Set(normalized.map((result) => result.provider).filter(Boolean))
  ];
  const leases = [
    ...new Set(normalized.map((result) => result.leaseId).filter(Boolean))
  ];
  const artifactDigests = [
    ...new Map(
      normalized
        .flatMap((result) => result.artifactDigests)
        .map((record) => [`${record.sha256}:${record.name}`, record])
    ).values()
  ];
  return normalizeResult(
    baseResult(request.proofKind, {
      status,
      commands: [...new Set(normalized.flatMap((result) => result.commands))],
      artifactPaths: [
        ...new Set(normalized.flatMap((result) => result.artifactPaths))
      ],
      artifactDigests,
      provider: providers.join(", "),
      leaseId: leases.join(", "),
      behaviorReport,
      evidenceLanes: request.evidenceLanes.filter((lane) =>
        normalized.some(
          (result) =>
            result.evidenceLanes.includes(lane) &&
            result.status === "passed"
        )
      ),
      summary:
        status === "passed"
          ? `All required ${request.evidenceLanes.join(", ")} evidence passed.`
          : blockers[0] || "Required proof evidence did not pass.",
      blocker: [...new Set(blockers)].join(" ")
    }),
    request
  );
}

export function resolveTerminalResult({
  request,
  remoteOutcome,
  remoteJobResult,
  localOutcome,
  localJobResult,
  serviceOutcome = null,
  serviceJobResult = "skipped",
  serviceConfigJobResult = "skipped"
}) {
  validateRequest(request);
  if (!request.requested) {
    return baseResult(request.proofKind, {
      status: "skipped",
      summary: "Proof was not requested."
    });
  }
  const results = [];
  const workflowBlockers = [];
  if (remoteJobResult === "success" && remoteOutcome?.terminal === true) {
    results.push(remoteOutcome.result);
  } else if (
    request.evidenceLanes.includes("browser") ||
    (request.evidenceLanes.includes("deterministic") &&
      !request.evidenceLanes.includes("service") &&
      localJobResult !== "success")
  ) {
    workflowBlockers.push("Remote proof orchestration failed.");
  }
  if (
    localOutcome?.terminal === true &&
    (localJobResult === "success" ||
      (localJobResult === "failure" &&
        ["failed", "blocked"].includes(localOutcome?.result?.status)))
  ) {
    results.push(localOutcome.result);
  } else if (
    localJobResult === "failure" &&
    request.evidenceLanes.includes("deterministic")
  ) {
    workflowBlockers.push(
      "Credential-free local proof failed before producing a terminal result."
    );
  }
  if (request.evidenceLanes.includes("service")) {
    if (
      serviceOutcome?.terminal === true &&
      (serviceJobResult === "success" ||
        (serviceJobResult === "failure" &&
          ["failed", "blocked"].includes(serviceOutcome?.result?.status)))
    ) {
      results.push(serviceOutcome.result);
    } else if (serviceJobResult !== "success") {
      workflowBlockers.push(
        "Trusted service proof failed before producing a terminal result."
      );
    }
    if (serviceConfigJobResult !== "success") {
      workflowBlockers.push(
        serviceConfigJobResult === "failure"
          ? "Trusted Render Blueprint validation failed."
          : "Trusted Render Blueprint validation did not complete."
      );
    }
  }
  return combineProofResults(request, results, workflowBlockers);
}

async function finalizeMain(args, config) {
  const request = validateRequest(readModeDocument(args, "request"));
  const remoteOutcome = args["remote-outcome-base64"]
    ? decodeJson(args["remote-outcome-base64"], "remote outcome")
    : null;
  const localOutcome = args["local-outcome-base64"]
    ? decodeJson(args["local-outcome-base64"], "local outcome")
    : null;
  const serviceOutcome = args["service-outcome-base64"]
    ? decodeJson(args["service-outcome-base64"], "service outcome")
    : null;
  const remoteJobResult = String(args["remote-job-result"] ?? "skipped");
  const localJobResult = String(args["local-job-result"] ?? "skipped");
  const serviceJobResult = String(args["service-job-result"] ?? "skipped");
  const serviceConfigJobResult = String(
    args["service-config-job-result"] ?? "skipped"
  );
  const publishedMediaJobResult = String(
    args["published-media-job-result"] ?? "skipped"
  );
  let result = resolveTerminalResult({
    request,
    remoteOutcome,
    remoteJobResult,
    localOutcome,
    localJobResult,
    serviceOutcome,
    serviceJobResult,
    serviceConfigJobResult
  });
  const selectedOutcome =
    remoteJobResult === "success" &&
    remoteOutcome?.terminal === true &&
    remoteOutcome?.timing
      ? remoteOutcome
      : serviceOutcome?.terminal === true
        ? serviceOutcome
        : localOutcome?.terminal === true
          ? localOutcome
          : null;
  let timingRecord = selectedOutcome?.timing ?? null;
  let mayMutateTarget = true;
  const artifactUrl = validateArtifactUrl(args["artifact-url"], config);
  if (
    request.evidenceLanes.includes("browser") &&
    result.status === "passed" &&
    !artifactUrl
  ) {
    result = failedWorkflowResult(request, "Visual capture completed, but no reviewable GitHub artifact was published.");
    timingRecord = null;
  }
  if (
    request.evidenceLanes.includes("browser") &&
    result.status === "passed"
  ) {
    try {
      if (
        publishedMediaJobResult !== "success" ||
        !args["published-media-outcome-base64"]
      ) {
        throw new AgentError(
          "the published proof bundle was not downloaded and opened",
          1
        );
      }
      result.publishedMedia = validatePublishedMediaOutcome(
        decodeJson(
          args["published-media-outcome-base64"],
          "published media outcome"
        ),
        request,
        result
      );
    } catch (error) {
      result = failedWorkflowResult(
        request,
        `Published proof media validation failed: ${error.message}`
      );
      timingRecord = null;
    }
  }
  result.artifactUrl = artifactUrl;

  if (request.kind === "pr" && request.requested) {
    const current = targetDetails(config, "pr", request.number);
    mayMutateTarget = mayMutateProofTarget(request.sha, current.sha, args["status-sha"]);
    if (!mayMutateTarget) {
      result = failedWorkflowResult(request, "PR head changed while proof was running; proof must rerun on the current head.");
      result.blocker = `Proof prepared ${request.sha}; current head is ${current.sha}.`;
      timingRecord = null;
    }
  }

  const repairEligible = proofRepairEligible(
    request,
    result,
    mayMutateTarget,
  );
  let comment = null;
  let labels = { added: [], removed: [] };
  if (request.requested && mayMutateTarget) {
    comment = upsertManagedComment({
      config,
      number: request.number,
      marker: config.comments.proof,
      body: proofBody(result, request.routes, timingRecord)
    });
    const changes = proofLabelChanges(config, result.status, {
      repairing: repairEligible,
    });
    labels = {
      added: addLabels(config, request.number, changes.add),
      removed: removeLabels(config, request.number, changes.remove)
    };
  }

  writeTerminalMarker(args["terminal-marker"], result, request.sha || args["status-sha"] || "");
  if (args["cost-outcome-file"]) {
    writeJsonFile(args["cost-outcome-file"], terminalOutcome(result, timingRecord));
  }
  setGitHubOutput({ "repair-eligible": repairEligible });
  const ok = result.status === "passed" || result.status === "skipped";
  finish(
    {
      ok,
      message: `proof ${result.status} for ${request.kind} #${request.number}`,
      result,
      comment,
      labels,
      status: { pendingFinalizer: true },
      dispatch: null
    },
    Boolean(args.json),
    ok ? 0 : 1
  );
}

function preparationFailureFromArgs(args) {
  const fallback = {
    version: 1,
    phase: "prepare",
    targetKind: args["target-kind"],
    targetNumber: Number(args["target-number"]),
    statusSha: String(args["status-sha"] ?? ""),
    proofKind: "CI",
    summary: String(
      args["prepare-failure-summary"] ??
        "Proof preparation job failed before it recorded a primary error."
    )
  };
  const record = args["prepare-failure-base64"]
    ? decodeJson(args["prepare-failure-base64"], "preparation failure")
    : fallback;
  if (
    record?.version !== 1 ||
    record?.phase !== "prepare" ||
    !["issue", "pr"].includes(record.targetKind) ||
    !Number.isInteger(record.targetNumber) ||
    record.targetNumber <= 0 ||
    !PROOF_KINDS.has(record.proofKind) ||
    record.proofKind === "none" ||
    typeof record.summary !== "string" ||
    !record.summary.trim() ||
    record.summary.length > 1_100 ||
    (record.targetKind === "pr" &&
      !/^[0-9a-f]{40}$/.test(record.statusSha))
  ) {
    throw new AgentError("invalid proof preparation failure record", 1);
  }
  if (
    record.targetKind !== args["target-kind"] ||
    record.targetNumber !== Number(args["target-number"]) ||
    String(record.statusSha) !== String(args["status-sha"] ?? "")
  ) {
    throw new AgentError(
      "proof preparation failure does not match the workflow target",
      1
    );
  }
  return record;
}

async function finalizePreparationFailure(args, config) {
  const failure = preparationFailureFromArgs(args);
  const result = baseResult(failure.proofKind, {
    status: "failed",
    summary: failure.summary,
    blocker: failure.summary
  });
  let mayMutateTarget = failure.targetKind === "issue";
  if (failure.targetKind === "pr") {
    try {
      const current = getPullRequest(config, failure.targetNumber);
      mayMutateTarget = isProofHeadFresh(
        failure.statusSha,
        current?.head?.sha
      );
    } catch {
      mayMutateTarget = false;
    }
  }
  let comment = null;
  let labels = { added: [], removed: [] };
  if (mayMutateTarget) {
    comment = upsertManagedComment({
      config,
      number: failure.targetNumber,
      marker: config.comments.proof,
      body: proofBody(result, [], null)
    });
    const changes = proofLabelChanges(config, result.status);
    labels = {
      added: addLabels(config, failure.targetNumber, changes.add),
      removed: removeLabels(config, failure.targetNumber, changes.remove)
    };
  }
  writeTerminalMarker(
    args["terminal-marker"],
    result,
    failure.statusSha
  );
  if (args["cost-outcome-file"]) {
    writeJsonFile(
      args["cost-outcome-file"],
      terminalOutcome(result)
    );
  }
  finish(
    {
      ok: false,
      message: `proof preparation failed for ${failure.targetKind} #${failure.targetNumber}`,
      result,
      comment,
      labels,
      status: { pendingFinalizer: true },
      dispatch: null
    },
    Boolean(args.json),
    1
  );
}

async function main(args = parseArgs()) {
  const config = loadConfig();
  if (args["prepare-file"] || args.prepare) return prepareMain(args, config);
  if (args["execute-remote"]) return executeRemoteMain(args, config);
  if (args["verify-published-media"]) {
    return verifyPublishedMediaMain(args);
  }
  if (args["execute-service"]) return executeServiceMain(args, config);
  if (args["execute-local"]) return executeLocalMain(args, config);
  if (args["finalize-prepare-failure"]) {
    return finalizePreparationFailure(args, config);
  }
  if (args.finalize) return finalizeMain(args, config);
  return legacyMain(args, config);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs();
  main(args).catch((error) => {
    try {
      writePreparationFailureOutput(args, error);
    } catch {
      // The finalizer retains its bounded generic preparation failure.
    }
    try {
      writeFailureTerminalMarker(args, error);
    } catch {
      // The workflow-level finalizer still converts a missing marker to failure.
    }
    fail(error, Boolean(args.json));
  });
}
