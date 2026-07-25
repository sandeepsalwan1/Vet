#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = join(repoRoot, "opensrc", "sources.json");
const lockfilePath = join(repoRoot, "package-lock.json");

export function parseArgs(argv) {
  const flags = new Set(argv);
  const allowed = new Set(["--check", "--dry-run", "--json"]);
  const unknown = [...flags].filter((flag) => !allowed.has(flag));
  if (unknown.length > 0) {
    throw new Error(`unknown option ${unknown.join(", ")}`);
  }
  if (flags.has("--check") && flags.has("--dry-run")) {
    throw new Error("--check and --dry-run cannot be combined");
  }
  return {
    check: flags.has("--check"),
    dryRun: flags.has("--dry-run"),
    json: flags.has("--json")
  };
}

export function validateManifest(manifest) {
  if (manifest?.schemaVersion !== 1) throw new Error("unsupported manifest schema");
  if (!/^\d+\.\d+\.\d+$/.test(manifest.opensrcVersion ?? "")) {
    throw new Error("invalid opensrcVersion");
  }
  if (!Number.isFinite(manifest.maxCacheAgeHours) || manifest.maxCacheAgeHours <= 0) {
    throw new Error("invalid maxCacheAgeHours");
  }
  if (!Array.isArray(manifest.sources) || manifest.sources.length === 0) {
    throw new Error("sources must be a non-empty array");
  }

  const cacheNames = new Set();
  for (const source of manifest.sources) {
    if (!source.spec || !source.cacheName) throw new Error("source spec and cacheName are required");
    if (source.kind !== "npm" && source.kind !== "github") {
      throw new Error(`unsupported source kind for ${source.spec}`);
    }
    if (cacheNames.has(source.cacheName)) {
      throw new Error(`duplicate cacheName ${source.cacheName}`);
    }
    cacheNames.add(source.cacheName);
    if (source.kind === "npm" && !source.lockfilePath) {
      throw new Error(`lockfilePath is required for ${source.spec}`);
    }
    if (Boolean(source.snapshotManifest) !== Boolean(source.snapshotVersionKey)) {
      throw new Error(`snapshotManifest and snapshotVersionKey must be paired for ${source.spec}`);
    }
  }
  return manifest;
}

export function expectedSources(manifest, lockfile) {
  return manifest.sources.map((source) => {
    if (source.kind === "github") {
      return { ...source, section: "repos", version: "main" };
    }

    const version = lockfile.packages?.[source.lockfilePath]?.version;
    if (!version) throw new Error(`missing locked version for ${source.spec}`);
    return { ...source, section: "packages", version };
  });
}

export function validateSnapshots({ manifest, lockfile, root, read = readJson }) {
  for (const source of manifest.sources.filter((candidate) => candidate.snapshotManifest)) {
    const lockedVersion = lockfile.packages?.[source.lockfilePath]?.version;
    const snapshot = read(join(root, source.snapshotManifest));
    const snapshotVersion = snapshot[source.snapshotVersionKey];
    if (snapshotVersion !== lockedVersion) {
      throw new Error(
        `${source.spec}: tracked snapshot ${snapshotVersion ?? "missing"} does not match ${lockedVersion}`
      );
    }
  }
}

export function validateCache({ cache, expected, cacheRoot, maxAgeHours, now = Date.now() }) {
  const failures = [];
  const records = [];
  const maxAgeMs = maxAgeHours * 60 * 60 * 1000;

  for (const source of expected) {
    const record = cache[source.section]?.find(
      (candidate) =>
        candidate.name === source.cacheName && candidate.version === source.version
    );
    if (!record) {
      failures.push(`${source.cacheName}@${source.version}: missing cache record`);
      continue;
    }

    if (source.section === "repos") {
      const fetchedAt = Date.parse(record.fetchedAt);
      if (!Number.isFinite(fetchedAt) || now - fetchedAt > maxAgeMs || fetchedAt - now > 60_000) {
        failures.push(`${source.cacheName}@${source.version}: stale fetchedAt`);
      }
    }

    const absolutePath = join(cacheRoot, record.path);
    if (!existsSync(absolutePath)) {
      failures.push(`${source.cacheName}@${source.version}: missing ${absolutePath}`);
    }
    records.push({ name: source.cacheName, version: source.version, path: absolutePath });
  }

  if (failures.length > 0) throw new Error(failures.join("\n"));
  return records;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function githubToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;

  const result = spawnSync("gh", ["auth", "token"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"]
  });
  const token = result.stdout?.trim();
  if (result.status !== 0 || !token) {
    throw new Error("GitHub authentication unavailable; run gh auth login");
  }
  return token;
}

function fetchSources(manifest, jsonOutput) {
  const command = process.platform === "win32" ? "npx.cmd" : "npx";
  const args = [
    "--yes",
    `opensrc@${manifest.opensrcVersion}`,
    "fetch",
    "--cwd",
    repoRoot,
    ...manifest.sources.map((source) => source.spec)
  ];
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, GITHUB_TOKEN: githubToken() },
    stdio: jsonOutput ? ["ignore", "pipe", "pipe"] : "inherit"
  });
  if (result.status !== 0) {
    if (jsonOutput && result.stderr) process.stderr.write(result.stderr);
    throw new Error(`opensrc fetch failed with exit code ${result.status ?? "unknown"}`);
  }
}

export function syncSummary({ manifest, lockfile, cache, cacheRoot, now = Date.now() }) {
  const expected = expectedSources(manifest, lockfile);
  const records = validateCache({
    cache,
    expected,
    cacheRoot,
    maxAgeHours: manifest.maxCacheAgeHours,
    now
  });
  return {
    sourceCount: records.length,
    packageVersions: Object.fromEntries(
      records
        .filter((record) => !record.name.startsWith("github.com/"))
        .map((record) => [record.name, record.version])
    ),
    cacheRoot
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const manifest = validateManifest(readJson(manifestPath));
  const lockfile = readJson(lockfilePath);
  validateSnapshots({ manifest, lockfile, root: repoRoot });

  if (options.dryRun) {
    const summary = {
      sourceCount: manifest.sources.length,
      opensrcVersion: manifest.opensrcVersion,
      specs: manifest.sources.map((source) => source.spec)
    };
    console.log(options.json ? JSON.stringify(summary) : `opensrc: ${summary.sourceCount} sources configured`);
    return;
  }

  if (!options.check) fetchSources(manifest, options.json);

  const cacheRoot = process.env.OPENSRC_HOME || join(homedir(), ".opensrc");
  const summary = syncSummary({
    manifest,
    lockfile,
    cache: readJson(join(cacheRoot, "sources.json")),
    cacheRoot
  });
  if (options.json) {
    console.log(JSON.stringify(summary));
  } else {
    const packages = Object.entries(summary.packageVersions)
      .map(([name, version]) => `${name}@${version}`)
      .join(", ");
    console.log(`opensrc: ${summary.sourceCount} sources fresh; ${packages}; cache ${summary.cacheRoot}`);
  }
}

const invokedPath = process.argv[1] ? fileURLToPath(import.meta.url) === process.argv[1] : false;
if (invokedPath) {
  try {
    main();
  } catch (error) {
    console.error(`opensrc: ${error.message}`);
    process.exit(1);
  }
}
