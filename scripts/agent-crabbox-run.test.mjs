import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  browserRouteMarker,
  browserRouteMarkerArgs,
  buildRunArgs,
  parseTimingReport,
  providerChildEnvironment,
  recoverLeaseHandle,
  runCrabboxLane,
  selectCrabboxProvider,
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

function writeRouteBinding(dir, overrides = {}) {
  const value = {
    provider: "hetzner",
    leaseId: "cbx_123",
    route: "/request",
    launchMarker: browserRouteMarker("/request"),
    launchEvidence: "launched: chromium http://127.0.0.1:3000/request",
    launchStatus: 0,
    desktopDoctorStatus: 0,
    ...overrides
  };
  const path = join(dir, "route-binding.json");
  writeFileSync(path, `${JSON.stringify(value)}\n`);
  return { path, value };
}

function artifactOptions(dir, overrides = {}) {
  const { binding: bindingOverrides, ...options } = overrides;
  const binding = writeRouteBinding(dir, bindingOverrides);
  return {
    provider: binding.value.provider,
    leaseId: binding.value.leaseId,
    proofKind: "UI",
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
  assert.equal(result.crabboxCommand.some((value) => /TOKEN|API_KEY/.test(value)), false);
});

test("remote implementation forwards only invocation auth and downloads generated outputs", () => {
  const args = buildRunArgs({
    provider: "vercel-sandbox",
    command: "run worker",
    visual: false,
    lane: "implementRemote",
    leasePath: "/tmp/unused.json"
  });

  assert.deepEqual(
    args.filter((value, index) => args[index - 1] === "--allow-env"),
    ["CODEX_API_KEY"]
  );
  assert.ok(args.includes(".agent-output/codex.patch=.agent-output/codex.patch"));
  assert.ok(args.includes(".agent-output/implementation.md=.agent-output/implementation.md"));
  assert.equal(args.includes("--stop-after"), false);
  assert.equal(args.includes("GH_TOKEN"), false);
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
      desktopDoctorStatus: 0
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
