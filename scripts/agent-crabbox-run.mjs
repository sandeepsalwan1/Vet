#!/usr/bin/env node
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  readSync,
  realpathSync,
  rmSync,
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
import { BROWSER_BEHAVIOR_MARKER } from "./agent-browser-behavior.mjs";

const VISUAL_LANES = new Set(["visualProof", "gifProof"]);
const FALLBACK_READINESS_LANE = "fallbackReadinessRemote";
const REMOTE_COMMAND_STARTED_MARKER = "AGENT_CRABBOX_REMOTE_COMMAND_STARTED_V1";
const LOCAL_CONTAINER_VISUAL_IMAGE =
  "node:22-bookworm@sha256:5647be709086c696ff32edaaf1c70cd26d1da6ab2b39c32f3c7b4c4a31957e37";
const DELEGATED_OUTPUTS = new Map([
  [
    "implementRemote",
    {
      marker: "AGENT_CRABBOX_IMPLEMENTATION_OUTPUT_V1 ",
      files: ["codex.patch", "implementation.md", "model-usage.json"],
    },
  ],
  [
    "reviewRemote",
    {
      marker: "AGENT_CRABBOX_REVIEW_OUTPUT_V1 ",
      files: ["review.json", "review.patch", "model-usage.json"],
      allowEmptyFiles: ["review.patch"],
    },
  ],
  [
    "noMistakesRemote",
    {
      marker: "AGENT_CRABBOX_NO_MISTAKES_OUTPUT_V1 ",
      files: ["result.json", "model-usage.json"],
      optionalFiles: ["fix.patch"],
    },
  ],
]);
const DELEGATED_INPUTS = new Map([
  ["implementRemote", ["implement-prompt.md", "implementation-intent.json"]],
  ["reviewRemote", ["review-prompt.md", "review.schema.json"]],
  ["noMistakesRemote", ["no-mistakes-intent"]]
]);
const MAX_DELEGATED_OUTPUT_BYTES = 2_500_000;
const MAX_DELEGATED_INPUT_BYTES = 2_500_000;

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

export function selectCrabboxProviders(config, lane, env = process.env) {
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

  if (lane === FALLBACK_READINESS_LANE) {
    return hasCredentialFreeVisualFallback
      ? [{ available: true, provider: credentialFreeVisualFallback, auth }]
      : [];
  }
  if (visual) {
    return [
      ...(hasReadyHetzner ? [{ available: true, provider: "hetzner", auth }] : []),
      ...(hasCredentialFreeVisualFallback
        ? [{ available: true, provider: credentialFreeVisualFallback, auth }]
        : [])
    ];
  }
  return [
    ...(hasVercel ? [{ available: true, provider: "vercel-sandbox", auth }] : []),
    ...(hasReadyHetzner ? [{ available: true, provider: "hetzner", auth }] : [])
  ];
}

