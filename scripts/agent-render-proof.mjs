#!/usr/bin/env node

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  AgentError,
  fail,
  finish,
  loadConfig,
  parseArgs,
  runCommand
} from "./agent-lib.mjs";

const FAILURE_STATUSES = new Set([
  "build_failed",
  "canceled",
  "cancelled",
  "pre_deploy_failed",
  "update_failed"
]);

function normalizedService(entry) {
  return entry?.service ?? entry;
}

export function selectRenderService(document, name) {
  if (!Array.isArray(document)) throw new AgentError("Render service inventory is invalid", 1);
  const matches = document
    .map(normalizedService)
    .filter((service) => service?.name === name && service?.type === "web_service");
  if (matches.length !== 1 || !String(matches[0]?.id ?? "").trim()) {
    throw new AgentError(`Render service ${name} did not resolve exactly once`, 1);
  }
  return matches[0];
}

function normalizedDeploy(entry) {
  return entry?.deploy ?? entry;
}

function deployCommit(deploy) {
  const value = deploy?.commit?.id ?? deploy?.commit;
  return typeof value === "string" ? value.toLowerCase() : "";
}

export function findRenderDeploy(document, expectedSha = "") {
  if (!Array.isArray(document)) throw new AgentError("Render deploy inventory is invalid", 1);
  const deploys = document.map(normalizedDeploy).filter(Boolean);
  if (expectedSha) {
    return deploys.find((deploy) => deployCommit(deploy) === expectedSha.toLowerCase()) ?? null;
  }
  return deploys.find((deploy) => deploy.status === "live") ?? deploys[0] ?? null;
}

export function parseRenderLogStream(output) {
  const text = String(output ?? "");
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[")) {
    let values;
    try {
      values = JSON.parse(trimmed);
    } catch {
      throw new AgentError("Render log stream is not valid JSON", 1);
    }
    if (
      !Array.isArray(values) ||
      values.some((value) => !value || typeof value !== "object" || Array.isArray(value))
    ) {
      throw new AgentError("Render log stream is not valid JSON", 1);
    }
    return values;
  }

  const records = [];
  let index = 0;
  while (index < text.length) {
    while (index < text.length && /\s/.test(text[index])) index += 1;
    if (index >= text.length) break;
    if (text[index] !== "{") {
      throw new AgentError("Render log stream is not valid JSON", 1);
    }
    const start = index;
    let depth = 0;
    let escaped = false;
    let inString = false;
    for (; index < text.length; index += 1) {
      const character = text[index];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (character === "\\") {
          escaped = true;
        } else if (character === "\"") {
          inString = false;
        }
        continue;
      }
      if (character === "\"") {
        inString = true;
      } else if (character === "{") {
        depth += 1;
      } else if (character === "}") {
        depth -= 1;
        if (depth === 0) {
          index += 1;
          break;
        }
      }
    }
    if (depth !== 0 || inString) {
      throw new AgentError("Render log stream is not valid JSON", 1);
    }
    let record;
    try {
      record = JSON.parse(text.slice(start, index));
    } catch {
      throw new AgentError("Render log stream is not valid JSON", 1);
    }
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      throw new AgentError("Render log stream is not valid JSON", 1);
    }
    records.push(record);
  }
  return records;
}

function labelMap(labels) {
  return new Map(
    (Array.isArray(labels) ? labels : [])
      .filter((label) => typeof label?.name === "string")
      .map((label) => [label.name, String(label.value ?? "")])
  );
}

export function summarizeRenderLogs(records) {
  const levels = {};
  const types = {};
  for (const record of records) {
    const labels = labelMap(record.labels);
    const level = labels.get("level") || "unknown";
    const type = labels.get("type") || "unknown";
    levels[level] = (levels[level] ?? 0) + 1;
    types[type] = (types[type] ?? 0) + 1;
  }
  return {
    count: records.length,
    levels,
    types,
    errorCount: Object.entries(levels)
      .filter(([level]) => /error|critical|fatal/i.test(level))
      .reduce((total, [, count]) => total + count, 0)
  };
}

export function evaluateRenderHealth(check, response, body, elapsedMs) {
  const clinic = body?.clinic;
  const passed =
    response.status === check.expectedStatus &&
    clinic?.slug === check.expectedClinicSlug &&
    clinic?.hostname === check.expectedHostname;
  return {
    url: check.url,
    status: response.status,
    elapsedMs,
    clinicSlug: typeof clinic?.slug === "string" ? clinic.slug : "",
    hostname: typeof clinic?.hostname === "string" ? clinic.hostname : "",
    passed
  };
}

