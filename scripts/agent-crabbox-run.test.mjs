import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  browserBehaviorArgs,
  browserLaunchArgs,
  browserRouteMarker,
  browserRouteMarkerArgs,
  buildRunArgs,
  createExactParentBundle,
  emitDelegatedOutput,
  emitImplementationOutput,
  gifArtifactArgs,
  gifEncoderBootstrapCommands,
  parseTimingReport,
  parseBrowserBehaviorObservation,
  prepareDelegatedWorkspace,
  providerChildEnvironment,
  recordedBrowserLaunchScript,
  recoverLeaseHandle,
  resolveDelegatedWorkdir,
  runCrabboxLane,
  restoreDelegatedInput,
  restoreDelegatedOutput,
  restoreImplementationOutput,
  seedExactRemoteRepository,
  selectCrabboxProvider,
  selectCrabboxProviders,
  stageDelegatedInput,
  validateBrowserLaunchOutput,
  validateBrowserRouteMarker,
  validateCollectedArtifacts,
  validateProbedRoutes,
  validateTimingReport
} from "./agent-crabbox-run.mjs";

const config = {
  secrets: {
    crabboxCoordinator: "CRABBOX_COORDINATOR_TOKEN",
    crabboxProviders: ["HCLOUD_TOKEN", "HETZNER_TOKEN", "HETZNER_API_TOKEN"],
    vercel: ["VERCEL_TOKEN", "VERCEL_OIDC_TOKEN"]
  },
  crabbox: {
    credentialFreeVisualFallback: "local-container",
    readiness: {
      vercel: "CRABBOX_VERCEL_READY",
      hetzner: "CRABBOX_HETZNER_READY"
    },
    visualProviders: ["hetzner", "local-container"],
    coordinatorProviders: ["aws"]
  }
};

const pngData = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from("fixture")
]);
const gifData = Buffer.from("GIF89a fixture");
const mp4Data = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypisomfixture")]);

test("GIF proof bootstraps its host encoder only on GitHub Linux", () => {
  assert.deepEqual(
    gifEncoderBootstrapCommands({
      proofKind: "GIF",
      ffmpegAvailable: false,
      platform: "linux",
      githubActions: "true"
    }),
    [
      ["sudo", ["apt-get", "update"]],
      ["sudo", ["apt-get", "install", "-y", "--no-install-recommends", "ffmpeg"]]
    ]
  );
  assert.deepEqual(
    gifEncoderBootstrapCommands({
      proofKind: "UI",
      ffmpegAvailable: false,
      platform: "linux",
      githubActions: "true"
    }),
    []
  );
  assert.deepEqual(
    gifEncoderBootstrapCommands({
      proofKind: "GIF",
      ffmpegAvailable: true,
      platform: "darwin",
      githubActions: undefined
    }),
    []
  );
  assert.throws(
    () =>
      gifEncoderBootstrapCommands({
        proofKind: "GIF",
        ffmpegAvailable: false,
        platform: "darwin",
        githubActions: undefined
      }),
    /ffmpeg is required/
  );
});

function writeRouteBinding(dir, overrides = {}) {
  const value = {
    provider: "hetzner",
    leaseId: "cbx_123",
    route: "/request",
    launchMarker: browserRouteMarker("/request"),
    launchEvidence: "launched: chromium http://127.0.0.1:3000/request",
    launchStatus: 0,
    desktopDoctorStatus: 0,
    computerUseStatus: 0,
    ...overrides
  };
  const path = join(dir, "route-binding.json");
  writeFileSync(path, `${JSON.stringify(value)}\n`);
  return { path, value };
}

function artifactOptions(dir, overrides = {}) {
  const { binding: bindingOverrides, ...options } = overrides;
  const proofKind = options.proofKind ?? "UI";
  const binding = writeRouteBinding(dir, {
    captureStartedBeforeLaunch: proofKind === "GIF",
    ...bindingOverrides
  });
  return {
    provider: binding.value.provider,
    leaseId: binding.value.leaseId,
    proofKind,
    bundleDir: dir,
    route: binding.value.route,
    routeBindingPath: binding.path,
    launchMarker: binding.value.launchMarker,
    launchEvidence: binding.value.launchEvidence,
    ...options
  };
}

test("timing parser selects the final complete Crabbox timing record", () => {
  const timing = parseTimingReport(`build output
{"provider":"vercel-sandbox","leaseId":"vsbx_123","totalMs":82,"exitCode":0}
cleanup output`);

  assert.equal(timing.provider, "vercel-sandbox");
  assert.equal(timing.leaseId, "vsbx_123");
});

test("timing validation requires actual provider, lease, duration, and exit", () => {
  const valid = { provider: "hetzner", leaseId: "cbx_123", totalMs: 82, exitCode: 0 };

  assert.equal(validateTimingReport(valid, "hetzner"), valid);
  assert.throws(() => validateTimingReport({ ...valid, provider: "github-actions" }, "hetzner"), /provider mismatch/);
  assert.throws(() => validateTimingReport({ ...valid, leaseId: "" }, "hetzner"), /no lease id/);
});

