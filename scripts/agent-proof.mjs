#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AgentError,
  addLabels,
  dispatchWorkflow,
  extractJson,
  fail,
  finish,
  gh,
  ghApiJson,
  ghJson,
  issueLabels,
  loadConfig,
  markdownJsonBlock,
  newestManagedComment,
  parseArgs,
  removeLabels,
  runCommand,
  runShell,
  setCommitStatus,
  setGitHubOutput,
  upsertManagedComment
} from "./agent-lib.mjs";
import { runCrabboxLane } from "./agent-crabbox-run.mjs";

const PROOF_KINDS = new Set(["none", "CI", "UI", "GIF"]);

function commentsFor(config, number) {
  return (
    ghApiJson(`repos/${config.repo.owner}/${config.repo.name}/issues/${number}/comments`, {
      paginate: true
    }) ?? []
  );
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
  const closing = ghJson([
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
    const pull = ghApiJson(`repos/${config.repo.owner}/${config.repo.name}/pulls/${number}`);
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
    const files = ghApiJson(`repos/${config.repo.owner}/${config.repo.name}/pulls/${number}/files`, {
      paginate: true
    });
    return {
      title: pull.title,
      body: pull.body ?? "",
      labels: issueLabels(issue),
      comments: commentsFor(config, number),
      source,
      files: files ?? [],
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
      config?.secrets?.githubPat,
      config?.secrets?.crabboxCoordinator,
      ...(config?.secrets?.crabboxProviders ?? []),
      ...(config?.secrets?.vercel ?? []),
      "GH_TOKEN",
      "GITHUB_TOKEN",
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

function normalizeExplicitRoute(route) {
  if (!route) return null;
  const value = String(route).trim();
  if (!/^\/[A-Za-z0-9/_-]*$/.test(value) || value.includes("..") || value.includes("//") || value.startsWith("/api/")) {
    throw new AgentError(`unsafe or non-UI proof route: ${value}`, 2);
  }
  return value.length > 1 ? value.replace(/\/+$/, "") : value;
}

function routeForPageFile(path) {
  const match = String(path).match(/^apps\/internal\/app\/(.*\/)?page\.[jt]sx?$/);
  if (!match) return null;
  const segments = String(match[1] ?? "")
    .split("/")
    .filter(Boolean)
    .filter((segment) => /^\([^)]*\)$/.test(segment) === false);
  if (segments.some((segment) => segment.startsWith("@") || segment.startsWith("(") || segment.includes("[") || segment.includes("]"))) return null;
  return segments.length ? `/${segments.join("/")}` : "/";
}

export function deriveAffectedRoutes(files, explicitRoute = "") {
  const requested = normalizeExplicitRoute(explicitRoute);
  if (requested) return [requested];
  const routes = [];
  for (const file of files ?? []) {
    if (file?.status === "removed") continue;
    for (const path of [file?.filename, file?.previous_filename]) {
      if (!path) continue;
      const route = routeForPageFile(path);
      if (route) routes.push(route);
      if (/^apps\/internal\/app\/(?:layout\.[jt]sx?|globals\.css)$/.test(path)) routes.push("/");
    }
  }
  return [...new Set(routes)].sort();
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

export function visualServerCommand(config, routes) {
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
    "(nohup npm --workspace @central-vet/internal run start -- --port 3000 --hostname 127.0.0.1 >/tmp/vet-agent-proof-next.log 2>&1 </dev/null &)",
    ...probes
  ].join("; ");
}

function proofBody(result, routes, timingRecord) {
  const timing = timingRecord
    ? `${timingRecord.totalMs}ms total, ${timingRecord.commandMs ?? 0}ms command`
    : "none";
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

${result.artifactPaths.length ? result.artifactPaths.map((path) => `- ${path}`).join("\n") : "- none"}

Summary:

${result.summary}

${result.blocker ? `Blocker:\n\n${result.blocker}\n` : ""}

Structured proof:
${markdownJsonBlock(result)}`;
}

export function proofLabelChanges(config, status) {
  if (status === "blocked" || status === "failed") {
    return { add: [config.labels.blocked], remove: [config.labels.automerge] };
  }
  // A shared blocked label may belong to triage, review, no-mistakes, or a human.
  return { add: [], remove: [] };
}

export function isProofHeadFresh(expectedSha, currentSha) {
  return Boolean(expectedSha && currentSha && expectedSha === currentSha);
}

export function mayMutateProofTarget(requestSha, currentSha, statusSha) {
  return isProofHeadFresh(requestSha, currentSha) && isProofHeadFresh(statusSha, requestSha);
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
    if (!routes.length) {
      result.status = "blocked";
      result.blocker = "Visual proof has no explicit route and no safely derivable changed Next.js page route.";
      result.summary = "Visual proof did not exercise an affected route.";
    } else {
      const lane = proofKind === "GIF" ? "gifProof" : "visualProof";
      const command = visualServerCommand(config, routes);
      const remote = runCrabboxLane({ config, lane, command, routes, dryRun });
      if (remote.attempted) {
        result.commands.push(`crabbox run (${remote.provider}) ${command}`);
        for (const path of [remote.recordPath, remote.logPath, ...(remote.artifacts ?? [])]) {
          if (path) result.artifactPaths.push(path);
        }
      }
      if (remote.ok && remote.attempted) {
        result.status = "passed";
        result.provider = remote.provider;
        result.leaseId = remote.leaseId;
        timingRecord = remote.timing;
        result.summary = proofKind === "GIF" ? "Authentic Crabbox video and GIF proof were collected." : "Authentic Crabbox UI screenshots were collected.";
      } else {
        result.status = remote.attempted ? "failed" : "blocked";
        result.provider = remote.provider;
        result.leaseId = remote.leaseId;
        timingRecord = remote.timing;
        result.blocker = remote.reason || "Crabbox visual proof did not complete.";
        result.summary = "Required visual proof is unavailable.";
      }
    }
  }

  if (kind === "pr" && result.status === "passed" && run && !dryRun) {
    const current = ghApiJson(`repos/${config.repo.owner}/${config.repo.name}/pulls/${number}`);
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
  if (!["issue", "pr"].includes(request.kind)) throw new AgentError("invalid proof request kind", 1);
  if (!Number.isInteger(request.number) || request.number <= 0) throw new AgentError("invalid proof request number", 1);
  if (typeof request.requested !== "boolean") throw new AgentError("invalid proof request decision", 1);
  if (!PROOF_KINDS.has(request.proofKind) || request.proofKind === "none") {
    throw new AgentError("invalid proof request kind", 1);
  }
  if (!Array.isArray(request.routes) || request.routes.length > 50) throw new AgentError("invalid proof request routes", 1);
  for (const route of request.routes) {
    if (normalizeExplicitRoute(route) !== route) throw new AgentError(`invalid proof route: ${route}`, 1);
  }
  if (request.kind === "pr") {
    if (!/^[0-9a-f]{40}$/i.test(String(request.sha ?? "")) || request.checkoutRef !== request.sha) {
      throw new AgentError("invalid exact PR proof ref", 1);
    }
  }
  return request;
}

function baseResult(proofKind, overrides = {}) {
  return {
    proofKind,
    status: "pending",
    commands: [],
    artifactPaths: [],
    provider: "",
    leaseId: "",
    summary: "Proof has not completed.",
    blocker: "",
    ...overrides
  };
}

function normalizeResult(result, proofKind) {
  if (!result || typeof result !== "object") throw new AgentError("proof outcome has no result", 1);
  if (result.proofKind !== proofKind) throw new AgentError("proof outcome kind mismatch", 1);
  if (!["passed", "failed", "blocked", "skipped"].includes(result.status)) {
    throw new AgentError("proof outcome is not terminal", 1);
  }
  for (const name of ["commands", "artifactPaths"]) {
    if (!Array.isArray(result[name]) || result[name].some((item) => typeof item !== "string")) {
      throw new AgentError(`proof outcome has invalid ${name}`, 1);
    }
  }
  for (const name of ["provider", "leaseId", "summary", "blocker"]) {
    if (typeof result[name] !== "string") throw new AgentError(`proof outcome has invalid ${name}`, 1);
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
  const routes = proofKind === "UI" || proofKind === "GIF" ? deriveAffectedRoutes(details.files, args.route) : [];
  const request = validateRequest({
    kind,
    number,
    requested,
    proofKind,
    routes,
    sha: details.sha ?? "",
    checkoutRef: details.sha ?? config.repo.defaultBranch
  });
  if (args["prepare-file"]) writeJsonFile(args["prepare-file"], request);
  setGitHubOutput({
    request_b64: encodeJson(request),
    requested,
    proof_kind: proofKind,
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
  } else if ((request.proofKind === "UI" || request.proofKind === "GIF") && request.routes.length === 0) {
    outcome = terminalOutcome(
      baseResult(request.proofKind, {
        status: "blocked",
        summary: "Visual proof did not exercise an affected route.",
        blocker: "Visual proof has no explicit route and no safely derivable changed Next.js page route."
      })
    );
  } else {
    const visual = request.proofKind === "UI" || request.proofKind === "GIF";
    const lane = request.proofKind === "GIF" ? "gifProof" : visual ? "visualProof" : "ciRemote";
    const proofCommand = visual
      ? visualServerCommand(config, request.routes)
      : [config.commands.install, ...config.commands.proof].join(" && ");
    const command = exactRemoteProofCommand(config, request, proofCommand);
    const remote = runCrabboxLane({
      config,
      lane,
      command,
      routes: request.routes,
      workdir,
      env: process.env,
      noSync: request.kind === "pr"
    });
    const commands = remote.attempted ? [`crabbox run (${remote.provider}) ${command}`] : [];
    const artifactPaths = remoteArtifacts(remote);
    if (remote.ok && remote.attempted) {
      outcome = terminalOutcome(
        baseResult(request.proofKind, {
          status: "passed",
          commands,
          artifactPaths,
          provider: remote.provider,
          leaseId: remote.leaseId,
          summary: visual
            ? request.proofKind === "GIF"
              ? "Authentic Crabbox video and GIF proof were collected for every affected route."
              : "Authentic Crabbox UI screenshots were collected for every affected route."
            : "Configured CI proof passed in Crabbox."
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
          provider: remote.provider ?? "",
          leaseId: remote.leaseId ?? "",
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
    needs_local: outcome.needsLocal
  });
  finish({ ok: true, message: "remote proof orchestration completed", outcome }, Boolean(args.json));
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
  if (request.proofKind !== "CI") throw new AgentError("local fallback is allowed only for CI proof", 1);
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
  const result = baseResult("CI", {
    status: failedCommand ? "failed" : "passed",
    commands,
    artifactPaths,
    provider: failedCommand ? "" : "github-actions",
    summary: failedCommand
      ? `${failedCommand} failed in the credential-free GitHub-hosted fallback.`
      : `GitHub-hosted CI proof passed; Crabbox fallback reason: ${prior.remoteReason}.`,
    blocker: failedCommand ? `${failedCommand} exited unsuccessfully.` : ""
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
    blocker: summary
  });
}

export function resolveTerminalResult({ request, remoteOutcome, remoteJobResult, localOutcome, localJobResult }) {
  validateRequest(request);
  if (!request.requested) {
    return baseResult(request.proofKind, {
      status: "skipped",
      summary: "Proof was not requested."
    });
  }
  if (remoteJobResult === "success" && remoteOutcome?.terminal === true) {
    return normalizeResult(remoteOutcome.result, request.proofKind);
  }
  if (request.proofKind === "CI" && localJobResult === "success" && localOutcome?.terminal === true) {
    const result = normalizeResult(localOutcome.result, "CI");
    if (result.status !== "passed") return failedWorkflowResult(request, "Credential-free local proof job reported an inconsistent result.");
    return result;
  }
  if (request.proofKind === "CI" && localJobResult === "failure") {
    const summary = localOutcome?.result?.summary;
    return failedWorkflowResult(
      request,
      typeof summary === "string" && summary ? summary : "Credential-free local proof failed before producing a terminal result."
    );
  }
  const phase = remoteJobResult !== "success" ? "Remote proof orchestration failed" : "Proof execution did not produce a terminal result";
  return failedWorkflowResult(request, `${phase}; proof must rerun.`);
}

async function finalizeMain(args, config) {
  const request = validateRequest(readModeDocument(args, "request"));
  const remoteOutcome = args["remote-outcome-base64"]
    ? decodeJson(args["remote-outcome-base64"], "remote outcome")
    : null;
  const localOutcome = args["local-outcome-base64"]
    ? decodeJson(args["local-outcome-base64"], "local outcome")
    : null;
  let result = resolveTerminalResult({
    request,
    remoteOutcome,
    remoteJobResult: String(args["remote-job-result"] ?? "skipped"),
    localOutcome,
    localJobResult: String(args["local-job-result"] ?? "skipped")
  });
  let timingRecord = remoteOutcome?.timing ?? null;
  let mayMutateTarget = true;

  if (request.kind === "pr" && request.requested) {
    const current = targetDetails(config, "pr", request.number);
    mayMutateTarget = mayMutateProofTarget(request.sha, current.sha, args["status-sha"]);
    if (!mayMutateTarget) {
      result = failedWorkflowResult(request, "PR head changed while proof was running; proof must rerun on the current head.");
      result.blocker = `Proof prepared ${request.sha}; current head is ${current.sha}.`;
      timingRecord = null;
    }
  }

  let comment = null;
  let labels = { added: [], removed: [] };
  if (request.requested && mayMutateTarget) {
    comment = upsertManagedComment({
      config,
      number: request.number,
      marker: config.comments.proof,
      body: proofBody(result, request.routes, timingRecord)
    });
    const changes = proofLabelChanges(config, result.status);
    labels = {
      added: addLabels(config, request.number, changes.add),
      removed: removeLabels(config, request.number, changes.remove)
    };
  }

  writeTerminalMarker(args["terminal-marker"], result, request.sha || args["status-sha"] || "");
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

async function main(args = parseArgs()) {
  const config = loadConfig();
  if (args["prepare-file"] || args.prepare) return prepareMain(args, config);
  if (args["execute-remote"]) return executeRemoteMain(args, config);
  if (args["execute-local"]) return executeLocalMain(args, config);
  if (args.finalize) return finalizeMain(args, config);
  return legacyMain(args, config);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs();
  main(args).catch((error) => {
    try {
      writeFailureTerminalMarker(args, error);
    } catch {
      // The workflow-level finalizer still converts a missing marker to failure.
    }
    fail(error, Boolean(args.json));
  });
}