export function selectCrabboxProvider(config, lane, env = process.env) {
  const candidates = selectCrabboxProviders(config, lane, env);
  if (candidates.length) return candidates[0];
  const visual = VISUAL_LANES.has(lane);
  const auth = secretState(
    [config.secrets.crabboxCoordinator, ...config.secrets.crabboxProviders, ...config.secrets.vercel],
    env
  );
  const vercelReadyName = config.crabbox?.readiness?.vercel ?? "CRABBOX_VERCEL_READY";
  const hetznerReadyName = config.crabbox?.readiness?.hetzner ?? "CRABBOX_HETZNER_READY";
  return {
    available: false,
    provider: "",
    reason:
      lane === FALLBACK_READINESS_LANE
        ? "credential-free Crabbox fallback is not configured"
        : visual
          ? env[hetznerReadyName] === "true"
            ? "ready Hetzner visual provider is missing its required auth"
            : "no visual Crabbox provider is configured"
          : env[vercelReadyName] === "true" || env[hetznerReadyName] === "true"
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
  if (DELEGATED_OUTPUTS.has(lane)) {
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

export function validateRouteBinding(
  path,
  {
    bundleDir,
    provider,
    leaseId,
    proofKind,
    route,
    launchMarker,
    launchEvidence,
    behaviorRequired = false,
    behaviorStatus = ""
  }
) {
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
    binding?.desktopDoctorStatus !== 0 ||
    binding?.computerUseStatus !== 0 ||
    (behaviorRequired &&
      (binding?.behaviorRequired !== true ||
        binding?.behaviorStatus !== behaviorStatus ||
        !binding?.behaviorReportPath)) ||
    (proofKind === "GIF" && binding?.captureStartedBeforeLaunch !== true)
  ) {
    throw new AgentError("Crabbox route binding does not match the captured route and lease", 1);
  }
  return bindingPath;
}

export function validateCollectedArtifacts(
  bundle,
  {
    provider,
    leaseId,
    proofKind,
    bundleDir,
    route,
    routeBindingPath,
    launchMarker,
    launchEvidence,
    behaviorRequired = false,
    behaviorStatus = ""
  }
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
    proofKind,
    route,
    launchMarker,
    launchEvidence,
    behaviorRequired,
    behaviorStatus
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

function remoteRelativePath(value, label, allowDot = false) {
  const path = String(value ?? "").trim();
  if (
    (!allowDot && !path) ||
    (allowDot && !path) ||
    isAbsolute(path) ||
    path.includes("\\") ||
    /^[A-Za-z]:/.test(path) ||
    path.split("/").some((segment) => segment === ".." || segment === "")
  ) {
    throw new AgentError(`invalid Crabbox ${label}`, 2);
  }
  if (path === "." && !allowDot) {
    throw new AgentError(`invalid Crabbox ${label}`, 2);
  }
  return path;
}

export function buildRunArgs({
  provider,
  command,
  visual,
  lane,
  leasePath,
  noSync = false,
  remoteHarnessPath = "scripts/agent-crabbox-run.mjs",
  remoteOutputPath = "."
}) {
  const args = ["run", "--provider", provider, "--timing-json", "--timing-record", "off"];
  let remoteCommand =
    `agent_crabbox_root="$PWD"; printf '${REMOTE_COMMAND_STARTED_MARKER}\\n' && ` +
    `( ${command} )`;
  if (provider === "local-container") args.push("--local-container-image", LOCAL_CONTAINER_VISUAL_IMAGE);
  if (noSync) args.push("--no-sync");
  const delegated = DELEGATED_OUTPUTS.get(lane);
  if (delegated) {
    const harness = remoteRelativePath(remoteHarnessPath, "remote harness path");
    const output = remoteRelativePath(remoteOutputPath, "remote output path", true);
    args.push("--allow-env", "CODEX_API_KEY");
    remoteCommand =
      `${remoteCommand} && AGENT_TARGET_ROOT="$agent_crabbox_root/${output}" ` +
      `node "$agent_crabbox_root/${harness}" --emit-output-lane ${lane} ` +
      `--output-workdir "$agent_crabbox_root/${output}"`;
  }
  if (visual) {
    args.push("--desktop", "--browser", "--keep", "--keep-on-failure");
    if (provider !== "local-container") args.push("--lease-output", leasePath);
  } else if (provider !== "vercel-sandbox") {
    args.push("--stop-after", "always");
  }
  args.push("--", "sh", "-lc", remoteCommand);
  return args;
}

export function emitDelegatedOutput(lane, workdir = repoRoot()) {
  const delegated = DELEGATED_OUTPUTS.get(lane);
  if (!delegated) throw new AgentError(`unsupported delegated output lane: ${lane}`, 2);
  const files = {};
  let totalBytes = 0;
  for (const name of [
    ...delegated.files,
    ...(delegated.optionalFiles ?? []),
  ]) {
    const path = join(workdir, ".agent-output", name);
    let info;
    try {
      info = lstatSync(path);
    } catch {
      if (delegated.optionalFiles?.includes(name)) continue;
      throw new AgentError(`Crabbox ${lane} output is missing: ${path}`, 1);
    }
    const allowEmpty = delegated.allowEmptyFiles?.includes(name);
    if (!info.isFile() || info.isSymbolicLink() || (!allowEmpty && info.size <= 0)) {
      throw new AgentError(
        `Crabbox ${lane} output is not a valid regular file: ${path}`,
        1
      );
    }
    totalBytes += info.size;
    if (totalBytes > MAX_DELEGATED_OUTPUT_BYTES) {
      throw new AgentError(`Crabbox ${lane} output exceeds the delegated handoff limit`, 1);
    }
    files[name] = readFileSync(path).toString("base64");
  }
  return `${delegated.marker}${JSON.stringify({ version: 1, lane, files })}`;
}

function delegatedInputFiles(lane) {
  const files = DELEGATED_INPUTS.get(lane);
  if (!files) throw new AgentError(`unsupported delegated input lane: ${lane}`, 2);
  return files;
}

function delegatedInputDirectory(workdir, lane) {
  return join(workdir, ".agent", "remote-input", lane);
}

function requireRealDirectory(path, label) {
  const info = lstatSync(path);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new AgentError(`Crabbox ${label} must be a real directory`, 1);
  }
  return path;
}

function readDelegatedInputFiles(lane, directory, { exact = true } = {}) {
  const names = delegatedInputFiles(lane);
  if (exact) {
    const entries = readdirSync(directory).sort();
    if (
      entries.length !== names.length ||
      names.some((name) => !entries.includes(name))
    ) {
      throw new AgentError(`Crabbox ${lane} input handoff has an invalid shape`, 1);
    }
  }
  let totalBytes = 0;
  return names.map((name) => {
    const path = join(directory, name);
    let info;
    try {
      info = lstatSync(path);
    } catch {
      throw new AgentError(`Crabbox ${lane} input is missing: ${path}`, 1);
    }
    if (!info.isFile() || info.isSymbolicLink() || info.size <= 0) {
      throw new AgentError(`Crabbox ${lane} input is not a valid regular file: ${path}`, 1);
    }
    totalBytes += info.size;
    if (totalBytes > MAX_DELEGATED_INPUT_BYTES) {
      throw new AgentError(`Crabbox ${lane} input exceeds the handoff limit`, 1);
    }
    return [name, readFileSync(path)];
  });
}

export function stageDelegatedInput(lane, workdir = repoRoot()) {
  const root = resolveCrabboxWorkdir(workdir);
  const agentDir = requireRealDirectory(join(root, ".agent"), "agent directory");
  const stagingRoot = join(agentDir, "remote-input");
  const stagingDir = delegatedInputDirectory(root, lane);
  if (existsSync(stagingDir)) {
    throw new AgentError(`Crabbox ${lane} input staging directory already exists`, 1);
  }
  const sourceDir = join(root, ".agent-output");
  const files = readDelegatedInputFiles(lane, sourceDir, { exact: false });
  if (existsSync(stagingRoot)) {
    requireRealDirectory(stagingRoot, "input staging root");
  } else {
    mkdirSync(stagingRoot, { mode: 0o700 });
  }
  mkdirSync(stagingDir, { mode: 0o700 });
  for (const [name, contents] of files) {
    writeFileSync(join(stagingDir, name), contents, { mode: 0o600 });
  }
  readDelegatedInputFiles(lane, stagingDir);
  return files.map(([name]) => join(stagingDir, name));
}

export function restoreDelegatedInput(lane, workdir = repoRoot()) {
  const root = resolveCrabboxWorkdir(workdir);
  const agentDir = requireRealDirectory(join(root, ".agent"), "agent directory");
  requireRealDirectory(join(agentDir, "remote-input"), "input staging root");
  const stagingDir = delegatedInputDirectory(root, lane);
  requireRealDirectory(stagingDir, `${lane} input staging path`);
  const files = readDelegatedInputFiles(lane, stagingDir);
  const outputDir = join(root, ".agent-output");
  if (existsSync(outputDir)) {
    requireRealDirectory(outputDir, "input output directory");
  } else {
    mkdirSync(outputDir, { mode: 0o700 });
  }
  const restored = [];
  for (const [name, contents] of files) {
    const path = join(outputDir, name);
    if (existsSync(path)) {
      const info = lstatSync(path);
      if (!info.isFile() || info.isSymbolicLink()) {
        throw new AgentError(`Crabbox delegated input target is not a regular file: ${path}`, 1);
      }
    }
    writeFileSync(path, contents, { mode: 0o600 });
    restored.push(path);
  }
  rmSync(stagingDir, { recursive: true });
  return restored;
}

export function restoreDelegatedOutput(lane, output, workdir = repoRoot()) {
  const delegated = DELEGATED_OUTPUTS.get(lane);
  if (!delegated) throw new AgentError(`unsupported delegated output lane: ${lane}`, 2);
  const markerIndex = String(output ?? "").lastIndexOf(delegated.marker);
  if (markerIndex === -1) throw new AgentError("Crabbox delegated output has no trusted handoff marker", 1);
  const encoded = String(output)
    .slice(markerIndex + delegated.marker.length)
    .split(/\r?\n/, 1)[0];
  let envelope;
  try {
    envelope = JSON.parse(encoded);
  } catch {
    throw new AgentError("Crabbox delegated output handoff is not valid JSON", 1);
  }
  if (
    envelope?.version !== 1 ||
    envelope?.lane !== lane ||
    !envelope.files ||
    Array.isArray(envelope.files) ||
    !delegated.files.every((name) => Object.hasOwn(envelope.files, name)) ||
    Object.keys(envelope.files).some(
      (name) =>
        !delegated.files.includes(name) &&
        !(delegated.optionalFiles ?? []).includes(name),
    )
  ) {
    throw new AgentError("Crabbox delegated output handoff has an invalid shape", 1);
  }

  let totalBytes = 0;
  const decoded = [];
  for (const name of Object.keys(envelope.files).sort()) {
    const value = envelope.files[name];
    const allowEmpty = delegated.allowEmptyFiles?.includes(name);
    if (
      typeof value !== "string" ||
      (!allowEmpty && !value) ||
      (value && !/^[A-Za-z0-9+/]+={0,2}$/.test(value))
    ) {
      throw new AgentError(`Crabbox delegated ${name} handoff is not canonical base64`, 1);
    }
    const contents = Buffer.from(value, "base64");
    if ((!allowEmpty && !contents.length) || contents.toString("base64") !== value) {
      throw new AgentError(`Crabbox delegated ${name} handoff is invalid`, 1);
    }
    totalBytes += contents.length;
    if (totalBytes > MAX_DELEGATED_OUTPUT_BYTES) {
      throw new AgentError("Crabbox delegated output exceeds the handoff limit", 1);
    }
    decoded.push([name, contents]);
  }

  const outputDir = join(workdir, ".agent-output");
  mkdirSync(outputDir, { recursive: true });
  const restored = [];
  for (const [name, contents] of decoded) {
    const path = join(outputDir, name);
    if (existsSync(path)) {
      const info = lstatSync(path);
      if (!info.isFile() || info.isSymbolicLink()) {
        throw new AgentError(`Crabbox delegated output target is not a regular file: ${path}`, 1);
      }
    }
    writeFileSync(path, contents, { mode: 0o600 });
    restored.push(path);
  }
  return restored;
}

export function emitImplementationOutput(workdir = repoRoot()) {
  return emitDelegatedOutput("implementRemote", workdir);
}

export function restoreImplementationOutput(output, workdir = repoRoot()) {
  return restoreDelegatedOutput("implementRemote", output, workdir);
}

function verifySession(session, timing, provider) {
  if (!session || session.provider !== provider || session.leaseId !== timing.leaseId || !session.kept) {
    throw new AgentError("Crabbox retained lease handle does not match timing provenance", 1);
  }
  return session;
}

function artifactArgs({ provider, leaseId, outputDir }) {
  return [
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
}

export function gifEncoderBootstrapCommands({
  proofKind,
  ffmpegAvailable = commandExists("ffmpeg"),
  platform = process.platform,
  githubActions = process.env.GITHUB_ACTIONS
}) {
  if (proofKind !== "GIF" || ffmpegAvailable) return [];
  if (platform !== "linux" || githubActions !== "true") {
    throw new AgentError("ffmpeg is required on the host for Crabbox GIF proof", 1);
  }
  return [
    ["sudo", ["apt-get", "update"]],
    ["sudo", ["apt-get", "install", "-y", "--no-install-recommends", "ffmpeg"]]
  ];
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

export function browserLaunchArgs({ provider, leaseId, route }) {
  const url = `http://127.0.0.1:3000${route}`;
  const browserFlags = [
    "--remote-debugging-address=127.0.0.1",
    "--remote-debugging-port=9222",
    "--no-first-run"
  ];
  const args = [
    "desktop",
    "launch",
    "--provider",
    provider,
    "--id",
    leaseId,
    "--browser",
    "--fullscreen"
  ];
  if (provider === "local-container") {
    args.push(
      "--",
      "/usr/local/bin/crabbox-browser",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      ...browserFlags,
      url
    );
  } else {
    args.push(
      "--",
      "sh",
      "-lc",
      `exec "$BROWSER" ${browserFlags.join(" ")} "$1"`,
      "agent-browser",
      url
    );
  }
  return args;
}

export function recordedBrowserLaunchScript({
  provider,
  leaseId,
  route,
  videoPath,
  contactSheetPath,
  behaviorCommand = ""
}) {
  const video = [
    "crabbox",
    "artifacts",
    "video",
    "--provider",
    provider,
    "--id",
    leaseId,
    "--output",
    videoPath,
    "--duration",
    "10s",
    "--fps",
    "30",
    "--contact-sheet-output",
    contactSheetPath
  ]
    .map(shellQuote)
    .join(" ");
  const launch = ["crabbox", ...browserLaunchArgs({ provider, leaseId, route })].map(shellQuote).join(" ");
  return [
    "set +e",
    `${video} &`,
    "video_pid=$!",
    "sleep 1",
    launch,
    "launch_status=$?",
    ...(behaviorCommand
      ? [
          `${behaviorCommand}`,
          "behavior_status=$?",
          'printf "AGENT_BROWSER_BEHAVIOR_EXIT %s\\n" "$behavior_status"'
        ]
      : []),
    'wait "$video_pid"',
    "video_status=$?",
    'if [ "$launch_status" -ne 0 ]; then exit "$launch_status"; fi',
    'if [ "$video_status" -ne 0 ]; then exit "$video_status"; fi'
  ].join("\n");
}

function browserBehaviorSource() {
  return readFileSync(fileURLToPath(new URL("./agent-browser-behavior.mjs", import.meta.url)), "utf8");
}

export function browserBehaviorArgs({ provider, leaseId, route, tasks }) {
  const source = Buffer.from(browserBehaviorSource(), "utf8").toString("base64");
  const payload = Buffer.from(
    JSON.stringify({
      baseUrl: "http://127.0.0.1:3000",
      route,
      tasks
    }),
    "utf8"
  ).toString("base64");
  const command = [
    "set -eu",
    `printf %s ${shellQuote(source)} | base64 -d > /tmp/agent-browser-behavior.mjs`,
    `node /tmp/agent-browser-behavior.mjs --payload-base64 ${shellQuote(payload)}`
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

export function parseBrowserBehaviorObservation(output, route) {
  const line = String(output ?? "")
    .split(/\r?\n/)
    .reverse()
    .find((value) => value.startsWith(BROWSER_BEHAVIOR_MARKER));
  if (!line) throw new AgentError(`Crabbox browser behavior produced no report for ${route}`, 1);
  let observation;
  try {
    observation = JSON.parse(
      Buffer.from(line.slice(BROWSER_BEHAVIOR_MARKER.length), "base64").toString("utf8")
    );
  } catch {
    throw new AgentError(`Crabbox browser behavior report is invalid for ${route}`, 1);
  }
  if (
    observation?.route !== route ||
    !["pass", "fail"].includes(observation?.status) ||
    !Array.isArray(observation?.taskResults) ||
    observation.taskResults.length === 0 ||
    observation.taskResults.some(
      (result) =>
        result?.route !== route ||
        !["pass", "fail"].includes(result?.status) ||
        !Array.isArray(result?.clauseIds) ||
        !Array.isArray(result?.reproductionSteps) ||
        !Array.isArray(result?.assertions)
    ) ||
    !Array.isArray(observation?.antiCheatProbes)
  ) {
    throw new AgentError(`Crabbox browser behavior report has an invalid shape for ${route}`, 1);
  }
  return observation;
}

export function gifArtifactArgs({ videoPath, gifPath, trimmedVideoPath }) {
  return [
    "artifacts",
    "gif",
    "--input",
    videoPath,
    "--output",
    gifPath,
    "--trimmed-video-output",
    trimmedVideoPath
  ];
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

function runCrabboxAttempt({
  config = loadConfig(),
  lane,
  command,
  routes = [],
  dryRun = false,
  env = process.env,
  workdir = repoRoot(),
  delegatedWorkdir = workdir,
  remoteHarnessPath = "scripts/agent-crabbox-run.mjs",
  remoteOutputPath = ".",
  noSync = false,
  behaviorPlan = null,
  selection,
  attempt = 0
}) {
  const visual = VISUAL_LANES.has(lane);
  const proofKind = lane === "gifProof" ? "GIF" : visual ? "UI" : "CI";
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

  const outputDir = join(delegatedWorkdir, ".agent-output");
  const stamp = `${Date.now()}-${process.pid}-${attempt + 1}-${selection.provider.replace(/[^a-z0-9-]/gi, "-")}`;
  const recordPath = join(outputDir, `crabbox-${lane}-${stamp}.json`);
  const logPath = join(outputDir, `crabbox-${lane}-${stamp}.log`);
  const leasePath = join(outputDir, `crabbox-${lane}-${stamp}-lease.json`);
  mkdirSync(outputDir, { recursive: true });
  const args = buildRunArgs({
    provider: selection.provider,
    command,
    visual,
    lane,
    leasePath,
    noSync,
    remoteHarnessPath,
    remoteOutputPath
  });
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
  const behaviorObservations = [];
  let failure = "";
  let remoteCommandStarted = false;

  try {
    run = runCommand("crabbox", args, {
      check: false,
      env: childEnv,
      cwd: workdir,
      maxBuffer: 8 * 1024 * 1024
    });
    remoteCommandStarted = `${run.stdout}\n${run.stderr}`.includes(
      REMOTE_COMMAND_STARTED_MARKER
    );
    writeFileSync(logPath, redactSecrets(`${run.stdout}\n${run.stderr}`, config, env), { mode: 0o600 });
    timing = validateTimingReport(parseTimingReport(`${run.stderr}\n${run.stdout}`), selection.provider);
    leaseId = timing.leaseId;
    if (run.status !== 0 || timing.exitCode !== 0) {
      throw new AgentError(`Crabbox command failed with exit ${timing.exitCode}`, 1);
    }

    const delegated = DELEGATED_OUTPUTS.get(lane);
    if (delegated) {
      artifacts.push(...restoreDelegatedOutput(lane, run.stdout, delegatedWorkdir));
    }

    if (visual) {
      validateProbedRoutes(run.stdout, routes);
      const session =
        selection.provider === "local-container"
          ? { provider: selection.provider, leaseId: timing.leaseId, kept: true }
          : verifySession(recoverLeaseHandle(leasePath, selection.provider), timing, selection.provider);
      leaseId = session.leaseId;
      for (const [bootstrapCommand, bootstrapArgs] of gifEncoderBootstrapCommands({
        proofKind,
        githubActions: env.GITHUB_ACTIONS
      })) {
        const bootstrap = runCommand(bootstrapCommand, bootstrapArgs, {
          check: false,
          env: childEnv,
          cwd: workdir
        });
        writeFileSync(logPath, redactSecrets(`\n${bootstrap.stdout}\n${bootstrap.stderr}`, config, env), {
          flag: "a",
          mode: 0o600
        });
        if (bootstrap.status !== 0) throw new AgentError("Could not install the host GIF encoder", 1);
      }
      for (const [index, route] of routes.entries()) {
        const routeTasks = (behaviorPlan?.tasks ?? []).filter(
          (task) => task.route === route
        );
        const behaviorRequired = Boolean(behaviorPlan);
        if (behaviorRequired && routeTasks.length === 0) {
          throw new AgentError(`browser proof plan has no task for ${route}`, 1);
        }
        const bundleDir = join(
          outputDir,
          `crabbox-${lane}-${stamp}-${String(index + 1).padStart(2, "0")}-${safeArtifactSlug(route, index)}`
        );
        mkdirSync(bundleDir, { recursive: true });
        const videoPath = join(bundleDir, "screen.mp4");
        const contactSheetPath = join(bundleDir, "screen.contact.png");
        const gifPath = join(bundleDir, "screen.trimmed.gif");
        const trimmedVideoPath = join(bundleDir, "screen.trimmed.mp4");
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
        const behaviorArgs = behaviorRequired
          ? browserBehaviorArgs({
              provider: selection.provider,
              leaseId,
              route,
              tasks: routeTasks
            })
          : null;
        const behaviorCommand = behaviorArgs
          ? ["crabbox", ...behaviorArgs].map(shellQuote).join(" ")
          : "";

        const launch =
          proofKind === "GIF"
            ? runCommand(
                "sh",
                [
                  "-c",
                  recordedBrowserLaunchScript({
                    provider: selection.provider,
                    leaseId,
                    route,
                    videoPath,
                    contactSheetPath,
                    behaviorCommand
                  })
                ],
                { check: false, env: childEnv, cwd: workdir }
              )
            : runCommand("crabbox", browserLaunchArgs({ provider: selection.provider, leaseId, route }), {
                check: false,
                env: childEnv,
                cwd: workdir
              });
        writeFileSync(logPath, redactSecrets(`\n${launch.stdout}\n${launch.stderr}`, config, env), { flag: "a", mode: 0o600 });
        if (launch.status !== 0) throw new AgentError(`Crabbox browser launch failed for ${route}`, 1);
        const launchEvidence = validateBrowserLaunchOutput(launch.stdout, route);
        let behavior = null;
        if (behaviorRequired) {
          if (proofKind === "GIF") {
            behavior = parseBrowserBehaviorObservation(launch.stdout, route);
          } else {
            const behaviorRun = runCommand("crabbox", behaviorArgs, {
              check: false,
              env: childEnv,
              cwd: workdir
            });
            writeFileSync(
              logPath,
              redactSecrets(`\n${behaviorRun.stdout}\n${behaviorRun.stderr}`, config, env),
              { flag: "a", mode: 0o600 }
            );
            behavior = parseBrowserBehaviorObservation(behaviorRun.stdout, route);
          }
          behaviorObservations.push(behavior);
        }

        const doctor = runCommand(
          "crabbox",
          ["desktop", "doctor", "--provider", selection.provider, "--id", leaseId],
          { check: false, env: childEnv, cwd: workdir }
        );
        writeFileSync(logPath, redactSecrets(`\n${doctor.stdout}\n${doctor.stderr}`, config, env), { flag: "a", mode: 0o600 });
        if (doctor.status !== 0) throw new AgentError(`Crabbox desktop did not settle for ${route}`, 1);

        const computerUse = runCommand(
          "crabbox",
          ["desktop", "key", "--provider", selection.provider, "--id", leaseId, "--keys", "Home"],
          { check: false, env: childEnv, cwd: workdir }
        );
        writeFileSync(logPath, redactSecrets(`\n${computerUse.stdout}\n${computerUse.stderr}`, config, env), {
          flag: "a",
          mode: 0o600
        });
        if (computerUse.status !== 0) throw new AgentError(`Crabbox computer input failed for ${route}`, 1);

        if (proofKind === "GIF") {
          const gif = runCommand(
            "crabbox",
            gifArtifactArgs({ videoPath, gifPath, trimmedVideoPath }),
            { check: false, env: childEnv, cwd: workdir }
          );
          writeFileSync(logPath, redactSecrets(`\n${gif.stdout}\n${gif.stderr}`, config, env), { flag: "a", mode: 0o600 });
          if (gif.status !== 0) throw new AgentError(`Crabbox GIF encoding failed for ${route}`, 1);
        }

        const behaviorReportPath = behavior
          ? join(bundleDir, "behavior-observation.json")
          : "";
        if (behaviorReportPath) writeJson(behaviorReportPath, behavior);
        const routeBindingPath = join(bundleDir, "route-binding.json");
        writeJson(routeBindingPath, {
          provider: selection.provider,
          leaseId,
          route,
          launchMarker,
          launchEvidence,
          launchStatus: launch.status,
          desktopDoctorStatus: doctor.status,
          computerUseStatus: computerUse.status,
          captureStartedBeforeLaunch: proofKind === "GIF",
          behaviorRequired,
          behaviorStatus: behavior?.status ?? "",
          behaviorReportPath
        });
        const collected = runCommand(
          "crabbox",
          artifactArgs({ provider: selection.provider, leaseId, outputDir: bundleDir }),
          { check: false, env: childEnv, cwd: workdir }
        );
        writeFileSync(logPath, redactSecrets(`\n${collected.stdout}\n${collected.stderr}`, config, env), { flag: "a", mode: 0o600 });
        if (collected.status !== 0) throw new AgentError(`Crabbox artifact collection failed for ${route}`, 1);
        const bundle = parseJsonDocument(collected.stdout);
        if (proofKind === "GIF" && bundle) {
          bundle.files ??= [];
          bundle.files.push(
            { kind: "video", path: videoPath },
            { kind: "gif", path: gifPath }
          );
          if (existsSync(contactSheetPath)) bundle.files.push({ kind: "contact-sheet", path: contactSheetPath });
          if (existsSync(trimmedVideoPath)) bundle.files.push({ kind: "trimmed-video", path: trimmedVideoPath });
        }
        const routeArtifacts = validateCollectedArtifacts(bundle, {
          provider: selection.provider,
          leaseId,
          proofKind,
          bundleDir,
          route,
          routeBindingPath,
          launchMarker,
          launchEvidence,
          behaviorRequired,
          behaviorStatus: behavior?.status ?? ""
        });
        if (behaviorReportPath) {
          routeArtifacts.push(
            validateRegularArtifact(
              behaviorReportPath,
              bundleDir,
              "behavior observation"
            )
          );
        }
        artifacts.push(...routeArtifacts);
        artifactBindings.push({
          route,
          bundleDir,
          launchMarker,
          launchEvidence,
          behavior,
          artifacts: routeArtifacts
        });
        if (behavior?.status === "fail") {
          throw new AgentError(
            `Crabbox browser behavior assertions failed for ${route}`,
            1
          );
        }
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
    behaviorObservations,
    remoteCommandStarted,
    logPath,
    cleanupStatus: cleanup?.status ?? null,
    reason: failure
  };
  writeJson(recordPath, record);
  return { ...record, recordPath };
}

function providerAttemptSummary(result) {
  return {
    provider: result.provider,
    leaseId: result.leaseId,
    attempted: result.attempted,
    ok: result.ok,
    remoteCommandStarted: result.remoteCommandStarted ?? false,
    cleanupStatus: result.cleanupStatus ?? null,
    reason: result.reason
  };
}

export function resolveCrabboxWorkdir(value = repoRoot()) {
  const target = resolve(value);
  let info;
  try {
    info = lstatSync(target);
  } catch {
    throw new AgentError("Crabbox workdir does not exist", 2);
  }
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new AgentError("Crabbox workdir must be a real directory", 2);
  }
  return realpathSync(target);
}

export function resolveDelegatedWorkdir(workdir, value = workdir) {
  const root = resolveCrabboxWorkdir(workdir);
  const target = resolveCrabboxWorkdir(value);
  const offset = relative(root, target);
  if (offset.startsWith("..") || isAbsolute(offset)) {
    throw new AgentError("Crabbox delegated workdir must stay inside the synced workdir", 2);
  }
  return target;
}

export function runCrabboxLane(options) {
  const config = options.config ?? loadConfig();
  const lane = options.lane;
  const env = options.env ?? process.env;
  const candidates = selectCrabboxProviders(config, lane, env);
  if (!candidates.length) {
    const selection = selectCrabboxProvider(config, lane, env);
    return {
      ok: false,
      attempted: false,
      lane,
      command: options.command,
      provider: "",
      leaseId: "",
      reason: selection.reason,
      auth: selection.auth,
      providerAttempts: []
    };
  }

  const attempts = [];
  for (const [index, selection] of candidates.entries()) {
    const result = runCrabboxAttempt({
      ...options,
      config,
      env,
      selection,
      attempt: index
    });
    attempts.push(providerAttemptSummary(result));
    const final = { ...result, providerAttempts: attempts };
    if (result.ok) return final;

    const acquisitionFailedBeforeRemoteExecution =
      result.attempted === true &&
      result.remoteCommandStarted !== true &&
      !result.leaseId &&
      !result.timing;
    if (!acquisitionFailedBeforeRemoteExecution || index === candidates.length - 1) {
      return final;
    }
  }
  throw new AgentError("Crabbox provider selection exhausted unexpectedly", 1);
}

export async function main() {
  const args = parseArgs();
  if (args["stage-input-lane"]) {
    const lane = String(args["stage-input-lane"]);
    const workdir = resolveCrabboxWorkdir(args["input-workdir"] ?? repoRoot());
    const files = stageDelegatedInput(lane, workdir);
    finish(
      { ok: true, message: `staged ${lane} input`, lane, files },
      Boolean(args.json)
    );
    return;
  }
  if (args["restore-input-lane"]) {
    const lane = String(args["restore-input-lane"]);
    const workdir = resolveCrabboxWorkdir(args["input-workdir"] ?? repoRoot());
    const files = restoreDelegatedInput(lane, workdir);
    finish(
      { ok: true, message: `restored ${lane} input`, lane, files },
      Boolean(args.json)
    );
    return;
  }
  if (args["emit-implementation-output"]) {
    process.stdout.write(`${emitImplementationOutput()}\n`);
    return;
  }
  if (args["emit-output-lane"]) {
    const outputWorkdir = resolveCrabboxWorkdir(
      args["output-workdir"] ?? repoRoot()
    );
    process.stdout.write(
      `${emitDelegatedOutput(String(args["emit-output-lane"]), outputWorkdir)}\n`
    );
    return;
  }
  const config = loadConfig();
  const dryRun = Boolean(args["dry-run"]);
  const lane = args.lane ?? "ciRemote";
  const command = args.command ?? config.crabbox.lanes[lane]?.[0];
  if (!command) throw new AgentError(`missing command for lane ${lane}`, 2);
  const routes = args.route ? [String(args.route)] : [];
  const workdir = resolveCrabboxWorkdir(args.workdir);
  const delegatedWorkdir = resolveDelegatedWorkdir(
    workdir,
    args["delegated-workdir"] ?? workdir
  );
  const remoteOutputPath = relative(workdir, delegatedWorkdir) || ".";
  const result = runCrabboxLane({
    config,
    lane,
    command,
    routes,
    dryRun,
    workdir,
    delegatedWorkdir,
    remoteHarnessPath: args["remote-harness"] ?? "scripts/agent-crabbox-run.mjs",
    remoteOutputPath
  });
  if (args["record-file"]) writeJson(resolve(args["record-file"]), result);
  finish(result, Boolean(args.json), result.ok ? 0 : result.attempted ? 1 : 2);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => fail(error, Boolean(parseArgs().json)));
}
