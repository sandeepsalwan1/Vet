#!/usr/bin/env node
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  writeFileSync
} from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
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
  const credentialFreeVisualFallback = config.crabbox?.credentialFreeVisualFallback;
  const hasCredentialFreeVisualFallback =
    credentialFreeVisualFallback === "local-container" &&
    config.crabbox?.visualProviders?.includes(credentialFreeVisualFallback);

  if (visual) {
    if (hasReadyHetzner) return { available: true, provider: "hetzner", auth };
    if (hasCredentialFreeVisualFallback) {
      return { available: true, provider: credentialFreeVisualFallback, auth };
    }
    return {
      available: false,
      provider: "",
      reason:
        env[hetznerReadyName] === "true"
          ? "ready Hetzner visual provider is missing its required auth"
          : "Hetzner visual provider has not passed its live readiness smoke",
      auth
    };
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

function copyEnvironmentNames(target, source, names) {
  for (const name of names.filter(Boolean)) {
    if (Object.hasOwn(source, name)) target[name] = source[name];
  }
}

export function providerChildEnvironment(config, { provider, lane }, source = process.env) {
  const child = {};
  copyEnvironmentNames(child, source, [
    "PATH",
    "HOME",
    "TMPDIR",
    "TMP",
    "TEMP",
    "LANG",
    "LC_ALL",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
    "NODE_EXTRA_CA_CERTS",
    "CRABBOX_CONFIG"
  ]);

  if (provider === "vercel-sandbox") {
    copyEnvironmentNames(child, source, [
      "CRABBOX_VERCEL_SANDBOX_BRIDGE",
      ...(config.secrets?.vercel ?? []),
      config.crabbox?.readiness?.vercel ?? "CRABBOX_VERCEL_READY"
    ]);
  } else if (provider === "hetzner") {
    copyEnvironmentNames(child, source, [
      ...(config.secrets?.crabboxProviders ?? []),
      config.crabbox?.readiness?.hetzner ?? "CRABBOX_HETZNER_READY"
    ]);
  }

  const coordinatorProviders = new Set(config.crabbox?.coordinatorProviders ?? ["aws"]);
  if (coordinatorProviders.has(provider)) {
    copyEnvironmentNames(child, source, [config.secrets?.crabboxCoordinator]);
  }
  if (lane === "implementRemote") {
    copyEnvironmentNames(child, source, ["CODEX_API_KEY"]);
  }
  return child;
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

function pathUnder(root, path) {
  const base = resolve(root);
  const target = resolve(isAbsolute(path) ? path : join(base, path));
  const offset = relative(base, target);
  return offset !== "" && !offset.startsWith("..") && !isAbsolute(offset) ? target : null;
}

function readPrefix(path, size = 16) {
  const handle = openSync(path, "r");
  try {
    const buffer = Buffer.alloc(size);
    return buffer.subarray(0, readSync(handle, buffer, 0, size, 0));
  } finally {
    closeSync(handle);
  }
}

function validateRegularArtifact(path, bundleDir, label) {
  const candidate = pathUnder(bundleDir, String(path ?? ""));
  if (!candidate) throw new AgentError(`Crabbox ${label} path escapes its expected bundle`, 1);
  let info;
  try {
    info = lstatSync(candidate);
  } catch {
    throw new AgentError(`Crabbox artifact bundle is missing authentic ${label} output`, 1);
  }
  if (!info.isFile() || info.isSymbolicLink() || info.size <= 0) {
    throw new AgentError(`Crabbox ${label} output is not a nonempty regular file`, 1);
  }
  const realRoot = realpathSync(bundleDir);
  const realPath = realpathSync(candidate);
  const realOffset = relative(realRoot, realPath);
  if (!realOffset || realOffset.startsWith("..") || isAbsolute(realOffset)) {
    throw new AgentError(`Crabbox ${label} path escapes its expected bundle`, 1);
  }
  return candidate;
}

function hasMediaSignature(kind, path) {
  const prefix = readPrefix(path);
  if (kind === "screenshot" || kind === "contact-sheet") {
    return prefix.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  if (kind === "gif") {
    return ["GIF87a", "GIF89a"].includes(prefix.subarray(0, 6).toString("ascii"));
  }
  if (kind === "video" || kind === "trimmed-video") {
    const mp4 = prefix.length >= 8 && prefix.subarray(4, 8).toString("ascii") === "ftyp";
    const webm = prefix.length >= 4 && prefix.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
    return mp4 || webm;
  }
  return true;
}

export function validateRouteBinding(path, { bundleDir, provider, leaseId, route, launchMarker, launchEvidence }) {
  const bindingPath = validateRegularArtifact(path, bundleDir, "route binding");
  let binding;
  try {
    binding = JSON.parse(readFileSync(bindingPath, "utf8"));
  } catch {
    throw new AgentError("Crabbox route binding is not valid JSON", 1);
  }
  if (
    binding?.provider !== provider ||
    binding?.leaseId !== leaseId ||
    binding?.route !== route ||
    binding?.launchMarker !== launchMarker ||
    binding?.launchEvidence !== launchEvidence ||
    binding?.launchStatus !== 0 ||
    binding?.desktopDoctorStatus !== 0
  ) {
    throw new AgentError("Crabbox route binding does not match the captured route and lease", 1);
  }
  return bindingPath;
}

export function validateCollectedArtifacts(
  bundle,
  { provider, leaseId, proofKind, bundleDir, route, routeBindingPath, launchMarker, launchEvidence }
) {
  if (!bundle || typeof bundle !== "object") throw new AgentError("Crabbox artifact collection did not emit JSON", 1);
  if (bundle.metadata?.provider !== provider || bundle.metadata?.leaseId !== leaseId) {
    throw new AgentError("Crabbox artifact provenance does not match the run lease", 1);
  }
  const expectedDirectory = resolve(bundleDir);
  if (resolve(String(bundle.directory ?? "")) !== expectedDirectory) {
    throw new AgentError("Crabbox artifact collection reported an unexpected bundle directory", 1);
  }
  const binding = validateRouteBinding(routeBindingPath, {
    bundleDir: expectedDirectory,
    provider,
    leaseId,
    route,
    launchMarker,
    launchEvidence
  });
  const files = Array.isArray(bundle.files) ? bundle.files : [];
  const validated = [];
  const seen = new Set();
  for (const file of files) {
    if (typeof file?.kind !== "string" || !file.kind || !file.path) {
      throw new AgentError("Crabbox artifact bundle contains an invalid file record", 1);
    }
    const path = validateRegularArtifact(file.path, expectedDirectory, file.kind);
    if (seen.has(path)) throw new AgentError("Crabbox artifact bundle repeats an artifact path", 1);
    seen.add(path);
    if (!hasMediaSignature(file.kind, path)) {
      throw new AgentError(`Crabbox ${file.kind} output has an invalid media signature`, 1);
    }
    validated.push(path);
  }
  const requiredKinds = proofKind === "GIF" ? ["screenshot", "video", "gif"] : ["screenshot"];
  for (const kind of requiredKinds) {
    if (files.filter((file) => file?.kind === kind).length !== 1) {
      throw new AgentError(`Crabbox artifact bundle is missing authentic ${kind} output`, 1);
    }
  }
  return [binding, ...validated];
}

export function buildRunArgs({ provider, command, visual, lane, leasePath, noSync = false }) {
  const args = ["run", "--provider", provider, "--timing-json", "--timing-record", "off"];
  if (noSync) args.push("--no-sync");
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

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

export function browserRouteMarker(route) {
  return `AGENT_PROOF_BROWSER_ROUTE ${route}`;
}

export function browserRouteMarkerArgs({ provider, leaseId, route }) {
  const marker = browserRouteMarker(route);
  const url = `http://127.0.0.1:3000${route}`;
  const command = [
    `route_status="$(curl -sS -o /dev/null -w '%{http_code}' ${shellQuote(url)} || true)"`,
    `case "$route_status" in 2??) printf '%s\\n' ${shellQuote(marker)} ;; *) exit 1 ;; esac`
  ].join("; ");
  return [
    "run",
    "--provider",
    provider,
    "--id",
    leaseId,
    "--no-sync",
    "--stop-after",
    "never",
    "--timing-record",
    "off",
    "--",
    "sh",
    "-lc",
    command
  ];
}

export function validateBrowserRouteMarker(output, route) {
  const expected = browserRouteMarker(route);
  const found = String(output ?? "")
    .split(/\r?\n/)
    .some((line) => line.trim() === expected);
  if (!found) throw new AgentError(`Crabbox browser launch has no remote route evidence for ${route}`, 1);
  return expected;
}

export function validateBrowserLaunchOutput(output, route) {
  const expectedUrl = `http://127.0.0.1:3000${route}`;
  const evidence = String(output ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.startsWith("launched: ") && line.endsWith(` ${expectedUrl}`));
  if (!evidence) throw new AgentError(`Crabbox browser launch has no command evidence for ${route}`, 1);
  return evidence;
}

export function recoverLeaseHandle(path, expectedProvider) {
  if (!existsSync(path)) return null;
  try {
    const session = JSON.parse(readFileSync(path, "utf8"));
    const leaseId = String(session?.leaseId ?? "").trim();
    if (session?.provider !== expectedProvider || !leaseId || !/^[A-Za-z0-9._:-]+$/.test(leaseId)) return null;
    return { ...session, leaseId };
  } catch {
    return null;
  }
}

export function validateProbedRoutes(output, routes) {
  const marker = "AGENT_PROOF_ROUTE_OK ";
  const probed = new Set(
    String(output ?? "")
      .split(/\r?\n/)
      .filter((line) => line.startsWith(marker))
      .map((line) => line.slice(marker.length))
  );
  const missing = routes.filter((route) => !probed.has(route));
  if (missing.length) {
    throw new AgentError(`visual proof did not probe every affected route: ${missing.join(", ")}`, 1);
  }
  return routes.filter((route) => probed.has(route));
}

export function runCrabboxLane({
  config = loadConfig(),
  lane,
  command,
  routes = [],
  dryRun = false,
  env = process.env,
  workdir = repoRoot(),
  noSync = false
}) {
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

  const outputDir = join(workdir, ".agent-output");
  const stamp = `${Date.now()}-${process.pid}`;
  const recordPath = join(outputDir, `crabbox-${lane}-${stamp}.json`);
  const logPath = join(outputDir, `crabbox-${lane}-${stamp}.log`);
  const leasePath = join(outputDir, `crabbox-${lane}-${stamp}-lease.json`);
  mkdirSync(outputDir, { recursive: true });
  const args = buildRunArgs({ provider: selection.provider, command, visual, lane, leasePath, noSync });
  const childEnv = providerChildEnvironment(config, { provider: selection.provider, lane }, env);
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
  const artifactBindings = [];
  let failure = "";

  try {
    run = runCommand("crabbox", args, { check: false, env: childEnv, cwd: workdir });
    writeFileSync(logPath, redactSecrets(`${run.stdout}\n${run.stderr}`, config, env), { mode: 0o600 });
    timing = validateTimingReport(parseTimingReport(`${run.stderr}\n${run.stdout}`), selection.provider);
    leaseId = timing.leaseId;
    if (run.status !== 0 || timing.exitCode !== 0) {
      throw new AgentError(`Crabbox command failed with exit ${timing.exitCode}`, 1);
    }

    if (lane === "implementRemote") {
      for (const path of [
        join(workdir, ".agent-output/codex.patch"),
        join(workdir, ".agent-output/implementation.md")
      ]) {
        if (!existsSync(path)) throw new AgentError(`Crabbox implementation output is missing: ${path}`, 1);
        artifacts.push(path);
      }
    }

    if (visual) {
      validateProbedRoutes(run.stdout, routes);
      const session = verifySession(recoverLeaseHandle(leasePath, selection.provider), timing, selection.provider);
      leaseId = session.leaseId;
      for (const [index, route] of routes.entries()) {
        const markerRun = runCommand(
          "crabbox",
          browserRouteMarkerArgs({ provider: selection.provider, leaseId, route }),
          { check: false, env: childEnv, cwd: workdir }
        );
        writeFileSync(logPath, redactSecrets(`\n${markerRun.stdout}\n${markerRun.stderr}`, config, env), {
          flag: "a",
          mode: 0o600
        });
        if (markerRun.status !== 0) throw new AgentError(`Crabbox remote route marker failed for ${route}`, 1);
        const launchMarker = validateBrowserRouteMarker(markerRun.stdout, route);

        const launch = runCommand(
          "crabbox",
          ["desktop", "launch", "--provider", selection.provider, "--id", leaseId, "--browser", "--url", `http://127.0.0.1:3000${route}`],
          { check: false, env: childEnv, cwd: workdir }
        );
        writeFileSync(logPath, redactSecrets(`\n${launch.stdout}\n${launch.stderr}`, config, env), { flag: "a", mode: 0o600 });
        if (launch.status !== 0) throw new AgentError(`Crabbox browser launch failed for ${route}`, 1);
        const launchEvidence = validateBrowserLaunchOutput(launch.stdout, route);

        const doctor = runCommand(
          "crabbox",
          ["desktop", "doctor", "--provider", selection.provider, "--id", leaseId],
          { check: false, env: childEnv, cwd: workdir }
        );
        writeFileSync(logPath, redactSecrets(`\n${doctor.stdout}\n${doctor.stderr}`, config, env), { flag: "a", mode: 0o600 });
        if (doctor.status !== 0) throw new AgentError(`Crabbox desktop did not settle for ${route}`, 1);

        const bundleDir = join(
          outputDir,
          `crabbox-${lane}-${stamp}-${String(index + 1).padStart(2, "0")}-${safeArtifactSlug(route, index)}`
        );
        mkdirSync(bundleDir, { recursive: true });
        const routeBindingPath = join(bundleDir, "route-binding.json");
        writeJson(routeBindingPath, {
          provider: selection.provider,
          leaseId,
          route,
          launchMarker,
          launchEvidence,
          launchStatus: launch.status,
          desktopDoctorStatus: doctor.status
        });
        const collected = runCommand(
          "crabbox",
          artifactArgs({ provider: selection.provider, leaseId, outputDir: bundleDir, proofKind }),
          { check: false, env: childEnv, cwd: workdir }
        );
        writeFileSync(logPath, redactSecrets(`\n${collected.stdout}\n${collected.stderr}`, config, env), { flag: "a", mode: 0o600 });
        if (collected.status !== 0) throw new AgentError(`Crabbox artifact collection failed for ${route}`, 1);
        const routeArtifacts = validateCollectedArtifacts(parseJsonDocument(collected.stdout), {
          provider: selection.provider,
          leaseId,
          proofKind,
          bundleDir,
          route,
          routeBindingPath,
          launchMarker,
          launchEvidence
        });
        artifacts.push(...routeArtifacts);
        artifactBindings.push({ route, bundleDir, launchMarker, launchEvidence, artifacts: routeArtifacts });
      }
    }
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  } finally {
    const recovered = visual ? recoverLeaseHandle(leasePath, selection.provider) : null;
    const cleanupLeaseId = recovered?.leaseId || leaseId;
    if (visual && recovered?.leaseId && leaseId && recovered.leaseId !== leaseId) {
      failure ||= "Crabbox lease output does not match timing provenance";
    }
    if (visual && cleanupLeaseId) {
      leaseId = cleanupLeaseId;
      cleanup = runCommand("crabbox", ["stop", "--provider", selection.provider, cleanupLeaseId], {
        check: false,
        env: childEnv,
        cwd: workdir
      });
      writeFileSync(logPath, redactSecrets(`\n${cleanup.stdout}\n${cleanup.stderr}`, config, env), { flag: "a", mode: 0o600 });
      if (cleanup.status !== 0) failure ||= `Crabbox lease cleanup failed for ${cleanupLeaseId}`;
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
    probedRoutes: visual && !failure ? routes : [],
    artifacts,
    artifactBindings,
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
