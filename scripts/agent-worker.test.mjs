import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { loadConfig } from "./agent-lib.mjs";
import {
  createWorkerInvocation,
  parseCodexUsage,
  resolveCodexSettings,
  resolveWorkerBackend
} from "./agent-worker.mjs";

function config(overrides = {}) {
  return {
    backend: {
      default: "codex",
      allowed: ["codex"],
      model: "gpt-test",
      effort: "medium",
      sandbox: "workspace-write",
      ...overrides
    },
    secrets: { agentAuth: "OPENAI_API_KEY" }
  };
}

test("worker selects the configured default backend", () => {
  const selected = resolveWorkerBackend(config());

  assert.equal(selected.name, "codex");
  assert.equal(selected.adapter.executable, "codex");
});

test("repository config enables only implemented worker backends", () => {
  const repositoryConfig = loadConfig();

  assert.deepEqual(repositoryConfig.backend.allowed, ["codex"]);
  assert.equal(resolveWorkerBackend(repositoryConfig).name, "codex");
  assert.deepEqual(
    [
      resolveCodexSettings(repositoryConfig, "proposer"),
      resolveCodexSettings(repositoryConfig, "implement"),
      resolveCodexSettings(repositoryConfig, "review"),
      resolveCodexSettings(repositoryConfig, "no-mistakes")
    ].map(({ lane, model, effort }) => ({ lane, model, effort })),
    [
      { lane: "proposer", model: "gpt-5.4-mini", effort: "low" },
      { lane: "implement", model: "gpt-5.4-mini", effort: "low" },
      { lane: "review", model: "gpt-5.4-mini", effort: "low" },
      { lane: "no-mistakes", model: "gpt-5.4-mini", effort: "medium" }
    ]
  );
});

test("Codex lanes select configured overrides and otherwise inherit implementation defaults", () => {
  const laneConfig = config({ proposerModel: "gpt-nano", proposerEffort: "low" });
  const invocation = createWorkerInvocation({ "prompt-file": "prompt.md", lane: "proposer" }, laneConfig, {});

  assert.deepEqual(resolveCodexSettings(laneConfig, "review"), {
    lane: "review",
    model: "gpt-test",
    effort: "medium",
    sandbox: "workspace-write"
  });
  assert.deepEqual(invocation.args.slice(0, 8), [
    "exec",
    "--json",
    "--sandbox",
    "workspace-write",
    "--model",
    "gpt-nano",
    "--config",
    'model_reasoning_effort="low"'
  ]);
  assert.throws(() => resolveCodexSettings(laneConfig, "unknown"), /unsupported Codex lane: unknown/);
  assert.throws(() => resolveCodexSettings(laneConfig, "triage"), /unsupported Codex lane: triage/);
});

test("worker rejects defaults and overrides outside the backend allowlist", () => {
  assert.throws(
    () => resolveWorkerBackend(config({ default: "claude" })),
    /default worker backend is not allowed: claude/
  );
  assert.throws(() => resolveWorkerBackend(config(), "claude"), /worker backend is not allowed: claude/);
});

test("worker fails closed when an allowlisted backend has no adapter", () => {
  assert.throws(
    () => resolveWorkerBackend(config({ default: "claude", allowed: ["codex", "claude"] })),
    /allowed worker backend has no implemented adapter: claude/
  );
  assert.throws(
    () => resolveWorkerBackend(config({ allowed: ["codex", "claude"] })),
    /allowed worker backend has no implemented adapter: claude/
  );
});

test("worker rejects malformed backend allowlists", () => {
  assert.throws(() => resolveWorkerBackend(config({ allowed: [] })), /backend.allowed/);
  assert.throws(() => resolveWorkerBackend(config({ allowed: ["codex", "codex"] })), /backend.allowed/);
});