test("provider choice uses ready credentials, then credential-free visual Crabbox", () => {
  assert.equal(
    selectCrabboxProvider(config, "ciRemote", {
      VERCEL_TOKEN: "configured",
      CRABBOX_VERCEL_READY: "true"
    }).provider,
    "vercel-sandbox"
  );
  assert.equal(selectCrabboxProvider(config, "ciRemote", { VERCEL_TOKEN: "configured" }).available, false);
  assert.equal(
    selectCrabboxProvider(config, "ciRemote", {
      HCLOUD_TOKEN: "configured",
      CRABBOX_HETZNER_READY: "true"
    }).provider,
    "hetzner"
  );
  assert.equal(
    selectCrabboxProvider(config, "visualProof", {
      HCLOUD_TOKEN: "configured",
      CRABBOX_HETZNER_READY: "true"
    }).provider,
    "hetzner"
  );
  assert.equal(selectCrabboxProvider(config, "visualProof", {}).provider, "local-container");
  assert.equal(
    selectCrabboxProvider(config, "visualProof", { HCLOUD_TOKEN: "configured" }).provider,
    "local-container"
  );
  assert.equal(
    selectCrabboxProvider(config, "visualProof", { CRABBOX_HETZNER_READY: "true" }).provider,
    "local-container"
  );
  assert.equal(
    selectCrabboxProvider(config, "visualProof", { VERCEL_TOKEN: "configured" }).provider,
    "local-container"
  );
  assert.deepEqual(
    selectCrabboxProviders(config, "ciRemote", {
      VERCEL_TOKEN: "configured",
      CRABBOX_VERCEL_READY: "true",
      HCLOUD_TOKEN: "configured",
      CRABBOX_HETZNER_READY: "true"
    }).map((candidate) => candidate.provider),
    ["vercel-sandbox", "hetzner"]
  );
  assert.deepEqual(
    selectCrabboxProviders(config, "visualProof", {
      HCLOUD_TOKEN: "configured",
      CRABBOX_HETZNER_READY: "true"
    }).map((candidate) => candidate.provider),
    ["hetzner", "local-container"]
  );
  assert.equal(
    selectCrabboxProvider(config, "fallbackReadinessRemote", {}).provider,
    "local-container"
  );
});

test("provider acquisition failure retries the configured fallback before remote execution", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "vet-agent-provider-retry-"));
  const bin = join(dir, "bin");
  const workdir = join(dir, "work");
  const calls = join(dir, "calls.jsonl");
  mkdirSync(bin);
  mkdirSync(workdir);
  writeFileSync(
    join(bin, "crabbox"),
    `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
const provider = args[args.indexOf("--provider") + 1];
appendFileSync(${JSON.stringify(calls)}, JSON.stringify({ provider }) + "\\n");
if (provider === "vercel-sandbox") {
  process.stderr.write("provider acquisition unavailable\\n");
  process.exit(1);
}
process.stdout.write("AGENT_CRABBOX_REMOTE_COMMAND_STARTED_V1\\n");
process.stdout.write(JSON.stringify({
  provider,
  leaseId: "cbx_fallback",
  totalMs: 12,
  exitCode: 0
}) + "\\n");
`
  );
  chmodSync(join(bin, "crabbox"), 0o755);
  const originalPath = process.env.PATH;
  process.env.PATH = `${bin}:${originalPath}`;
  t.after(() => {
    process.env.PATH = originalPath;
    rmSync(dir, { recursive: true, force: true });
  });

  const result = runCrabboxLane({
    config,
    lane: "readinessRemote",
    command: "true",
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      VERCEL_TOKEN: "vercel",
      CRABBOX_VERCEL_READY: "true",
      HCLOUD_TOKEN: "hetzner",
      CRABBOX_HETZNER_READY: "true"
    },
    workdir
  });

  assert.equal(result.ok, true);
  assert.equal(result.provider, "hetzner");
  assert.deepEqual(
    result.providerAttempts.map((attempt) => ({
      provider: attempt.provider,
      ok: attempt.ok,
      remoteCommandStarted: attempt.remoteCommandStarted
    })),
    [
      { provider: "vercel-sandbox", ok: false, remoteCommandStarted: false },
      { provider: "hetzner", ok: true, remoteCommandStarted: true }
    ]
  );
  assert.deepEqual(
    readFileSync(calls, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line).provider),
    ["vercel-sandbox", "hetzner"]
  );
});

test("Crabbox child receives only selected provider auth and readiness", () => {
  const source = {
    PATH: "/usr/bin",
    CRABBOX_CONFIG: "/tmp/trusted.yaml",
    CRABBOX_VERCEL_SANDBOX_BRIDGE: "/tmp/bridge",
    CRABBOX_COORDINATOR_TOKEN: "coordinator",
    HCLOUD_TOKEN: "hetzner",
    HETZNER_TOKEN: "hetzner-alias",
    VERCEL_TOKEN: "vercel",
    VERCEL_OIDC_TOKEN: "vercel-oidc",
    CRABBOX_VERCEL_READY: "true",
    CRABBOX_HETZNER_READY: "true",
    CODEX_API_KEY: "agent",
    GH_TOKEN: "github"
  };

  assert.deepEqual(
    providerChildEnvironment(config, { provider: "vercel-sandbox", lane: "ciRemote" }, source),
    {
      PATH: "/usr/bin",
      CRABBOX_CONFIG: "/tmp/trusted.yaml",
      CRABBOX_VERCEL_SANDBOX_BRIDGE: "/tmp/bridge",
      VERCEL_TOKEN: "vercel",
      VERCEL_OIDC_TOKEN: "vercel-oidc",
      CRABBOX_VERCEL_READY: "true"
    }
  );
  assert.deepEqual(
    providerChildEnvironment(config, { provider: "hetzner", lane: "visualProof" }, source),
    {
      PATH: "/usr/bin",
      CRABBOX_CONFIG: "/tmp/trusted.yaml",
      HCLOUD_TOKEN: "hetzner",
      HETZNER_TOKEN: "hetzner-alias",
      CRABBOX_HETZNER_READY: "true"
    }
  );
  assert.deepEqual(
    providerChildEnvironment(config, { provider: "local-container", lane: "visualProof" }, source),
    {
      PATH: "/usr/bin",
      CRABBOX_CONFIG: "/tmp/trusted.yaml"
    }
  );
  assert.equal(
    providerChildEnvironment(config, { provider: "aws", lane: "ciRemote" }, source).CRABBOX_COORDINATOR_TOKEN,
    "coordinator"
  );
  assert.equal(
    providerChildEnvironment(config, { provider: "vercel-sandbox", lane: "implementRemote" }, source).CODEX_API_KEY,
    "agent"
  );
  assert.equal(
    providerChildEnvironment(config, { provider: "vercel-sandbox", lane: "reviewRemote" }, source).CODEX_API_KEY,
    "agent"
  );
  assert.equal(
    providerChildEnvironment(config, { provider: "vercel-sandbox", lane: "noMistakesRemote" }, source).CODEX_API_KEY,
    "agent"
  );
});

