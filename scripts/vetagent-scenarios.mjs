#!/usr/bin/env node

import {
  assertDeniedScenario,
  assertScenario,
  detailSummary,
  unique
} from "./vetagent-scenario-assertions.mjs";
import { scenarioDefinitions } from "./vetagent-scenario-data.mjs";

const rawArgs = process.argv.slice(2);
const args = new Set(rawArgs);
const jsonl = args.has("--jsonl");
const mode = args.has("--e2b") || process.env.SCENARIO_MODE === "e2b" ? "e2b" : "local";
const baseUrl = process.env.SCENARIO_BASE_URL || process.env.LOCAL_BASE_URL || "http://localhost:3000";
const runSalt = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
const scenarioUserAgent = `vetagent-scenarios/${runSalt}`;
const demoAdminPasscode = process.env.DEMO_ACCOUNTS === "disabled" ? "" : "246810";
const managerPasscode = process.env.VET_APP_ADMIN_PASSCODE || process.env.VET_ADMIN_PASSCODE || demoAdminPasscode;

function managerActor() {
  return {
    name: "Scenario Runner",
    role: "admin",
    passcode: managerPasscode
  };
}

const scenarios = scenarioDefinitions({ runSalt, managerActor });

function size(value) {
  return value ? Buffer.byteLength(value, "utf8") : 0;
}

function isLocalhost(url) {
  return /^https?:\/\/(localhost|127\.|0\.0\.0\.0|\[::1\])/i.test(url);
}

async function fetchRunDetail(runId, fetchImpl) {
  if (!runId || !managerPasscode) return null;
  const url = `${baseUrl}/api/agent/runs/${runId}?role=admin&name=Scenario%20Runner`;
  const response = await fetchImpl(url, {
    headers: {
      "user-agent": scenarioUserAgent,
      "x-central-vet-passcode": managerPasscode
    }
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  return response.ok ? data : { error: data.error || text, status: response.status };
}

async function runOne(scenario, provider, fetchImpl = fetch) {
  const started = performance.now();
  const method = scenario.method ?? "POST";
  const requestInit = {
    method,
    headers: {
      "content-type": "application/json",
      "user-agent": scenarioUserAgent
    }
  };
  if (method !== "GET" && method !== "HEAD" && scenario.body !== undefined) {
    requestInit.body = JSON.stringify(scenario.body);
  }
  const response = await fetchImpl(`${baseUrl}${scenario.path}`, requestInit);
  const text = await response.text();
  const ms = Math.round(performance.now() - started);
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { parseError: text.slice(0, 180) };
  }
  const detail = response.ok ? await fetchRunDetail(data.runId, fetchImpl).catch((error) => ({ error: error.message })) : null;
  const expectedStatus = scenario.expect?.status;
  const errors = typeof expectedStatus === "number"
    ? assertDeniedScenario(scenario, data, response.status)
    : response.ok ? assertScenario(scenario, data, detail) : [data.error || text.slice(0, 180) || `HTTP ${response.status}`];
  const runDetail = detailSummary(detail);
  const safety = {
    medicalAdviceGiven: data.result?.medicalAdviceGiven,
    requiresApproval: data.result?.requiresApproval,
    changedInvoices: data.result?.changedInvoices,
    changedPrices: data.result?.changedPrices
  };
  const proof = {
    recordsAuditSource: data.result?.audit?.audit?.source ?? null,
    recordsSentAutomatically: data.result?.recordsSentAutomatically ?? null,
    pickupSource: data.result?.source ?? null,
    candidateId: data.result?.candidate?.id ?? null,
    labVendor: data.result?.labVendor ?? null,
    labSource: data.result?.source === "mock lab data" ? data.result.source : null,
    rankedWorkFirst: data.result?.rankedWork?.[0] ?? null
  };
  return {
    label: scenario.label,
    method,
    path: scenario.path,
    ok: (typeof expectedStatus === "number" ? true : response.ok) && errors.length === 0,
    provider,
    status: response.status,
    ms,
    bytes: size(text),
    runId: data.runId ?? null,
    traceId: data.traceId ?? null,
    intent: data.intent ?? null,
    mode: data.mode ?? null,
    taskId: data.task?.id ?? null,
    approvalId: data.approval?.id ?? null,
    reportId: data.report?.id ?? null,
    toolCallCount: data.toolCalls?.length ?? 0,
    workflowEventCount: data.workflowEvents?.length ?? 0,
    toolNames: unique((data.toolCalls ?? []).map((tool) => tool.toolName)),
    workflowEventTypes: unique((data.workflowEvents ?? []).map((event) => event.eventType)),
    runDetail,
    proof,
    safety,
    errors
  };
}

function emit(results, provider) {
  let failed = 0;
  for (const result of results) {
    if (!result.ok) failed += 1;
    if (jsonl) {
      console.log(JSON.stringify(result));
      continue;
    }
    const state = result.ok ? "PASS" : "FAIL";
    const detail = result.errors.length ? ` ${result.errors.join("; ")}` : "";
    console.log(`${state} ${result.label}: ${result.method} ${result.path} ${result.status} ${result.ms}ms ${result.bytes}b runId=${result.runId || "none"} traceId=${result.traceId || "none"} tools=${result.toolCallCount}${detail}`);
  }
  const summary = {
    type: "summary",
    ok: failed === 0,
    passed: results.length - failed,
    failed,
    provider,
    baseUrl
  };
  if (jsonl) console.log(JSON.stringify(summary));
  else if (failed) {
    console.error(`FAIL ${failed} scenario check(s) failed for ${baseUrl}`);
    process.exitCode = 1;
  } else {
    console.log(`PASS all agent checks for ${baseUrl}`);
  }
  if (jsonl && failed) process.exitCode = 1;
}

async function resetClinic(fetchImpl = fetch) {
  if (!managerPasscode) return;
  const url = `${baseUrl}/api/mock/clinic?role=admin&name=Scenario%20Runner`;
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        "user-agent": scenarioUserAgent,
        "x-central-vet-passcode": managerPasscode
      }
    });
    if (!jsonl) {
      const data = await response.json().catch(() => ({}));
      console.log(`RESET mock clinic fixtures: ${response.status} reset=${data?.reset?.resetAppointments ?? "?"} (idempotent re-run support)`);
    }
  } catch {
    // best-effort reset; scenarios still run if the reset route is unavailable
  }
}

