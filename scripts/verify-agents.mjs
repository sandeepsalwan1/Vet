#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdir, appendFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const args = new Set(process.argv.slice(2));
const allowFallback = args.has("--allow-fallback");
const jsonl = args.has("--jsonl");
const baseUrl = process.env.LOCAL_BASE_URL || process.env.SCENARIO_BASE_URL || "http://localhost:3000";
const proofPath = process.env.VERIFY_AGENTS_PROOF_PATH || join(tmpdir(), "central-vet-agent-proof.md");

function envState(name) {
  return process.env[name] ? "present" : "missing";
}

function hasGoogleCreds() {
  return Boolean(
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.GOOGLE_GENAI_USE_VERTEXAI === "TRUE" ||
    process.env.GOOGLE_GENAI_USE_VERTEXAI === "true"
  );
}

async function reachable() {
  try {
    const response = await fetch(`${baseUrl}/api/mock/clinic`, {
      headers: { "user-agent": "verify-agents" }
    });
    return response.status < 500;
  } catch {
    return false;
  }
}

function runJsonlScenarios() {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["scripts/vetagent-scenarios.mjs", "--jsonl"], {
      env: {
        ...process.env,
        AGENT_RUNTIME: "google-adk",
        LOCAL_BASE_URL: baseUrl
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

function parseJsonl(output) {
  return output
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return { ok: false, label: "jsonl parse", errors: [`invalid JSONL: ${line.slice(0, 120)}`] };
      }
    });
}