test("visual artifacts require a readiness marker for every requested route", () => {
  assert.deepEqual(
    validateProbedRoutes("AGENT_PROOF_ROUTE_OK /request\nAGENT_PROOF_ROUTE_OK /staff/tasks\n", [
      "/request",
      "/staff/tasks"
    ]),
    ["/request", "/staff/tasks"]
  );
  assert.throws(
    () => validateProbedRoutes("AGENT_PROOF_ROUTE_OK /request\n", ["/request", "/staff/tasks"]),
    /did not probe every affected route/
  );
});

test("per-route browser evidence is remote, exact, and direct-2xx only", () => {
  const args = browserRouteMarkerArgs({ provider: "hetzner", leaseId: "cbx_123", route: "/request" });
  const command = args.at(-1);

  assert.ok(args.includes("--no-sync"));
  assert.ok(args.includes("never"));
  assert.match(command, /%\{http_code\}/);
  assert.match(command, /2\?\?/);
  assert.equal(command.includes(" -L"), false);
  assert.equal(validateBrowserRouteMarker(`${browserRouteMarker("/request")}\n`, "/request"), browserRouteMarker("/request"));
  assert.throws(() => validateBrowserRouteMarker("launch complete\n", "/request"), /no remote route evidence/);
  assert.equal(
    validateBrowserLaunchOutput("launched: chromium http://127.0.0.1:3000/request\n", "/request"),
    "launched: chromium http://127.0.0.1:3000/request"
  );
  assert.throws(
    () => validateBrowserLaunchOutput("launched: chromium http://127.0.0.1:3000/wrong\n", "/request"),
    /no command evidence/
  );
});

test("local-container browser launch uses container-safe Chromium flags", () => {
  assert.deepEqual(browserLaunchArgs({ provider: "local-container", leaseId: "cbx_123", route: "/request" }), [
    "desktop",
    "launch",
    "--provider",
    "local-container",
    "--id",
    "cbx_123",
    "--browser",
    "--fullscreen",
    "--",
    "/usr/local/bin/crabbox-browser",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--remote-debugging-address=127.0.0.1",
    "--remote-debugging-port=9222",
    "--no-first-run",
    "http://127.0.0.1:3000/request"
  ]);
  assert.equal(browserLaunchArgs({ provider: "hetzner", leaseId: "cbx_123", route: "/request" }).includes("--no-sandbox"), false);
  assert.ok(
    browserLaunchArgs({
      provider: "hetzner",
      leaseId: "cbx_123",
      route: "/request"
    }).includes('exec "$BROWSER" --remote-debugging-address=127.0.0.1 --remote-debugging-port=9222 --no-first-run "$1"')
  );
});

test("GIF capture starts before the browser navigates and encodes that recording", () => {
  const script = recordedBrowserLaunchScript({
    provider: "local-container",
    leaseId: "cbx_123",
    route: "/request",
    videoPath: "/tmp/proof/screen.mp4",
    contactSheetPath: "/tmp/proof/screen.contact.png"
  });

  assert.ok(script.indexOf("'artifacts' 'video'") < script.indexOf("'desktop' 'launch'"));
  assert.ok(script.indexOf("sleep 1") < script.indexOf("'desktop' 'launch'"));
  assert.match(script, /'--duration' '10s'/);
  assert.match(script, /'--fps' '30'/);
  assert.match(script, /http:\/\/127\.0\.0\.1:3000\/request/);
  assert.deepEqual(
    gifArtifactArgs({
      videoPath: "/tmp/proof/screen.mp4",
      gifPath: "/tmp/proof/screen.trimmed.gif",
      trimmedVideoPath: "/tmp/proof/screen.trimmed.mp4"
    }),
    [
      "artifacts",
      "gif",
      "--input",
      "/tmp/proof/screen.mp4",
      "--output",
      "/tmp/proof/screen.trimmed.gif",
      "--trimmed-video-output",
      "/tmp/proof/screen.trimmed.mp4"
    ]
  );
});

test("browser behavior handoff is bounded to the retained lease and route", () => {
  const args = browserBehaviorArgs({
    provider: "local-container",
    leaseId: "cbx_123",
    route: "/request",
    tasks: [
      {
        clauseIds: ["AC1"],
        route: "/request",
        actions: [],
        intermediateAssertions: [],
        finalAssertions: [{ type: "visible", selector: "main" }]
      }
    ]
  });
  assert.ok(args.includes("--no-sync"));
  assert.ok(args.includes("cbx_123"));
  assert.equal(args.some((value) => value.includes("OPENAI_API_KEY")), false);

  const observation = {
    route: "/request",
    status: "pass",
    taskResults: [
      {
        route: "/request",
        status: "pass",
        clauseIds: ["AC1"],
        reproductionSteps: ["Navigate to /request"],
        assertions: [{ phase: "final", assertion: "main is visible", passed: true }]
      }
    ],
    antiCheatProbes: [
      { probe: "Rendered route binding", result: "Browser ended on /request." }
    ]
  };
  const output = `noise
AGENT_BROWSER_BEHAVIOR_V1 ${Buffer.from(JSON.stringify(observation)).toString("base64")}
`;
  assert.deepEqual(parseBrowserBehaviorObservation(output, "/request"), observation);
  assert.throws(
    () => parseBrowserBehaviorObservation(output, "/other"),
    /no report|invalid shape/
  );
});

