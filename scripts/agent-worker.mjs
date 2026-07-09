#!/usr/bin/env node
import {
  AgentError,
  commandExists,
  fail,
  finish,
  loadConfig,
  parseArgs,
  readText,
  runCommand,
  secretState
} from "./agent-lib.mjs";

function codexArgs(args, config) {
  const promptFile = args["prompt-file"];
  if (!promptFile) throw new AgentError("missing --prompt-file", 2);
  const outputFile = args["output-file"];
  const sandbox = args.sandbox ?? config.backend.sandbox;
  const command = ["exec", "--sandbox", sandbox];
  if (args.schema) command.push("--output-schema", args.schema);
  if (outputFile) command.push("--output-last-message", outputFile);
  command.push("-");
  return command;
}

async function main() {
  const args = parseArgs();
  const config = loadConfig();
  const dryRun = Boolean(args["dry-run"]);
  const mode = args.mode ?? "codex";
  if (mode !== "codex") throw new AgentError(`unsupported worker mode: ${mode}`, 2);

  const auth = secretState([config.secrets.agentAuth, "CODEX_API_KEY"]);
  const hasAuth = auth.some((item) => item.present);
  if (!hasAuth && !dryRun) throw new AgentError("missing agent auth secret", 2, auth);
  if (!commandExists("codex") && !dryRun) throw new AgentError("codex CLI not found", 2);

  const command = codexArgs(args, config);
  if (dryRun) {
    finish({ ok: true, message: "would run codex worker", command: ["codex", ...command], auth }, Boolean(args.json));
    return;
  }
  const env = { ...process.env };
  if (!env.CODEX_API_KEY && env[config.secrets.agentAuth]) env.CODEX_API_KEY = env[config.secrets.agentAuth];
  const result = runCommand("codex", command, {
    env,
    input: readText(args["prompt-file"]),
    stdio: ["pipe", "pipe", "pipe"],
    check: false
  });
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exitCode = result.status;
}

main().catch((error) => fail(error, Boolean(parseArgs().json)));
