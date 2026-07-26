import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { loadConfig } from "./agent-lib.mjs";
import {
  createWorkerInvocation,
  parseCodexUsage,
  preflightCodexModel,
  resolveCodexRunSettings,
  resolveCodexSettings,
  resolveWorkerBackend,
  validateCodexOutputSchema
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
  assert.deepEqual(invocation.args.slice(0, 9), [
    "exec",
    "--ephemeral",
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

test("Codex run settings resolve command overrides once for invocation and accounting", () => {
  assert.deepEqual(
    resolveCodexRunSettings(config(), {
      lane: "review",
      model: "gpt-override",
      effort: "high",
      sandbox: "read-only"
    }),
    {
      lane: "review",
      model: "gpt-override",
      effort: "high",
      sandbox: "read-only"
    }
  );
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
    "--ephemeral",
    "--json",
    "--sandbox",
    "workspace-write",
    "--model",
    "gpt-test",
    "--config",
    'model_reasoning_effort="medium"',
    "--config",
    'shell_environment_policy.exclude=["OPENAI_API_KEY","CODEX_API_KEY","CODEX_HOME","GITHUB_TOKEN","GH_TOKEN","AGENT_GITHUB_TOKEN","AGENT_PAT","CRABBOX_COORDINATOR_TOKEN"]',
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

test("Codex preflight verifies model metadata without making an inference request", async () => {
  const requests = [];
  const result = await preflightCodexModel({
    key: "secret",
    model: "gpt-test/revision",
    signal: undefined,
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: "gpt-test/revision", object: "model" })
      };
    }
  });

  assert.deepEqual(result, { model: "gpt-test/revision" });
  assert.equal(requests.length, 1);
  assert.equal(
    requests[0].url,
    "https://api.openai.com/v1/models/gpt-test%2Frevision"
  );
  assert.deepEqual(requests[0].options.headers, {
    Authorization: "Bearer secret"
  });
});

test("Codex preflight reports only safe HTTP failure metadata", async () => {
  const error = await assert.rejects(
    preflightCodexModel({
      key: "must-not-appear",
      model: "gpt-test",
      signal: undefined,
      fetchImpl: async () => ({
        ok: false,
        status: 401,
        json: async () => ({
          error: { message: "must-not-appear in diagnostics" }
        })
      })
    }),
    /Codex model preflight failed: HTTP 401/
  );

  assert.doesNotMatch(String(error), /must-not-appear/);
});

test("Codex preflight retries transient zero-model failures before succeeding", async () => {
  const statuses = [503, 429, 200];
  const retries = [];
  const sleeps = [];

  const result = await preflightCodexModel({
    key: "secret",
    model: "gpt-test",
    retryDelaysMs: [10, 20],
    sleepImpl: async (delayMs) => sleeps.push(delayMs),
    onRetry: (retry) => retries.push(retry),
    fetchImpl: async () => {
      const status = statuses.shift();
      return {
        ok: status === 200,
        status,
        json: async () => ({ id: "gpt-test", object: "model" })
      };
    }
  });

  assert.deepEqual(result, { model: "gpt-test" });
  assert.deepEqual(sleeps, [10, 20]);
  assert.deepEqual(
    retries.map(({ attempt, delayMs, failure, maxAttempts }) => ({
      attempt,
      delayMs,
      failure,
      maxAttempts
    })),
    [
      { attempt: 1, delayMs: 10, failure: "HTTP 503", maxAttempts: 3 },
      { attempt: 2, delayMs: 20, failure: "HTTP 429", maxAttempts: 3 }
    ]
  );
});

test("Codex preflight does not retry permanent authorization failures", async () => {
  let requests = 0;
  const sleeps = [];

  await assert.rejects(
    preflightCodexModel({
      key: "secret",
      model: "gpt-test",
      retryDelaysMs: [10],
      sleepImpl: async (delayMs) => sleeps.push(delayMs),
      fetchImpl: async () => {
        requests += 1;
        return {
          ok: false,
          status: 401,
          json: async () => ({})
        };
      }
    }),
    /Codex model preflight failed: HTTP 401/
  );

  assert.equal(requests, 1);
  assert.deepEqual(sleeps, []);
});

test("repository Codex output schemas use the supported strict subset", () => {
  const schemaDir = fileURLToPath(new URL("../.agent/schemas", import.meta.url));
  for (const name of readdirSync(schemaDir).filter((entry) => entry.endsWith(".json"))) {
    validateCodexOutputSchema(
      JSON.parse(readFileSync(join(schemaDir, name), "utf8"))
    );
  }
});

test("Codex output schema validation rejects unsupported or optional objects", () => {
  assert.doesNotThrow(() =>
    validateCodexOutputSchema({
      type: "object",
      additionalProperties: false,
      properties: {
        not: { type: "string" }
      },
      required: ["not"]
    })
  );
  assert.throws(
    () =>
      validateCodexOutputSchema({
        type: "object",
        additionalProperties: false,
        properties: {},
        required: [],
        oneOf: []
      }),
    /unsupported oneOf/
  );
  assert.throws(
    () =>
      validateCodexOutputSchema({
        type: "object",
        additionalProperties: false,
        properties: {
          values: {
            type: "array",
            uniqueItems: true,
            items: { type: "string" }
          }
        },
        required: ["values"]
      }),
    /unsupported uniqueItems/
  );
  assert.throws(
    () =>
      validateCodexOutputSchema({
        type: "object",
        additionalProperties: false,
        properties: { value: { type: "string" } },
        required: []
      }),
    /require all fields/
  );
  assert.throws(
    () =>
      validateCodexOutputSchema({
        type: "object",
        additionalProperties: false,
        properties: {
          status: { enum: ["passed"] }
        },
        required: ["status"]
      }),
    /constants and enums require a type/
  );
});