test("remote implementation requires an explicitly ready Vercel provider", () => {
  assert.equal(
    selectCrabboxProvider(config, "implementRemote", {
      VERCEL_TOKEN: "configured",
      CRABBOX_VERCEL_READY: "true"
    }).provider,
    "vercel-sandbox"
  );
  assert.match(
    selectCrabboxProvider(config, "implementRemote", { VERCEL_TOKEN: "configured" }).reason,
    /readiness smoke/
  );
});

test("credential-free visual dry-run requests Crabbox desktop and browser", () => {
  const result = runCrabboxLane({
    config,
    lane: "visualProof",
    command: "npm run smoke:local",
    routes: ["/request"],
    dryRun: true,
    env: {}
  });

  assert.equal(result.ok, true);
  assert.equal(result.provider, "local-container");
  assert.ok(result.crabboxCommand.includes("--desktop"));
  assert.ok(result.crabboxCommand.includes("--browser"));
  assert.ok(result.crabboxCommand.includes("--keep"));
  assert.equal(result.crabboxCommand.includes("--lease-output"), false);
  assert.ok(
    result.crabboxCommand.includes(
      "node:22-bookworm@sha256:5647be709086c696ff32edaaf1c70cd26d1da6ab2b39c32f3c7b4c4a31957e37"
    )
  );
  assert.equal(result.crabboxCommand.some((value) => /TOKEN|API_KEY/.test(value)), false);
});

test("Vercel implementation uses a bounded stdout handoff instead of unsupported downloads", () => {
  const vercelArgs = buildRunArgs({
    provider: "vercel-sandbox",
    command: "run worker",
    visual: false,
    lane: "implementRemote",
    leasePath: "/tmp/unused.json"
  });

  assert.deepEqual(
    vercelArgs.filter((value, index) => vercelArgs[index - 1] === "--allow-env"),
    ["CODEX_API_KEY"]
  );
  assert.equal(vercelArgs.includes("--download"), false);
  assert.match(vercelArgs.at(-1), /AGENT_CRABBOX_REMOTE_COMMAND_STARTED_V1/);
  assert.match(
    vercelArgs.at(-1),
    /--emit-output-lane implementRemote --output-workdir "\$agent_crabbox_root\/\."$/
  );
  assert.equal(vercelArgs.includes("--stop-after"), false);
  assert.equal(vercelArgs.includes("GH_TOKEN"), false);

  const directArgs = buildRunArgs({
    provider: "hetzner",
    command: "run worker",
    visual: false,
    lane: "implementRemote",
    leasePath: "/tmp/unused.json"
  });
  assert.equal(directArgs.includes("--download"), false);
  assert.match(
    directArgs.at(-1),
    /--emit-output-lane implementRemote --output-workdir "\$agent_crabbox_root\/\."$/
  );
});

test("remote review uses the same bounded credential-free Crabbox handoff", (t) => {
  const remote = mkdtempSync(join(tmpdir(), "vet-agent-remote-review-"));
  const local = mkdtempSync(join(tmpdir(), "vet-agent-local-review-"));
  t.after(() => {
    rmSync(remote, { recursive: true, force: true });
    rmSync(local, { recursive: true, force: true });
  });
  mkdirSync(join(remote, ".agent-output"));
  writeFileSync(join(remote, ".agent-output/review.json"), "{}\n");
  writeFileSync(join(remote, ".agent-output/review.patch"), "");
  writeFileSync(join(remote, ".agent-output/model-usage.json"), "{\"complete\":true}\n");

  const args = buildRunArgs({
    provider: "vercel-sandbox",
    command: "run reviewer",
    visual: false,
    lane: "reviewRemote",
    leasePath: "/tmp/unused.json",
  });
  assert.deepEqual(
    args.filter((value, index) => args[index - 1] === "--allow-env"),
    ["CODEX_API_KEY"],
  );
  assert.match(
    args.at(-1),
    /--emit-output-lane reviewRemote --output-workdir "\$agent_crabbox_root\/\."$/
  );
  assert.equal(args.includes("--download"), false);
  assert.equal(args.includes("GH_TOKEN"), false);

  const output = `review log\n${emitDelegatedOutput("reviewRemote", remote)}\n`;
  const restored = restoreDelegatedOutput("reviewRemote", output, local);
  assert.deepEqual(restored, [
    join(local, ".agent-output/model-usage.json"),
    join(local, ".agent-output/review.json"),
    join(local, ".agent-output/review.patch"),
  ]);
  assert.equal(readFileSync(join(local, ".agent-output/review.patch"), "utf8"), "");
});

