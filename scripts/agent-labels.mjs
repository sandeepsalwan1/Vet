#!/usr/bin/env node
import { join } from "node:path";
import {
  createOrUpdateLabel,
  fail,
  finish,
  loadConfig,
  parseArgs,
  readJson,
  repoRoot
} from "./agent-lib.mjs";

async function main() {
  const args = parseArgs();
  const config = loadConfig();
  const labelsPath = args.labels ?? join(repoRoot(), ".agent/labels.json");
  const labels = readJson(labelsPath);
  const results = labels.map((label) => createOrUpdateLabel(config, label, Boolean(args["dry-run"])));
  finish(
    {
      ok: true,
      message: `${Boolean(args["dry-run"]) ? "would sync" : "synced"} ${results.length} agent labels`,
      labels: results
    },
    Boolean(args.json)
  );
}

main().catch((error) => fail(error, Boolean(parseArgs().json)));