async function withRenderReadRetry(operation, dependencies = {}) {
  const wait = dependencies.sleep ?? sleep;
  const delays = dependencies.renderRetryDelaysMs ?? [0, 2_000, 5_000];
  let lastError;
  for (let attempt = 0; attempt < delays.length; attempt += 1) {
    if (delays[attempt] > 0) await wait(delays[attempt]);
    try {
      return operation();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function renderJson(args, dependencies = {}) {
  const execute = dependencies.runCommand ?? runCommand;
  return withRenderReadRetry(() => {
    const result = execute("render", [...args, "-o", "json", "--confirm"], {
      env: dependencies.env ?? process.env,
      maxBuffer: 8 * 1024 * 1024
    });
    try {
      return JSON.parse(result.stdout);
    } catch {
      throw new AgentError("Render CLI returned invalid JSON", 1);
    }
  }, dependencies);
}

function renderMutationJson(args, dependencies = {}) {
  const execute = dependencies.runCommand ?? runCommand;
  const result = execute("render", [...args, "-o", "json", "--confirm"], {
    env: dependencies.env ?? process.env,
    maxBuffer: 8 * 1024 * 1024
  });
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new AgentError("Render CLI returned invalid JSON", 1);
  }
}

async function renderLogRecords(args, dependencies = {}) {
  const execute = dependencies.runCommand ?? runCommand;
  return withRenderReadRetry(() => {
    const result = execute("render", [...args, "-o", "json", "--confirm"], {
      env: dependencies.env ?? process.env,
      maxBuffer: 8 * 1024 * 1024
    });
    return parseRenderLogStream(result.stdout);
  }, dependencies);
}

function safeTimestamp(value, label) {
  const text = String(value ?? "");
  if (!text || !Number.isFinite(Date.parse(text))) {
    throw new AgentError(`Render deploy ${label} is invalid`, 1);
  }
  return text;
}

async function fetchHealth(check, timeoutSeconds, dependencies = {}) {
  const request = dependencies.fetch ?? fetch;
  const started = Date.now();
  let response;
  try {
    response = await request(check.url, {
      redirect: "error",
      signal: AbortSignal.timeout(timeoutSeconds * 1000),
      headers: { accept: "application/json" }
    });
  } catch (error) {
    throw new AgentError(`Render health request failed for ${new URL(check.url).hostname}: ${error.message}`, 1);
  }
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > 64_000) {
    throw new AgentError("Render health response exceeds its bounded limit", 1);
  }
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    throw new AgentError(`Render health response is not JSON for ${new URL(check.url).hostname}`, 1);
  }
  return evaluateRenderHealth(check, response, body, Date.now() - started);
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function verifyRenderDeployment(
  {
    config,
    expectedSha = "",
    ensureDeploy = false,
    timeoutSeconds = config.render.deployTimeoutSeconds,
    pollSeconds = config.render.pollSeconds
  },
  dependencies = {}
) {
  if (expectedSha && !/^[a-f0-9]{40}$/i.test(expectedSha)) {
    throw new AgentError("expected Render commit SHA is invalid", 2);
  }
  const services = await renderJson(["services"], dependencies);
  const service = selectRenderService(services, config.render.serviceName);
  if (service.serviceDetails?.url !== config.render.serviceUrl) {
    throw new AgentError("Render service URL does not match trusted configuration", 1);
  }
  const now = dependencies.now ?? (() => Date.now());
  const wait = dependencies.sleep ?? sleep;
  const deadline = now() + timeoutSeconds * 1000;
  let deploy = findRenderDeploy(
    await renderJson(["deploys", "list", service.id], dependencies),
    expectedSha
  );
  let createdDeployId = "";
  if (
    expectedSha &&
    ensureDeploy &&
    (!deploy || FAILURE_STATUSES.has(deploy.status))
  ) {
    const created = normalizedDeploy(
      renderMutationJson(
        ["deploys", "create", service.id, "--commit", expectedSha],
        dependencies
      )
    );
    createdDeployId = String(created?.id ?? "");
    if (!createdDeployId) {
      throw new AgentError("Render did not identify the requested exact deployment", 1);
    }
    deploy = null;
  }
  do {
    if (!deploy) {
      const inventory = await renderJson(
        ["deploys", "list", service.id],
        dependencies
      );
      deploy = createdDeployId
        ? inventory
            .map(normalizedDeploy)
            .find((candidate) => candidate?.id === createdDeployId) ?? null
        : findRenderDeploy(inventory, expectedSha);
    }
    if (deploy?.status === "live" || FAILURE_STATUSES.has(deploy?.status)) break;
    if (now() >= deadline) break;
    await wait(pollSeconds * 1000);
    deploy = null;
  } while (true);

  if (!deploy) {
    throw new AgentError(
      expectedSha
        ? "Render has not observed the exact merged commit"
        : "Render has no live deployment",
      1
    );
  }
  const deployedSha = deployCommit(deploy);
  if (expectedSha && deployedSha !== expectedSha.toLowerCase()) {
    throw new AgentError("Render deployment commit does not match the merged commit", 1);
  }
  if (deploy.status !== "live") {
    throw new AgentError(
      FAILURE_STATUSES.has(deploy.status)
        ? `Render deployment reached ${deploy.status}`
        : "Render deployment did not become live before the bounded timeout",
      1
    );
  }
  const createdAt = safeTimestamp(deploy.createdAt, "start time");
  const finishedAt = safeTimestamp(deploy.finishedAt, "finish time");
  const health = [];
  for (const check of config.render.healthChecks) {
    health.push(
      await fetchHealth(
        check,
        config.render.healthTimeoutSeconds,
        dependencies
      )
    );
  }
  const failedHealth = health.filter((result) => !result.passed);
  if (failedHealth.length) {
    throw new AgentError(
      `Render health failed for ${failedHealth.map((result) => new URL(result.url).hostname).join(", ")}`,
      1
    );
  }
  let logs = summarizeRenderLogs([]);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    logs = summarizeRenderLogs(
      await renderLogRecords(
        [
          "logs",
          "-r",
          service.id,
          "--start",
          createdAt,
          "--end",
          new Date(now()).toISOString(),
          "--limit",
          "200"
        ],
        dependencies
      )
    );
    if (logs.count > 0) break;
    if (attempt < 2) await wait(Math.min(pollSeconds, 5) * 1000);
  }
  if (logs.count === 0) {
    throw new AgentError(
      "Render returned no deployment or post-probe runtime log evidence",
      1
    );
  }
  return {
    version: 1,
    status: "passed",
    serviceName: config.render.serviceName,
    expectedSha: expectedSha.toLowerCase(),
    deployedSha,
    deployStatus: deploy.status,
    deployStartedAt: createdAt,
    deployFinishedAt: finishedAt,
    logs,
    health,
    summary: expectedSha
      ? "Exact merged revision is live with bounded logs and tenant-specific health."
      : "Current Render revision is live with bounded logs and tenant-specific health.",
    blocker: ""
  };
}