test("semantic lanes can sync a trusted sibling while restoring only into the candidate", (t) => {
  const root = mkdtempSync(join(tmpdir(), "vet-agent-semantic-root-"));
  const target = join(root, "target");
  const outside = mkdtempSync(join(tmpdir(), "vet-agent-semantic-outside-"));
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });
  mkdirSync(target);

  assert.equal(resolveDelegatedWorkdir(root, target), realpathSync(target));
  assert.throws(
    () => resolveDelegatedWorkdir(root, outside),
    /must stay inside the synced workdir/
  );

  const args = buildRunArgs({
    provider: "vercel-sandbox",
    command: "cd target && true",
    visual: false,
    lane: "reviewRemote",
    leasePath: "/tmp/unused.json",
    remoteHarnessPath: "trusted/scripts/agent-crabbox-run.mjs",
    remoteOutputPath: "target"
  });
  assert.match(args.at(-1), /\( cd target && true \)/);
  assert.match(
    args.at(-1),
    /AGENT_TARGET_ROOT="\$agent_crabbox_root\/target" node "\$agent_crabbox_root\/trusted\/scripts\/agent-crabbox-run\.mjs" --emit-output-lane reviewRemote --output-workdir "\$agent_crabbox_root\/target"$/
  );

  mkdirSync(join(target, ".agent-output"));
  writeFileSync(join(target, ".agent-output/review.json"), "{}\n");
  writeFileSync(join(target, ".agent-output/review.patch"), "");
  writeFileSync(join(target, ".agent-output/model-usage.json"), "{\"complete\":true}\n");
  cpSync("scripts", join(root, "trusted/scripts"), { recursive: true });
  const shellRun = spawnSync("sh", ["-lc", args.at(-1)], {
    cwd: root,
    encoding: "utf8"
  });
  assert.equal(shellRun.status, 0, shellRun.stderr);
  assert.match(shellRun.stdout, /AGENT_CRABBOX_REVIEW_OUTPUT_V1 /);

  const emitted = spawnSync(
    process.execPath,
    [
      fileURLToPath(new URL("./agent-crabbox-run.mjs", import.meta.url)),
      "--emit-output-lane",
      "reviewRemote",
      "--output-workdir",
      target
    ],
    {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, AGENT_TARGET_ROOT: root }
    }
  );
  assert.equal(emitted.status, 0, emitted.stderr);
  assert.match(emitted.stdout, /^AGENT_CRABBOX_REVIEW_OUTPUT_V1 /);
});

