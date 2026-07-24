#!/usr/bin/env node
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  AgentError,
  commandExists,
  fail,
  finish,
  loadConfig,
  parseArgs,
  readText,
  runCommand,
  setGitHubOutput,
  secretState
} from "./agent-lib.mjs";

const CODEX_SANDBOXES = new Set(["read-only", "workspace-write", "danger-full-access"]);
const CODEX_EFFORTS = new Set(["none", "minimal", "low", "medium", "high", "xhigh"]);
const CODEX_MODEL = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const CODEX_LANES = Object.freeze({
  implement: Object.freeze({ model: "model", effort: "effort" }),
  "no-mistakes": Object.freeze({ model: "noMistakesModel", effort: "noMistakesEffort" }),
  proposer: Object.freeze({ model: "proposerModel", effort: "proposerEffort" }),
  review: Object.freeze({ model: "reviewModel", effort: "reviewEffort" })
});

function nonemptyString(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new AgentError(`invalid ${label}`, 2);
  return value;
}

export function resolveCodexSettings(config, requestedLane) {
  const lane = requestedLane === undefined ? "implement" : nonemptyString(requestedLane, "Codex lane");
  const keys = CODEX_LANES[lane];
  if (!keys) throw new AgentError(`unsupported Codex lane: ${lane}`, 2);
  return {
    lane,
    model: config.backend[keys.model] ?? config.backend.model ?? "",
    effort: config.backend[keys.effort] ?? config.backend.effort ?? "",
    sandbox: config.backend.sandbox ?? ""
  };
}

function codexArgs(args, config) {
  const promptFile = args["prompt-file"];
  if (!promptFile) throw new AgentError("missing --prompt-file", 2);
  const outputFile = args["output-file"];
  const settings = resolveCodexSettings(config, args.lane);
  const sandbox = args.sandbox ?? settings.sandbox;
  if (!CODEX_SANDBOXES.has(sandbox)) throw new AgentError(`unsupported Codex sandbox: ${sandbox}`, 2);
  const command = ["exec", "--sandbox", sandbox];
  const model = args.model ?? settings.model;
  const effort = args.effort ?? settings.effort;
  if (model) {
    const value = nonemptyString(model, "Codex model");
    if (!CODEX_MODEL.test(value)) throw new AgentError(`unsupported Codex model: ${value}`, 2);
    command.push("--model", value);
  }
  if (effort) {
    const value = nonemptyString(effort, "Codex effort");
    if (!CODEX_EFFORTS.has(value)) throw new AgentError(`unsupported Codex effort: ${value}`, 2);
    command.push("--config", `model_reasoning_effort=${JSON.stringify(value)}`);
  }
  if (args.schema) command.push("--output-schema", args.schema);
  if (outputFile) command.push("--output-last-message", outputFile);
  command.push("-");
  return command;
}

function codexAuthNames(config) {
  const configured = nonemptyString(config.secrets?.agentAuth, "agent auth secret name");
  return [...new Set([configured, "CODEX_API_KEY"])];
}

function codexEnvironment(config, source) {
  const configured = nonemptyString(config.secrets?.agentAuth, "agent auth secret name");
  const env = { ...source };
  const key = env.CODEX_API_KEY || env[configured];
  if (configured !== "CODEX_API_KEY") delete env[configured];
  if (key) env.CODEX_API_KEY = key;
  return env;
}

export const WORKER_BACKEND_ADAPTERS = Object.freeze({
  codex: Object.freeze({
    executable: "codex",
    args: codexArgs,
    authNames: codexAuthNames,
    environment: codexEnvironment
  })
});

export function resolveWorkerBackend(config, requestedBackend) {
  const backend = config?.backend;
  if (!backend || typeof backend !== "object" || Array.isArray(backend)) {
    throw new AgentError("invalid backend configuration", 2);
  }
  if (
    !Array.isArray(backend.allowed) ||
    backend.allowed.length === 0 ||
    backend.allowed.some((name) => typeof name !== "string" || !name.trim()) ||
    new Set(backend.allowed).size !== backend.allowed.length
  ) {
    throw new AgentError("backend.allowed must contain unique backend names", 2);
  }

  const defaultBackend = nonemptyString(backend.default, "default worker backend");
  if (!backend.allowed.includes(defaultBackend)) {
    throw new AgentError(`default worker backend is not allowed: ${defaultBackend}`, 2);
  }
  const unsupported = backend.allowed.find((name) => !WORKER_BACKEND_ADAPTERS[name]);
  if (unsupported) throw new AgentError(`allowed worker backend has no implemented adapter: ${unsupported}`, 2);
  const name = requestedBackend === undefined ? defaultBackend : nonemptyString(requestedBackend, "worker backend");
  if (!backend.allowed.includes(name)) throw new AgentError(`worker backend is not allowed: ${name}`, 2);

  const adapter = WORKER_BACKEND_ADAPTERS[name];
  return { name, adapter };
}

export function createWorkerInvocation(args, config, source = process.env) {
  const backend = resolveWorkerBackend(config, args.backend);
  const authNames = backend.adapter.authNames(config);
  return {
    backend: backend.name,
    executable: backend.adapter.executable,
    args: backend.adapter.args(args, config),
    auth: secretState(authNames, source),
    env: backend.adapter.environment(config, source)
  };
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const config = loadConfig();
  const dryRun = Boolean(args["dry-run"]);
  const backend = resolveWorkerBackend(config, args.backend);
  if (args["validate-backend"]) {
    const settings = resolveCodexSettings(config, args.lane);
    createWorkerInvocation(
      { ...args, "prompt-file": ".agent/prompts/implement.md" },
      config,
      {}
    );
    setGitHubOutput({
      backend: backend.name,
      effort: settings.effort,
      lane: settings.lane,
      model: settings.model,
      sandbox: settings.sandbox
    });
    finish(
      {
        ok: true,
        message: `configured ${settings.lane} worker backend: ${backend.name}`,
        backend: backend.name,
        ...settings
      },
      Boolean(args.json)
    );
    return;
  }

  const invocation = createWorkerInvocation(args, config);
  const hasAuth = invocation.auth.some((item) => item.present);
  if (!hasAuth && !dryRun) throw new AgentError("missing agent auth secret", 2, invocation.auth);
  if (!commandExists(invocation.executable) && !dryRun) {
    throw new AgentError(`${invocation.backend} worker CLI not found: ${invocation.executable}`, 2);
  }

  if (dryRun) {
    finish(
      {
        ok: true,
        message: `would run ${invocation.backend} worker`,
        backend: invocation.backend,
        command: [invocation.executable, ...invocation.args],
        auth: invocation.auth
      },
      Boolean(args.json)
    );
    return;
  }
  const result = runCommand(invocation.executable, invocation.args, {
    env: invocation.env,
    input: readText(args["prompt-file"]),
    stdio: ["pipe", "pipe", "pipe"],
    check: false
  });
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exitCode = result.status;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => fail(error, Boolean(parseArgs().json)));
}
