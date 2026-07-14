import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildRunArgs,
  parseTimingReport,
  selectCrabboxProvider,
  validateCollectedArtifacts,
  validateTimingReport
} from "./agent-crabbox-run.mjs";

const config = {
  secrets: {
    crabboxCoordinator: "CRABBOX_COORDINATOR_TOKEN",
    crabboxProviders: ["HCLOUD_TOKEN", "HETZNER_TOKEN", "HETZNER_API_TOKEN"],
    vercel: ["VERCEL_TOKEN", "VERCEL_OIDC_TOKEN"]
  }
};

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

test("provider choice uses the matching lane credential", () => {
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
  assert.equal(selectCrabboxProvider(config, "visualProof", { HCLOUD_TOKEN: "configured" }).provider, "hetzner");
  assert.equal(selectCrabboxProvider(config, "visualProof", { VERCEL_TOKEN: "configured" }).available, false);
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
  assert.equal(args.includes("GH_TOKEN"), false);
});

test("artifact verification rejects an arbitrary provider or lease claim", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "vet-agent-proof-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const screenshot = join(dir, "screenshot.png");
  writeFileSync(screenshot, "authentic test fixture");
  const bundle = {
    metadata: { provider: "hetzner", leaseId: "cbx_123" },
    files: [{ kind: "screenshot", path: screenshot }]
  };

  assert.deepEqual(
    validateCollectedArtifacts(bundle, { provider: "hetzner", leaseId: "cbx_123", proofKind: "UI" }),
    [screenshot]
  );
  assert.throws(
    () => validateCollectedArtifacts(bundle, { provider: "hetzner", leaseId: "cbx_forged", proofKind: "UI" }),
    /provenance does not match/
  );
});

test("GIF proof requires authentic video and GIF files from one bundle", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "vet-agent-gif-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const video = join(dir, "screen.mp4");
  const gif = join(dir, "screen.gif");
  writeFileSync(video, "video fixture");
  writeFileSync(gif, "gif fixture");
  const base = { metadata: { provider: "hetzner", leaseId: "cbx_456" } };

  assert.throws(
    () =>
      validateCollectedArtifacts(
        { ...base, files: [{ kind: "gif", path: gif }] },
        { provider: "hetzner", leaseId: "cbx_456", proofKind: "GIF" }
      ),
    /missing authentic video/
  );
  assert.deepEqual(
    validateCollectedArtifacts(
      {
        ...base,
        files: [
          { kind: "video", path: video },
          { kind: "gif", path: gif }
        ]
      },
      { provider: "hetzner", leaseId: "cbx_456", proofKind: "GIF" }
    ),
    [video, gif]
  );
});