test("delegated workspace seals trusted and target files into one syncable git tree", (t) => {
  const root = mkdtempSync(join(tmpdir(), "vet-agent-delegated-bundle-"));
  const trusted = join(root, "trusted-source");
  const target = join(root, "target-source");
  const bundle = join(root, "bundle");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(trusted);
  mkdirSync(target);

  const git = (cwd, ...args) => {
    const result = spawnSync("git", args, { cwd, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  for (const repository of [trusted, target]) {
    git(repository, "init", "--quiet");
    git(repository, "config", "user.name", "Test");
    git(repository, "config", "user.email", "test@example.invalid");
  }
  mkdirSync(join(trusted, "scripts"));
  writeFileSync(join(trusted, "scripts/worker.mjs"), "export const trusted = true;\n");
  writeFileSync(join(trusted, "AGENTS.md"), "trusted\n");
  symlinkSync("AGENTS.md", join(trusted, "CLAUDE.md"));
  git(trusted, "add", "--all");
  git(trusted, "commit", "--quiet", "-m", "trusted");

  mkdirSync(join(target, ".agent"));
  mkdirSync(join(target, ".agent-output"));
  writeFileSync(join(target, ".gitignore"), "ignored-tracked.txt\n.agent-output/\n");
  writeFileSync(join(target, ".agent/config.json"), "{}\n");
  writeFileSync(join(target, "candidate.txt"), "candidate\n");
  writeFileSync(join(target, "ignored-tracked.txt"), "preserve tracked ignore\n");
  writeFileSync(join(target, "untracked-secret.txt"), "must not copy\n");
  writeFileSync(join(target, ".agent-output/review-prompt.md"), "review\n");
  writeFileSync(join(target, ".agent-output/review.schema.json"), "{}\n");
  git(target, "add", ".agent/config.json", ".gitignore", "candidate.txt");
  git(target, "add", "--force", "ignored-tracked.txt");
  git(target, "commit", "--quiet", "-m", "target");
  const targetTree = git(target, "rev-parse", "HEAD^{tree}");
  stageDelegatedInput("reviewRemote", target);

  const prepared = prepareDelegatedWorkspace({
    lane: "reviewRemote",
    trustedWorkdir: trusted,
    targetWorkdir: target,
    destination: bundle
  });

  assert.equal(readFileSync(join(bundle, "trusted/scripts/worker.mjs"), "utf8"), "export const trusted = true;\n");
  assert.equal(readFileSync(join(bundle, "trusted/CLAUDE.md"), "utf8"), "trusted\n");
  assert.equal(readFileSync(join(bundle, "candidate/candidate.txt"), "utf8"), "candidate\n");
  assert.equal(
    readFileSync(
      join(bundle, "candidate/.agent/remote-input/reviewRemote/review-prompt.md"),
      "utf8"
    ),
    "review\n"
  );
  assert.equal(
    readFileSync(join(bundle, "candidate/ignored-tracked.txt"), "utf8"),
    "preserve tracked ignore\n"
  );
  assert.equal(existsSync(join(bundle, "candidate/untracked-secret.txt")), false);
  assert.equal(existsSync(join(bundle, "trusted/.git")), false);
  assert.equal(existsSync(join(bundle, "candidate/.git")), false);
  assert.equal(existsSync(join(bundle, "target")), false);
  assert.equal(prepared.targetWorkdir, realpathSync(join(bundle, "candidate")));
  assert.deepEqual(prepared.inputFiles, [
    "review-prompt.md",
    "review.schema.json"
  ]);
  assert.match(
    git(bundle, "ls-files"),
    /candidate\/\.agent\/remote-input\/reviewRemote\/review-prompt\.md/
  );
  assert.match(
    git(bundle, "ls-files"),
    /candidate\/ignored-tracked\.txt/
  );
  assert.equal(git(bundle, "status", "--porcelain"), "");
  restoreDelegatedInput("reviewRemote", join(bundle, "candidate"));
  const seeded = seedExactRemoteRepository(join(bundle, "candidate"), {
    expectedTree: targetTree,
    branch: "agent/test"
  });
  assert.equal(seeded.tree, targetTree);
  assert.equal(seeded.branch, "agent/test");
  assert.equal(
    git(join(bundle, "candidate"), "ls-files", ".agent-output"),
    ""
  );
  assert.equal(
    git(join(bundle, "candidate"), "ls-files", ".agent/remote-input"),
    ""
  );
  assert.equal(
    git(join(bundle, "candidate"), "status", "--porcelain", "--untracked-files=all"),
    ""
  );
  assert.throws(
    () =>
      prepareDelegatedWorkspace({
        lane: "reviewRemote",
        trustedWorkdir: trusted,
        targetWorkdir: target,
        destination: join(target, "nested")
      }),
    /destination is unsafe/
  );
});

test("exact remote repository separates review parent from trusted default", (t) => {
  const root = mkdtempSync(join(tmpdir(), "vet-agent-exact-origin-"));
  const base = join(root, "base");
  const target = join(root, "target");
  const candidate = join(root, "candidate");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(base);
  mkdirSync(target);
  mkdirSync(candidate);
  const git = (cwd, ...args) => {
    const result = spawnSync("git", args, { cwd, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  for (const repository of [base, target]) {
    git(repository, "init", "--quiet", "-b", "main");
    git(repository, "config", "user.name", "Test");
    git(repository, "config", "user.email", "test@example.invalid");
    writeFileSync(join(repository, ".gitignore"), ".agent-output/\n");
  }
  writeFileSync(join(base, "candidate.txt"), "before\n");
  git(base, "add", "--all");
  git(base, "commit", "--quiet", "-m", "base");
  const baseSha = git(base, "rev-parse", "HEAD");
  const baseTree = git(base, "rev-parse", "HEAD^{tree}");
  writeFileSync(join(base, "trusted-default.txt"), "current\n");
  git(base, "add", "--all");
  git(base, "commit", "--quiet", "-m", "advance default");
  const defaultSha = git(base, "rev-parse", "HEAD");
  const defaultTree = git(base, "rev-parse", "HEAD^{tree}");
  mkdirSync(join(base, ".agent-output"));
  const parent = createExactParentBundle(base, {
    parentSha: baseSha,
    defaultSha,
    defaultBranch: "main"
  });
  assert.equal(
    git(base, "for-each-ref", "--format=%(refname)", "refs/agent/no-mistakes-export"),
    ""
  );

  writeFileSync(join(target, "candidate.txt"), "after\n");
  git(target, "add", "--all");
  git(target, "commit", "--quiet", "-m", "target");
  const targetTree = git(target, "rev-parse", "HEAD^{tree}");
  mkdirSync(join(candidate, ".agent-output"));
  cpSync(
    parent.path,
    join(candidate, ".agent-output/no-mistakes-parent.bundle")
  );
  writeFileSync(join(candidate, ".gitignore"), ".agent-output/\n");
  writeFileSync(join(candidate, "candidate.txt"), "after\n");

  const seeded = seedExactRemoteRepository(candidate, {
    expectedTree: targetTree,
    branch: "agent/test",
    originBundle: join(candidate, ".agent-output/no-mistakes-parent.bundle"),
    expectedParentTree: baseTree,
    expectedDefaultTree: defaultTree,
    defaultBranch: "main"
  });
  assert.equal(seeded.tree, targetTree);
  assert.equal(seeded.branch, "agent/test");
  assert.equal(git(candidate, "rev-parse", "HEAD^"), parent.parent);
  assert.equal(git(candidate, "rev-list", "--count", "HEAD^"), "1");
  assert.equal(git(candidate, "rev-parse", "origin/main^{tree}"), defaultTree);
  assert.equal(git(candidate, "rev-list", "--count", "origin/main"), "1");
  assert.equal(
    git(candidate, "remote", "get-url", "origin"),
    realpathSync(join(candidate, ".agent-output/no-mistakes-parent.bundle"))
  );
  assert.equal(git(candidate, "diff", "--name-only", "HEAD^", "HEAD"), "candidate.txt");
  assert.equal(git(candidate, "status", "--porcelain", "--untracked-files=all"), "");
});

test("remote no-mistakes handoff allows an absent sealed fix patch", (t) => {
  const remote = mkdtempSync(join(tmpdir(), "vet-agent-remote-gate-"));
  const local = mkdtempSync(join(tmpdir(), "vet-agent-local-gate-"));
  t.after(() => {
    rmSync(remote, { recursive: true, force: true });
    rmSync(local, { recursive: true, force: true });
  });
  mkdirSync(join(remote, ".agent-output"));
  writeFileSync(join(remote, ".agent-output/result.json"), "{\"status\":\"passed\"}\n");
  writeFileSync(join(remote, ".agent-output/model-usage.json"), "{\"complete\":true}\n");

  const output = emitDelegatedOutput("noMistakesRemote", remote);
  const restored = restoreDelegatedOutput("noMistakesRemote", output, local);
  assert.deepEqual(restored, [
    join(local, ".agent-output/model-usage.json"),
    join(local, ".agent-output/result.json"),
  ]);
});

test("delegated inputs cross Crabbox sync through a bounded nonignored handoff", (t) => {
  const lanes = new Map([
    ["implementRemote", ["implement-prompt.md", "implementation-intent.json"]],
    ["reviewRemote", ["review-prompt.md", "review.schema.json"]],
    ["noMistakesRemote", ["no-mistakes-intent", "no-mistakes-parent.bundle"]]
  ]);
  for (const [lane, names] of lanes) {
    const root = mkdtempSync(join(tmpdir(), `vet-agent-${lane}-input-`));
    const realRoot = realpathSync(root);
    t.after(() => rmSync(root, { recursive: true, force: true }));
    mkdirSync(join(root, ".agent"));
    mkdirSync(join(root, ".agent-output"));
    for (const name of names) {
      writeFileSync(join(root, ".agent-output", name), `${lane}:${name}\n`);
    }

    const staged = stageDelegatedInput(lane, root);
    assert.deepEqual(
      staged,
      names.map((name) => join(realRoot, ".agent", "remote-input", lane, name))
    );
    rmSync(join(root, ".agent-output"), { recursive: true });

    const restored = restoreDelegatedInput(lane, root);
    assert.deepEqual(
      restored,
      names.map((name) => join(realRoot, ".agent-output", name))
    );
    for (const name of names) {
      assert.equal(
        readFileSync(join(root, ".agent-output", name), "utf8"),
        `${lane}:${name}\n`
      );
    }
    assert.equal(existsSync(join(root, ".agent", "remote-input", lane)), false);
  }
});

test("delegated input staging rejects symlinks and unexpected files", (t) => {
  const root = mkdtempSync(join(tmpdir(), "vet-agent-input-reject-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, ".agent"));
  mkdirSync(join(root, ".agent-output"));
  writeFileSync(join(root, "prompt.md"), "prompt\n");
  symlinkSync(join(root, "prompt.md"), join(root, ".agent-output", "implement-prompt.md"));
  writeFileSync(join(root, ".agent-output", "implementation-intent.json"), "{}\n");
  assert.throws(
    () => stageDelegatedInput("implementRemote", root),
    /not a valid regular file/
  );

  rmSync(join(root, ".agent-output", "implement-prompt.md"));
  writeFileSync(join(root, ".agent-output", "implement-prompt.md"), "prompt\n");
  stageDelegatedInput("implementRemote", root);
  writeFileSync(
    join(root, ".agent", "remote-input", "implementRemote", "unexpected"),
    "unexpected\n"
  );
  assert.throws(
    () => restoreDelegatedInput("implementRemote", root),
    /invalid shape/
  );
});

test("delegated implementation output restores only the three bounded trusted files", (t) => {
  const remote = mkdtempSync(join(tmpdir(), "vet-agent-remote-output-"));
  const local = mkdtempSync(join(tmpdir(), "vet-agent-local-output-"));
  t.after(() => {
    rmSync(remote, { recursive: true, force: true });
    rmSync(local, { recursive: true, force: true });
  });
  mkdirSync(join(remote, ".agent-output"));
  writeFileSync(join(remote, ".agent-output/codex.patch"), "diff --git a/a b/a\n");
  writeFileSync(join(remote, ".agent-output/implementation.md"), "Implemented the issue.\n");
  writeFileSync(join(remote, ".agent-output/model-usage.json"), "{\"complete\":true}\n");

  const output = `worker log\n${emitImplementationOutput(remote)}\n`;
  const restored = restoreImplementationOutput(output, local);

  assert.deepEqual(restored, [
    join(local, ".agent-output/codex.patch"),
    join(local, ".agent-output/implementation.md"),
    join(local, ".agent-output/model-usage.json")
  ]);
  assert.equal(readFileSync(restored[0], "utf8"), "diff --git a/a b/a\n");
  assert.equal(readFileSync(restored[1], "utf8"), "Implemented the issue.\n");
  assert.throws(() => restoreImplementationOutput("no handoff", local), /handoff marker/);
});

test("delegated Vercel runs rely on one-shot cleanup instead of stop-after", () => {
  const args = buildRunArgs({
    provider: "vercel-sandbox",
    command: "npm test",
    visual: false,
    lane: "ciRemote",
    leasePath: "/tmp/unused.json"
  });

  assert.equal(args.includes("--stop-after"), false);
});

test("exact remote PR mode disables local workspace sync", () => {
  const args = buildRunArgs({
    provider: "vercel-sandbox",
    command: "verify exact head && npm test",
    visual: false,
    lane: "ciRemote",
    leasePath: "/tmp/unused.json",
    noSync: true
  });

  assert.ok(args.includes("--no-sync"));
  assert.equal(args.includes("--fresh-pr"), false);
  assert.equal(args.includes("--allow-env"), false);
  assert.equal(args.some((value) => /TOKEN|API_KEY/.test(value)), false);
});

test("artifact verification rejects an arbitrary provider or lease claim", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "vet-agent-proof-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const screenshot = join(dir, "screenshot.png");
  writeFileSync(screenshot, pngData);
  const options = artifactOptions(dir);
  const bundle = {
    directory: dir,
    metadata: { provider: "hetzner", leaseId: "cbx_123" },
    files: [{ kind: "screenshot", path: screenshot }]
  };

  assert.deepEqual(validateCollectedArtifacts(bundle, options), [options.routeBindingPath, screenshot]);
  assert.throws(
    () => validateCollectedArtifacts(bundle, { ...options, leaseId: "cbx_forged" }),
    /provenance does not match/
  );
  writeFileSync(
    options.routeBindingPath,
    `${JSON.stringify({
      provider: "hetzner",
      leaseId: "cbx_123",
      route: "/wrong",
      launchMarker: browserRouteMarker("/wrong"),
      launchEvidence: "launched: chromium http://127.0.0.1:3000/wrong",
      launchStatus: 0,
      desktopDoctorStatus: 0,
      computerUseStatus: 0
    })}\n`
  );
  assert.throws(() => validateCollectedArtifacts(bundle, options), /route binding does not match/);
});

test("GIF proof requires authentic video and GIF files from one bundle", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "vet-agent-gif-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const screenshot = join(dir, "screenshot.png");
  const video = join(dir, "screen.mp4");
  const gif = join(dir, "screen.gif");
  writeFileSync(screenshot, pngData);
  writeFileSync(video, mp4Data);
  writeFileSync(gif, gifData);
  const options = artifactOptions(dir, {
    proofKind: "GIF",
    binding: {
      leaseId: "cbx_456",
      route: "/staff/tasks",
      launchMarker: browserRouteMarker("/staff/tasks"),
      launchEvidence: "launched: chromium http://127.0.0.1:3000/staff/tasks"
    }
  });
  const base = { directory: dir, metadata: { provider: "hetzner", leaseId: "cbx_456" } };

  assert.throws(
    () =>
      validateCollectedArtifacts(
        {
          ...base,
          files: [
            { kind: "screenshot", path: screenshot },
            { kind: "gif", path: gif }
          ]
        },
        options
      ),
    /missing authentic video/
  );
  const complete = {
    ...base,
    files: [
      { kind: "screenshot", path: screenshot },
      { kind: "video", path: video },
      { kind: "gif", path: gif }
    ]
  };
  writeFileSync(video, "not a video");
  assert.throws(() => validateCollectedArtifacts(complete, options), /video output has an invalid media signature/);
  writeFileSync(video, mp4Data);
  writeFileSync(gif, "not a gif");
  assert.throws(() => validateCollectedArtifacts(complete, options), /gif output has an invalid media signature/);
  writeFileSync(gif, gifData);
  assert.deepEqual(
    validateCollectedArtifacts(complete, options),
    [options.routeBindingPath, screenshot, video, gif]
  );
  writeFileSync(
    options.routeBindingPath,
    `${JSON.stringify({
      ...JSON.parse(readFileSync(options.routeBindingPath, "utf8")),
      captureStartedBeforeLaunch: false
    })}\n`
  );
  assert.throws(() => validateCollectedArtifacts(complete, options), /route binding does not match/);
});

test("artifact verification rejects path escapes, symlinks, empty files, and forged media", (t) => {
  const root = mkdtempSync(join(tmpdir(), "vet-agent-artifact-safety-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const outside = join(root, "outside.png");
  writeFileSync(outside, pngData);

  function fixture(name, writer) {
    const dir = join(root, name);
    mkdirSync(dir);
    const screenshot = join(dir, "screenshot.png");
    writer(screenshot);
    return {
      bundle: {
        directory: dir,
        metadata: { provider: "hetzner", leaseId: "cbx_123" },
        files: [{ kind: "screenshot", path: screenshot }]
      },
      options: artifactOptions(dir)
    };
  }

  const escaped = fixture("escaped", () => {});
  escaped.bundle.files[0].path = outside;
  assert.throws(() => validateCollectedArtifacts(escaped.bundle, escaped.options), /path escapes/);

  const linked = fixture("linked", (path) => symlinkSync(outside, path));
  assert.throws(() => validateCollectedArtifacts(linked.bundle, linked.options), /not a nonempty regular file/);

  const empty = fixture("empty", (path) => writeFileSync(path, ""));
  assert.throws(() => validateCollectedArtifacts(empty.bundle, empty.options), /not a nonempty regular file/);

  const forged = fixture("forged", (path) => writeFileSync(path, "not a png"));
  assert.throws(() => validateCollectedArtifacts(forged.bundle, forged.options), /invalid media signature/);
});

test("lease output recovers cleanup identity when timing output is malformed", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "vet-agent-lease-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "lease.json");

  writeFileSync(path, '{"provider":"hetzner","leaseId":"cbx_123","kept":true}\n');
  assert.equal(parseTimingReport("malformed timing"), null);
  assert.deepEqual(recoverLeaseHandle(path, "hetzner"), {
    provider: "hetzner",
    leaseId: "cbx_123",
    kept: true
  });
  assert.equal(recoverLeaseHandle(path, "vercel-sandbox"), null);
  writeFileSync(path, "not json\n");
  assert.equal(recoverLeaseHandle(path, "hetzner"), null);
});

test("visual runner recovers and cleans a retained lease after malformed timing", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "vet-agent-cleanup-test-"));
  const bin = join(dir, "bin");
  const workdir = join(dir, "work");
  const crabbox = join(bin, "crabbox");
  const calls = join(dir, "calls.jsonl");
  mkdirSync(bin);
  mkdirSync(workdir);
  writeFileSync(
    crabbox,
    `#!/usr/bin/env node
import { appendFileSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(calls)}, JSON.stringify({
  args,
  env: {
    coordinator: process.env.CRABBOX_COORDINATOR_TOKEN ?? null,
    hetzner: process.env.HCLOUD_TOKEN ?? null,
    hetznerReady: process.env.CRABBOX_HETZNER_READY ?? null,
    vercel: process.env.VERCEL_TOKEN ?? null,
    vercelReady: process.env.CRABBOX_VERCEL_READY ?? null
  }
}) + "\\n");
if (args[0] === "run") {
  const output = args.indexOf("--lease-output");
  writeFileSync(args[output + 1], JSON.stringify({ provider: "hetzner", leaseId: "cbx_recovered", kept: true }) + "\\n");
  process.stdout.write("malformed timing\\n");
}
`
  );
  chmodSync(crabbox, 0o755);
  const originalPath = process.env.PATH;
  process.env.PATH = `${bin}:${originalPath}`;
  t.after(() => {
    process.env.PATH = originalPath;
    rmSync(dir, { recursive: true, force: true });
  });

  const result = runCrabboxLane({
    config,
    lane: "visualProof",
    command: "true",
    routes: ["/request"],
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      HCLOUD_TOKEN: "hetzner",
      CRABBOX_HETZNER_READY: "true",
      VERCEL_TOKEN: "vercel",
      CRABBOX_VERCEL_READY: "true",
      CRABBOX_COORDINATOR_TOKEN: "coordinator"
    },
    workdir
  });
  const records = readFileSync(calls, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));

  assert.equal(result.ok, false);
  assert.equal(result.leaseId, "cbx_recovered");
  assert.equal(result.cleanupStatus, 0);
  assert.deepEqual(records.at(-1).args, ["stop", "--provider", "hetzner", "cbx_recovered"]);
  assert.deepEqual(records[0].env, {
    coordinator: null,
    hetzner: "hetzner",
    hetznerReady: "true",
    vercel: null,
    vercelReady: null
  });
});
