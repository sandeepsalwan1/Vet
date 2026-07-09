#!/usr/bin/env node
import {
  AgentError,
  commandExists,
  fail,
  finish,
  loadConfig,
  parseArgs,
  runCommand,
  secretState
} from "./agent-lib.mjs";

function providerAuth(config) {
  const names = [
    config.secrets.crabboxCoordinator,
    ...config.secrets.crabboxProviders,
    ...config.secrets.vercel
  ];
  const state = secretState(names);
  return {
    state,
    hasAny: state.some((item) => item.present),
    hasVisual: state.some((item) => ["HCLOUD_TOKEN", "HETZNER_TOKEN", "HETZNER_API_TOKEN"].includes(item.name) && item.present)
  };
}

async function main() {
  const args = parseArgs();
  const config = loadConfig();
  const dryRun = Boolean(args["dry-run"]);
  const lane = args.lane ?? "ciRemote";
  const command = args.command ?? config.crabbox.lanes[lane]?.[0];
  if (!command) throw new AgentError(`missing command for lane ${lane}`, 2);
  const auth = providerAuth(config);
  const visualLane = lane === "visualProof" || lane === "gifProof";
  if (!auth.hasAny && !dryRun) throw new AgentError("missing Crabbox provider auth", 2, auth.state);
  if (visualLane && !auth.hasVisual && !dryRun) throw new AgentError("missing Hetzner-compatible visual provider auth", 2, auth.state);
  if (!commandExists("crabbox") && !dryRun) throw new AgentError("crabbox CLI not found", 2);

  const providerArgs = [];
  if (visualLane) providerArgs.push("--provider", "hetzner");
  const crabArgs = ["run", ...providerArgs, "--timing-json", "--", "sh", "-lc", command];
  if (dryRun) {
    finish({ ok: true, message: "would run Crabbox command", lane, command: ["crabbox", ...crabArgs], auth: auth.state }, Boolean(args.json));
    return;
  }
  const result = runCommand("crabbox", crabArgs, { check: false, stdio: "inherit" });
  process.exitCode = result.status;
}

main().catch((error) => fail(error, Boolean(parseArgs().json)));