test("Codex adapter applies config defaults and scopes its auth name", () => {
  const source = { OPENAI_API_KEY: "secret", UNRELATED: "kept" };
  const invocation = createWorkerInvocation(
    { "prompt-file": "prompt.md", "output-file": "output.md", schema: "schema.json" },
    config(),
    source
  );

  assert.equal(invocation.backend, "codex");
  assert.equal(invocation.executable, "codex");
  assert.deepEqual(invocation.args, [
    "exec",
    "--json",
    "--sandbox",
    "workspace-write",
    "--model",
    "gpt-test",
    "--config",
    'model_reasoning_effort="medium"',
    "--config",
    'shell_environment_policy.exclude=["OPENAI_API_KEY","CODEX_API_KEY","GITHUB_TOKEN","GH_TOKEN","AGENT_PAT","CRABBOX_COORDINATOR_TOKEN"]',
    "--output-schema",
    "schema.json",
    "--output-last-message",
    "output.md",
    "-"
  ]);
  assert.deepEqual(invocation.auth, [
    { name: "OPENAI_API_KEY", present: true },
    { name: "CODEX_API_KEY", present: false }
  ]);
  assert.equal(invocation.env.CODEX_API_KEY, "secret");
  assert.equal(invocation.env.OPENAI_API_KEY, undefined);
  assert.equal(invocation.env.UNRELATED, "kept");
  assert.deepEqual(source, { OPENAI_API_KEY: "secret", UNRELATED: "kept" });
});

test("Codex usage parser records exact per-turn tokens without thread identifiers", () => {
  const usage = parseCodexUsage(
    [
      JSON.stringify({ type: "thread.started", thread_id: "private-thread-id" }),
      JSON.stringify({
        type: "turn.completed",
        usage: {
          input_tokens: 1200,
          cached_input_tokens: 800,
          output_tokens: 75,
          reasoning_output_tokens: 25
        }
      })
    ].join("\n"),
    { lane: "implement", model: "gpt-test", effort: "low" }
  );

  assert.equal(usage.complete, true);
  assert.equal(usage.calls.length, 1);
  assert.match(usage.calls[0].id, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(usage), /private-thread-id/);
  assert.deepEqual(usage.calls[0], {
    id: usage.calls[0].id,
    inputTokens: 1200,
    cachedInputTokens: 800,
    outputTokens: 75,
    reasoningOutputTokens: 25
  });
});

test("Codex usage parser fails closed on incomplete or inconsistent counters", () => {
  const usage = parseCodexUsage(
    JSON.stringify({
      type: "turn.completed",
      usage: {
        input_tokens: 10,
        cached_input_tokens: 11,
        output_tokens: 2,
        reasoning_output_tokens: 1
      }
    }),
    { lane: "review", model: "gpt-test", effort: "low" }
  );

  assert.equal(usage.complete, false);
  assert.deepEqual(usage.calls, []);
});

test("Codex adapter rejects unknown sandbox values", () => {
  assert.throws(
    () => createWorkerInvocation({ "prompt-file": "prompt.md" }, config({ sandbox: "host-write" }), {}),
    /unsupported Codex sandbox: host-write/
  );
});

test("Codex adapter rejects unsafe model and effort output values", () => {
  assert.throws(
    () => createWorkerInvocation({ "prompt-file": "prompt.md" }, config({ model: "bad\nmodel" }), {}),
    /unsupported Codex model/
  );
  assert.throws(
    () => createWorkerInvocation({ "prompt-file": "prompt.md" }, config({ effort: "maximum" }), {}),
    /unsupported Codex effort/
  );
});

test("worker dry-run reports auth presence without exposing its value", () => {
  const output = execFileSync(
    process.execPath,
    [
      fileURLToPath(new URL("./agent-worker.mjs", import.meta.url)),
      "--prompt-file",
      ".agent/prompts/implement.md",
      "--dry-run",
      "--json"
    ],
    {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      encoding: "utf8",
      env: { PATH: process.env.PATH, OPENAI_API_KEY: "must-not-appear" }
    }
  );

  assert.doesNotMatch(output, /must-not-appear/);
  assert.equal(JSON.parse(output).backend, "codex");
});
