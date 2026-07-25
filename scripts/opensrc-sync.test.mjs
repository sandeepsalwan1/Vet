import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  expectedSources,
  neutralizeMirrorManifests,
  parseArgs,
  restoreMirrorManifests,
  syncSummary,
  validateManifest,
  validateNeutralizedMirrorManifests,
  validateSnapshots
} from "./opensrc-sync.mjs";

const manifest = {
  schemaVersion: 1,
  opensrcVersion: "0.7.3",
  maxCacheAgeHours: 30,
  sources: [
    {
      spec: "@google/adk",
      kind: "npm",
      cacheName: "@google/adk",
      lockfilePath: "node_modules/@google/adk",
      snapshotManifest: "snapshot.json",
      snapshotVersionKey: "."
    },
    {
      spec: "https://github.com/a2aproject/A2A",
      kind: "github",
      cacheName: "github.com/a2aproject/A2A"
    }
  ]
};

test("parses safe sync modes", () => {
  assert.deepEqual(parseArgs(["--check", "--json"]), {
    check: true,
    dryRun: false,
    json: true
  });
  assert.throws(() => parseArgs(["--check", "--dry-run"]), /cannot be combined/);
  assert.throws(() => parseArgs(["--wat"]), /unknown option/);
});

test("resolves package versions from the lockfile", () => {
  validateManifest(manifest);
  const expected = expectedSources(manifest, {
    packages: { "node_modules/@google/adk": { version: "1.3.0" } }
  });
  assert.equal(expected[0].version, "1.3.0");
  assert.equal(expected[1].version, "main");
});

test("requires tracked snapshots to match the locked package", () => {
  const lockfile = {
    packages: { "node_modules/@google/adk": { version: "1.3.0" } }
  };
  validateSnapshots({
    manifest,
    lockfile,
    root: "/repo",
    read: () => ({ ".": "1.3.0" })
  });
  assert.throws(
    () =>
      validateSnapshots({
        manifest,
        lockfile,
        root: "/repo",
        read: () => ({ ".": "1.2.0" })
      }),
    /does not match/
  );
});

test("requires every configured cache entry to be fresh and present", () => {
  const cacheRoot = join(tmpdir(), `vet-opensrc-test-${process.pid}`);
  const packagePath = join(cacheRoot, "repos/google/adk-js/1.3.0");
  const a2aPath = join(cacheRoot, "repos/github.com/a2aproject/A2A/main");
  mkdirSync(packagePath, { recursive: true });
  mkdirSync(a2aPath, { recursive: true });
  writeFileSync(join(packagePath, "README.md"), "ADK");
  writeFileSync(join(a2aPath, "README.md"), "A2A");

  const fetchedAt = "2026-07-23T12:00:00.000Z";
  const summary = syncSummary({
    manifest,
    lockfile: {
      packages: { "node_modules/@google/adk": { version: "1.3.0" } }
    },
    cache: {
      packages: [
        {
          name: "@google/adk",
          version: "1.3.0",
          path: "repos/google/adk-js/1.3.0",
          fetchedAt: "2020-01-01T00:00:00.000Z"
        }
      ],
      repos: [
        {
          name: "github.com/a2aproject/A2A",
          version: "main",
          path: "repos/github.com/a2aproject/A2A/main",
          fetchedAt
        }
      ]
    },
    cacheRoot,
    now: Date.parse("2026-07-23T13:00:00.000Z")
  });

  assert.deepEqual(summary.packageVersions, { "@google/adk": "1.3.0" });
  assert.equal(summary.sourceCount, 2);
  assert.throws(
    () =>
      syncSummary({
        manifest,
        lockfile: {
          packages: { "node_modules/@google/adk": { version: "1.3.0" } }
        },
        cache: { packages: [], repos: [] },
        cacheRoot,
        now: Date.parse("2026-07-23T13:00:00.000Z")
      }),
    /missing cache record/
  );
  assert.throws(
    () =>
      syncSummary({
        manifest,
        lockfile: {
          packages: { "node_modules/@google/adk": { version: "1.3.0" } }
        },
        cache: {
          packages: [
            {
              name: "@google/adk",
              version: "1.3.0",
              path: "repos/google/adk-js/1.3.0",
              fetchedAt: "2020-01-01T00:00:00.000Z"
            }
          ],
          repos: [
            {
              name: "github.com/a2aproject/A2A",
              version: "main",
              path: "repos/github.com/a2aproject/A2A/main",
              fetchedAt: "2020-01-01T00:00:00.000Z"
            }
          ]
        },
        cacheRoot,
        now: Date.parse("2026-07-23T13:00:00.000Z")
      }),
    /stale fetchedAt/
  );
});

test("keeps upstream dependency manifests inert between source refreshes", (t) => {
  const root = mkdtempSync(join(tmpdir(), "vet-opensrc-manifests-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const nested = join(root, "upstream", "package");
  mkdirSync(nested, { recursive: true });
  const manifestPath = join(nested, "package.json");
  const lockfilePath = join(nested, "package-lock.json");
  writeFileSync(manifestPath, '{"name":"upstream"}\n');
  writeFileSync(lockfilePath, '{"lockfileVersion":3}\n');

  assert.equal(neutralizeMirrorManifests(root), 2);
  validateNeutralizedMirrorManifests(root);
  assert.equal(existsSync(manifestPath), false);
  assert.equal(readFileSync(`${manifestPath}.upstream`, "utf8"), '{"name":"upstream"}\n');

  assert.equal(restoreMirrorManifests(root), 2);
  assert.equal(existsSync(manifestPath), true);
  assert.throws(() => validateNeutralizedMirrorManifests(root), /active mirror dependency manifest/);
});

test("CI isolates byte-faithful mirrors without weakening application audit", () => {
  const workflow = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");

  assert.match(workflow, /git diff --check .* -- \. ':\(exclude\)opensrc\/\*\*'/);
  assert.match(workflow, /actions\/dependency-review-action@v5/);
  assert.doesNotMatch(workflow, /allow-ghsas/);
  assert.match(workflow, /npm audit --omit=dev/);
});