function writeRecord(path, value) {
  const target = resolve(path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

async function main(args = parseArgs()) {
  const config = loadConfig();
  if (!config.render) throw new AgentError("trusted Render configuration is missing", 1);
  const expectedSha = String(args["expected-sha"] ?? "");
  const outputFile = args["output-file"];
  try {
    const result = await verifyRenderDeployment({
      config,
      expectedSha,
      ensureDeploy: Boolean(args["ensure-deploy"]),
      timeoutSeconds: args["timeout-seconds"]
        ? Number(args["timeout-seconds"])
        : config.render.deployTimeoutSeconds,
      pollSeconds: args["poll-seconds"]
        ? Number(args["poll-seconds"])
        : config.render.pollSeconds
    });
    if (outputFile) writeRecord(outputFile, result);
    finish(
      { ok: true, message: result.summary, result },
      Boolean(args.json)
    );
  } catch (error) {
    const result = {
      version: 1,
      status: "failed",
      serviceName: config.render.serviceName,
      expectedSha: /^[a-f0-9]{40}$/i.test(expectedSha)
        ? expectedSha.toLowerCase()
        : "",
      deployedSha: "",
      deployStatus: "unknown",
      deployStartedAt: "",
      deployFinishedAt: "",
      logs: { count: 0, levels: {}, types: {}, errorCount: 0 },
      health: [],
      summary: "Trusted Render verification failed.",
      blocker: error?.message ?? String(error)
    };
    if (outputFile) writeRecord(outputFile, result);
    throw error;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => fail(error, Boolean(parseArgs().json)));
}
