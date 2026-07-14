#!/usr/bin/env node
import { resolve } from "node:path";
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
  parseArgs,
  removeLabels,
  runCommand,
  runShell,
  setCommitStatus,
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
  const trustedAuthors = new Set(["github-actions[bot]", owner].filter(Boolean).map((value) => String(value).toLowerCase()));
  const comment = [...(comments ?? [])]
    .reverse()
    .find(
      (item) =>
        trustedAuthors.has(String(item.user?.login ?? "").toLowerCase()) &&
        String(item.body ?? "").includes(marker)
    );
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

function proofEnvironment() {
  const env = { ...process.env };
  for (const name of Object.keys(env)) {
    if (
      name === "GH_TOKEN" ||
      name === "GITHUB_TOKEN" ||
      name === "AGENT_PAT" ||
      name === "OPENAI_API_KEY" ||
      name === "CODEX_API_KEY" ||
      name.startsWith("GITHUB_")
    ) {
      delete env[name];
    }
  }
  return env;
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

function visualServerCommand(config, route) {
  const url = `http://127.0.0.1:3000${route}`;
  return [
    "set -eu",
    config.commands.install,
    config.commands.build,
    "(nohup npm --workspace @central-vet/internal run start -- --port 3000 --hostname 127.0.0.1 >/tmp/vet-agent-proof-next.log 2>&1 </dev/null &)",
    `for attempt in $(seq 1 90); do if curl -fsS ${shellQuote(url)} >/dev/null; then exit 0; fi; sleep 1; done`,
    "tail -n 80 /tmp/vet-agent-proof-next.log >&2 || true",
    "exit 1"
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

async function main() {
  const args = parseArgs();
  const config = loadConfig();
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
    const install = runShell(config.commands.install, { check: false, env: proofEnvironment() });
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
        const output = runShell(command, { check: false, env: proofEnvironment() });
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
      const command = visualServerCommand(config, routes[0]);
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
      ? dispatchWorkflow(config, "agent-automerge.yml", { "pr-number": number }, dryRun)
      : null;
  const ok = result.status === "passed" || result.status === "skipped";
  finish(
    { ok, message: `proof ${result.status} for ${kind} #${number}`, result, comment, labels, status, dispatch },
    Boolean(args.json),
    ok ? 0 : 1
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => fail(error, Boolean(parseArgs().json)));
}