async function runLocal(provider = "local") {
  if (!managerPasscode) {
    const result = {
      label: "manager passcode",
      ok: false,
      provider,
      status: "ENV",
      ms: 0,
      runId: null,
      traceId: null,
      intent: null,
      taskId: null,
      approvalId: null,
      reportId: null,
      safety: {},
      errors: ["manager passcode missing and demo passcodes disabled"]
    };
    emit([result], provider);
    return;
  }
  await resetClinic();
  const results = [];
  for (const scenario of scenarios) {
    results.push(await runOne(scenario, provider));
  }
  emit(results, provider);
}

async function runE2B() {
  if (!process.env.E2B_API_KEY || isLocalhost(baseUrl)) {
    if (!jsonl) console.log("E2B unavailable for localhost or missing token; using local provider fallback.");
    await runLocal("local");
    return;
  }
  const { Sandbox } = await import("e2b");
  const sandbox = await Sandbox.create({
    apiKey: process.env.E2B_API_KEY,
    timeoutMs: 120_000,
    metadata: { app: "vetagent", run: "scenario" }
  });
  try {
    await sandbox.commands.run("node -e \"console.log('vetagent-e2b-ready')\"", { timeoutMs: 30_000 });
    if (!jsonl) console.log("E2B sandbox ready; running HTTP scenarios from local process against deployed URL.");
    await runLocal("e2b");
  } finally {
    await sandbox.kill().catch(() => {});
  }
}

if (mode === "e2b") await runE2B();
else await runLocal("local");