async function gitValue(args) {
  const { spawnSync } = await import("node:child_process");
  const result = spawnSync("git", args, { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : "unknown";
}

async function migrationList() {
  const files = await readdir("db/migrations");
  return files.filter((file) => file.endsWith(".sql")).sort();
}

function actualCommand() {
  const suffix = process.argv.slice(2).join(" ");
  if (process.env.npm_lifecycle_event) {
    return `npm run ${process.env.npm_lifecycle_event}${suffix ? ` -- ${suffix}` : ""}`;
  }
  return `node ${process.argv.slice(1).join(" ")}`;
}

async function grep(args) {
  const { spawnSync } = await import("node:child_process");
  return spawnSync("grep", args, { encoding: "utf8" });
}

async function duplicateAudits() {
  const audits = [];
  const legacyWorkflow = await grep(["-R", "_workflow", "apps/internal/app/api/agent", "packages/agents"]);
  const legacyWorkflowLines = legacyWorkflow.stdout
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((line) => !line.includes("_workflowRoutes"));
  audits.push({
    label: "no legacy _workflow references",
    ok: legacyWorkflowLines.length === 0,
    detail: legacyWorkflowLines.length ? legacyWorkflowLines.join(" | ") : "none"
  });
  const noRouteRuns = await grep(["-R", "-E", "export async function runCheckin|export async function runBooking|export async function runRecords|export async function runPricing|export async function runDailyOps", "apps/internal/app/api/agent"]);
  audits.push({
    label: "no route-local run* agent functions",
    ok: noRouteRuns.status === 1,
    detail: noRouteRuns.status === 1 ? "none" : (noRouteRuns.stdout || noRouteRuns.stderr).trim()
  });
  const allowedPersistenceFiles = [
    "apps/internal/app/api/agent/_runner.ts:",
    "apps/internal/app/api/agent/_effectPersistence.ts:"
  ];
  for (const fn of ["createTask(", "createApproval(", "createAgentReport("]) {
    const result = await grep(["-R", fn, "apps/internal/app/api/agent"]);
    const lines = result.stdout.trim().split(/\r?\n/).filter(Boolean);
    audits.push({
      label: `${fn} only in runner/persistence`,
      ok: result.status === 0 && lines.length > 0 && lines.every((line) =>
        allowedPersistenceFiles.some((prefix) => line.startsWith(prefix))
      ),
      detail: lines.length ? lines.join(" | ") : (result.stderr || "no matches").trim()
    });
  }
  return audits;
}

function addVerificationAssertions(lines, scenarioObjects, googleCreds) {
  const byLabel = new Map(scenarioObjects.map((item) => [item.label, item]));
  let failed = false;
  const requiredGoogleLabels = [
    "arrival happy path",
    "records transfer direct",
    "pricing sample",
    "daily ops",
    "internal lab-result safe update"
  ];

  if (googleCreds) {
    for (const label of requiredGoogleLabels) {
      const item = byLabel.get(label);
      const events = item?.runDetail?.workflowEventTypes ?? [];
      const adkAttempted = item?.runDetail?.runMode === "google-adk" &&
        Boolean(item?.runDetail?.model) &&
        events.includes("adk_start") &&
        (item?.runDetail?.toolCallCount ?? 0) > 0;
      const completed = adkAttempted && item?.mode === "google-adk" && events.includes("adk_final_response");
      const fellBack = adkAttempted && allowFallback && events.includes("runtime_fallback");
      const ok = completed || fellBack;
      const proofKind = fellBack && !completed ? "Google ADK fallback proof" : "Google ADK proof";
      lines.push(`${ok ? "PASS" : "FAIL"} ${proofKind} ${label}: mode=${item?.mode || "none"} runMode=${item?.runDetail?.runMode || "none"} model=${item?.runDetail?.model || "none"} events=${events.join(",") || "none"} tools=${item?.runDetail?.toolCallCount ?? 0}`);
      if (!ok) failed = true;
    }
  } else {
    const fallbackCount = scenarioObjects.filter((item) => (item.runDetail?.workflowEventTypes ?? []).includes("runtime_fallback")).length;
    const ok = fallbackCount > 0;
    lines.push(`${ok ? "PASS" : "FAIL"} Google ADK fallback observable: runtime_fallback events=${fallbackCount}`);
    if (!ok) failed = true;
  }

  const pricingLive = byLabel.get("pricing live fallback");
  const pricingEvents = pricingLive?.runDetail?.workflowEventTypes ?? [];
  const pricingOk = pricingEvents.includes("apify_fallback") || pricingEvents.includes("apify_scan");
  lines.push(`${pricingOk ? "PASS" : "FAIL"} Apify pricing observable: events=${pricingEvents.join(",") || "none"}`);
  if (!pricingOk) failed = true;

  const records = byLabel.get("records transfer direct");
  const recordsOk = records?.proof?.recordsAuditSource === "local_records_policy" &&
    records?.proof?.recordsSentAutomatically === true &&
    !records?.approvalId;
  lines.push(`${recordsOk ? "PASS" : "FAIL"} records direct audited transfer: source=${records?.proof?.recordsAuditSource || "none"} sent=${String(records?.proof?.recordsSentAutomatically)} approval=${records?.approvalId || "none"}`);
  if (!recordsOk) failed = true;

  const publicRun = byLabel.get("arrival happy path");
  const internalRun = byLabel.get("daily ops") ?? byLabel.get("internal lab-result safe update");
  for (const [kind, item] of [["public", publicRun], ["internal", internalRun]]) {
    const detail = item?.runDetail;
    const ok = Boolean(detail?.ok) &&
      (detail?.workflowEventCount ?? 0) > 0 &&
      (detail?.toolCallCount ?? 0) > 0 &&
      (detail?.linkedDecisionIds?.length ?? 0) > 0;
    lines.push(`${ok ? "PASS" : "FAIL"} ${kind} run detail: label=${item?.label || "none"} status=${detail?.runStatus || "none"} events=${detail?.workflowEventCount ?? 0} tools=${detail?.toolCallCount ?? 0} tasks=${detail?.linkedTaskIds?.length ?? 0} approvals=${detail?.linkedApprovalIds?.length ?? 0} reports=${detail?.linkedReportIds?.length ?? 0} decisions=${detail?.linkedDecisionIds?.length ?? 0}`);
    if (!ok) failed = true;
  }

  return failed;
}

async function appendProof(lines, jsonlOutput, migrations) {
  await mkdir(dirname(proofPath), { recursive: true });
  const branch = await gitValue(["branch", "--show-current"]);
  const sha = await gitValue(["rev-parse", "HEAD"]);
  const block = [
    "",
    `## Verify Agents ${new Date().toISOString()}`,
    "",
    `branch: ${branch || "unknown"}`,
    `commit: ${sha}`,
    `baseUrl: ${baseUrl}`,
    `AGENT_RUNTIME: google-adk`,
    `GEMINI_API_KEY: ${envState("GEMINI_API_KEY")}`,
    `GOOGLE_API_KEY: ${envState("GOOGLE_API_KEY")}`,
    `GOOGLE_GENAI_USE_VERTEXAI: ${envState("GOOGLE_GENAI_USE_VERTEXAI")}`,
    `APIFY_API_TOKEN: ${envState("APIFY_API_TOKEN")}`,
    `E2B_API_KEY: ${envState("E2B_API_KEY")}`,
    "",
    "migration_files:",
    ...migrations.map((file) => `- ${file}`),
    "",
    "commands:",
    `- ${actualCommand()}`,
    "",
    "results:",
    ...lines.map((line) => `- ${line}`),
    "",
    "jsonl:",
    "```jsonl",
    jsonlOutput.trim(),
    "```",
    ""
  ].join("\n");
  await appendFile(proofPath, block);
}

const lines = [];
const googleCreds = hasGoogleCreds();
const migrations = await migrationList();
lines.push(`env Google credentials: ${googleCreds ? "present" : "missing"}`);
lines.push(`env APIFY_API_TOKEN: ${envState("APIFY_API_TOKEN")}`);
lines.push(`env E2B_API_KEY: ${envState("E2B_API_KEY")}`);

if (!await reachable()) {
  console.error(`FAIL app not reachable at ${baseUrl}`);
  process.exit(1);
}
console.log(`PASS app reachable at ${baseUrl}`);

if (!googleCreds && !allowFallback) {
  console.error("FAIL Google credentials missing. Set GEMINI_API_KEY or GOOGLE_API_KEY, or run verify:agents with fallback.");
  await appendProof([...lines, "blocked_by: Google credentials missing"], "", migrations);
  process.exit(1);
}

if (!googleCreds) {
  console.log("PASS Google credentials missing; fallback proof allowed.");
  lines.push("blocked_by: Google credentials missing; fallback behavior expected");
}

const run = await runJsonlScenarios();
if (run.stderr.trim()) console.error(run.stderr.trim());
const objects = parseJsonl(run.stdout);
const scenarioObjects = objects.filter((item) => item.type !== "summary");
const summary = objects.find((item) => item.type === "summary");
let failed = run.code !== 0 || !summary?.ok;
for (const item of scenarioObjects) {
  const errors = item.errors?.length ? ` ${item.errors.join("; ")}` : "";
  const state = item.ok ? "PASS" : "FAIL";
  if (!item.ok) failed = true;
  const line = `${state} ${item.label}: status=${item.status} runId=${item.runId || "none"} traceId=${item.traceId || "none"} mode=${item.mode || "none"} tools=${item.toolCallCount ?? 0}${errors}`;
  lines.push(line);
  if (!jsonl) console.log(line);
}
const assertionStart = lines.length;
if (addVerificationAssertions(lines, scenarioObjects, googleCreds)) failed = true;
if (!jsonl) {
  for (const line of lines.slice(assertionStart)) console.log(line);
}
const audits = await duplicateAudits();
for (const audit of audits) {
  const line = `${audit.ok ? "PASS" : "FAIL"} duplicate audit ${audit.label}: ${audit.detail}`;
  lines.push(line);
  if (!jsonl) console.log(line);
  if (!audit.ok) failed = true;
}
if (jsonl) process.stdout.write(run.stdout);

const finalLine = failed ? "FAIL agent checks failed" : "PASS all agent checks";
lines.push(finalLine);
await appendProof(lines, run.stdout, migrations);
console.log(`${finalLine}; proof appended to ${proofPath}`);
if (failed) process.exit(1);
