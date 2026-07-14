#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AgentError,
  commandExists,
  fail,
  finish,
  loadConfig,
  parseArgs,
  repoRoot,
  runCommand,
  secretState
} from "./agent-lib.mjs";

const VISUAL_LANES = new Set(["visualProof", "gifProof"]);

function redactSecrets(text, config, env = process.env) {
  let redacted = String(text ?? "");
  const names = [
    config.secrets.agentAuth,
    "CODEX_API_KEY",
    config.secrets.crabboxCoordinator,
    ...config.secrets.crabboxProviders,
    ...config.secrets.vercel
  ];
  for (const name of names) {
    const value = env[name];
    if (typeof value === "string" && value.length >= 4) redacted = redacted.split(value).join("[redacted]");
  }
  return redacted;
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

function parseJsonDocument(text) {
  const source = String(text ?? "").trim();
  if (!source) return null;
  try {
    return JSON.parse(source);
  } catch {
    const first = source.indexOf("{");
    const last = source.lastIndexOf("}");
    if (first !== -1 && last > first) {
      try {
        return JSON.parse(source.slice(first, last + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

export function parseTimingReport(output) {
  const lines = String(output ?? "").split(/\r?\n/).reverse();
  for (const line of lines) {
    const value = parseJsonDocument(line);
    if (
      value &&
      typeof value === "object" &&
      typeof value.provider === "string" &&
      Number.isFinite(value.totalMs) &&
      Number.isInteger(value.exitCode)
    ) {
      return value;
    }
  }
  return null;
}

export function selectCrabboxProvider(config, lane, env = process.env) {
  const visual = VISUAL_LANES.has(lane);
  const auth = secretState(
    [config.secrets.crabboxCoordinator, ...config.secrets.crabboxProviders, ...config.secrets.vercel],
    env
  );
  const present = new Set(auth.filter((item) => item.present).map((item) => item.name));
  const hasHetzner = ["HCLOUD_TOKEN", "HETZNER_TOKEN", "HETZNER_API_TOKEN"].some((name) => present.has(name));
  const vercelReadyName = config.crabbox?.readiness?.vercel ?? "CRABBOX_VERCEL_READY";
  const hetznerReadyName = config.crabbox?.readiness?.hetzner ?? "CRABBOX_HETZNER_READY";
  const hasVercel =
    env[vercelReadyName] === "true" &&
    ["VERCEL_TOKEN", "VERCEL_OIDC_TOKEN"].some((name) => present.has(name));
  const hasReadyHetzner = env[hetznerReadyName] === "true" && hasHetzner;

  if (visual) {
    return hasHetzner
      ? { available: true, provider: "hetzner", auth }
      : { available: false, provider: "", reason: "missing Hetzner-compatible visual provider auth", auth };
  }
  if (hasVercel) return { available: true, provider: "vercel-sandbox", auth };
  if (hasReadyHetzner) return { available: true, provider: "hetzner", auth };
  return {
        available: false,
        provider: "",
        reason:
          env[vercelReadyName] === "true" || env[hetznerReadyName] === "true"
            ? "ready non-visual Crabbox provider is missing its required auth"
            : "no non-visual Crabbox provider has passed its live readiness smoke",
        auth
      };
}

export function validateTimingReport(timing, expectedProvider) {
  if (!timing || typeof timing !== "object") throw new AgentError("Crabbox did not emit timing JSON", 1);
  if (timing.provider !== expectedProvider) {
    throw new AgentError(`Crabbox timing provider mismatch: expected ${expectedProvider}, got ${timing.provider || "none"}`, 1);
  }
  if (!String(timing.leaseId ?? "").trim()) throw new AgentError("Crabbox timing record has no lease id", 1);
  if (!Number.isFinite(timing.totalMs) || timing.totalMs < 0) throw new AgentError("Crabbox timing record has invalid duration", 1);
  if (!Number.isInteger(timing.exitCode)) throw new AgentError("Crabbox timing record has invalid exit code", 1);
  return timing;
}

export function validateCollectedArtifacts(bundle, { provider, leaseId, proofKind }) {
  if (!bundle || typeof bundle !== "object") throw new AgentError("Crabbox artifact collection did not emit JSON", 1);
  if (bundle.metadata?.provider !== provider || bundle.metadata?.leaseId !== leaseId) {
    throw new AgentError("Crabbox artifact provenance does not match the run lease", 1);
  }
  const files = Array.isArray(bundle.files) ? bundle.files : [];
  const requiredKinds = proofKind === "GIF" ? ["video", "gif"] : ["screenshot"];
  for (const kind of requiredKinds) {
    const artifact = files.find((file) => file?.kind === kind);
    if (!artifact?.path || !existsSync(artifact.path)) {
      throw new AgentError(`Crabbox artifact bundle is missing authentic ${kind} output`, 1);
    }
  }
  return files.filter((file) => file?.path && existsSync(file.path)).map((file) => file.path);
}

export function buildRunArgs({ provider, command, visual, lane, leasePath }) {
  const args = ["run", "--provider", provider, "--timing-json", "--timing-record", "off"];
  if (lane === "implementRemote") {
    args.push(
      "--allow-env",
      "CODEX_API_KEY",
      "--download",
      ".agent-output/codex.patch=.agent-output/codex.patch",
      "--download",
      ".agent-output/implementation.md=.agent-output/implementation.md"
    );
  }
  if (visual) {
    args.push("--desktop", "--browser", "--keep", "--keep-on-failure", "--lease-output", leasePath);
  } else {
    args.push("--stop-after", "always");
  }
  args.push("--", "sh", "-lc", command);
  return args;
}

function verifySession(session, timing, provider) {
  if (!session || session.provider !== provider || session.leaseId !== timing.leaseId || !session.kept) {
    throw new AgentError("Crabbox retained lease handle does not match timing provenance", 1);
  }
  return session;
}

function artifactArgs({ provider, leaseId, outputDir, proofKind }) {
  const args = [
    "artifacts",
    "collect",
    "--provider",
    provider,
    "--id",
    leaseId,
    "--output",
    outputDir,
    "--json",
    "--screenshot",
    "--doctor=false",
    "--webvnc-status=false"
  ];
  if (proofKind === "GIF") args.push("--video", "--gif", "--duration", "8s");
  return args;
}

function safeArtifactSlug(route, index) {
  const slug = route.replace(/^\/+/, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "");
  return slug || `root-${index + 1}`;
}

export function runCrabboxLane({ config = loadConfig(), lane, command, routes = [], dryRun = false, env = process.env }) {
  const visual = VISUAL_LANES.has(lane);
  const proofKind = lane === "gifProof" ? "GIF" : visual ? "UI" : "CI";
  const selection = selectCrabboxProvider(config, lane, env);
  if (!selection.available) {
    return { ok: false, attempted: false, lane, command, provider: "", leaseId: "", reason: selection.reason, auth: selection.auth };
  }
  if (!commandExists("crabbox") && !dryRun) {
    return {
      ok: false,
      attempted: false,
      lane,
      command,
      provider: selection.provider,
      leaseId: "",
      reason: "crabbox CLI not found",
      auth: selection.auth
    };
  }
  if (visual && routes.length === 0) {
    return {
      ok: false,
      attempted: false,
      lane,
      command,
      provider: selection.provider,
      leaseId: "",
      reason: "no safely derived affected route",
      auth: selection.auth
    };
  }

  const outputDir = join(repoRoot(), ".agent-output");
  const stamp = `${Date.now()}-${process.pid}`;
  const recordPath = join(outputDir, `crabbox-${lane}-${stamp}.json`);
  const logPath = join(outputDir, `crabbox-${lane}-${stamp}.log`);
  const leasePath = join(outputDir, `crabbox-${lane}-${stamp}-lease.json`);
  mkdirSync(outputDir, { recursive: true });
  const args = buildRunArgs({ provider: selection.provider, command, visual, lane, leasePath });
  if (dryRun) {
    return {
      ok: true,
      attempted: false,
      dryRun: true,
      lane,
      command,
      provider: selection.provider,
      leaseId: "",
      crabboxCommand: ["crabbox", ...args]
    };
  }

  const startedAt = new Date().toISOString();
  const started = Date.now();
  let timing = null;
  let leaseId = "";
  let run = null;
  let cleanup = null;
  const artifacts = [];
  let failure = "";

  try {
    run = runCommand("crabbox", args, { check: false, env });
    writeFileSync(logPath, redactSecrets(`${run.stdout}\n${run.stderr}`, config, env), { mode: 0o600 });
    timing = validateTimingReport(parseTimingReport(`${run.stderr}\n${run.stdout}`), selection.provider);
    leaseId = timing.leaseId;
    if (run.status !== 0 || timing.exitCode !== 0) {
      throw new AgentError(`Crabbox command failed with exit ${timing.exitCode}`, 1);
    }

    if (lane === "implementRemote") {
      for (const path of [
        join(repoRoot(), ".agent-output/codex.patch"),
        join(repoRoot(), ".agent-output/implementation.md")
      ]) {
        if (!existsSync(path)) throw new AgentError(`Crabbox implementation output is missing: ${path}`, 1);
        artifacts.push(path);
      }
    }

    if (visual) {
      const session = verifySession(JSON.parse(readFileSync(leasePath, "utf8")), timing, selection.provider);
      leaseId = session.leaseId;
      for (const [index, route] of routes.entries()) {
        const launch = runCommand(
          "crabbox",
          ["desktop", "launch", "--provider", selection.provider, "--id", leaseId, "--browser", "--url", `http://127.0.0.1:3000${route}`],
          { check: false, env }
        );
        writeFileSync(logPath, redactSecrets(`\n${launch.stdout}\n${launch.stderr}`, config, env), { flag: "a", mode: 0o600 });
        if (launch.status !== 0) throw new AgentError(`Crabbox browser launch failed for ${route}`, 1);

        const bundleDir = join(outputDir, `crabbox-${lane}-${stamp}-${safeArtifactSlug(route, index)}`);
        const collected = runCommand(
          "crabbox",
          artifactArgs({ provider: selection.provider, leaseId, outputDir: bundleDir, proofKind }),
          { check: false, env }
        );
        writeFileSync(logPath, redactSecrets(`\n${collected.stdout}\n${collected.stderr}`, config, env), { flag: "a", mode: 0o600 });
        if (collected.status !== 0) throw new AgentError(`Crabbox artifact collection failed for ${route}`, 1);
        artifacts.push(
          ...validateCollectedArtifacts(parseJsonDocument(collected.stdout), {
            provider: selection.provider,
            leaseId,
            proofKind
          })
        );
      }
    }
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  } finally {
    if (visual && leaseId) {
      cleanup = runCommand("crabbox", ["stop", "--provider", selection.provider, leaseId], { check: false, env });
      writeFileSync(logPath, redactSecrets(`\n${cleanup.stdout}\n${cleanup.stderr}`, config, env), { flag: "a", mode: 0o600 });
      if (cleanup.status !== 0) failure ||= `Crabbox lease cleanup failed for ${leaseId}`;
    }
  }

  const record = {
    ok: !failure,
    attempted: true,
    lane,
    command,
    provider: timing?.provider ?? selection.provider,
    leaseId: timing?.leaseId ?? leaseId,
    startedAt,
    finishedAt: new Date().toISOString(),
    elapsedMs: Date.now() - started,
    timing,
    artifacts,
    logPath,
    cleanupStatus: cleanup?.status ?? null,
    reason: failure
  };
  writeJson(recordPath, record);
  return { ...record, recordPath };
}

export async function main() {
  const args = parseArgs();
  const config = loadConfig();
  const dryRun = Boolean(args["dry-run"]);
  const lane = args.lane ?? "ciRemote";
  const command = args.command ?? config.crabbox.lanes[lane]?.[0];
  if (!command) throw new AgentError(`missing command for lane ${lane}`, 2);
  const routes = args.route ? [String(args.route)] : [];
  const result = runCrabboxLane({ config, lane, command, routes, dryRun });
  finish(result, Boolean(args.json), result.ok ? 0 : result.attempted ? 1 : 2);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => fail(error, Boolean(parseArgs().json)));
}
