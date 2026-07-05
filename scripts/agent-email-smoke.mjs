#!/usr/bin/env node

const args = process.argv.slice(2);

function argValue(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

const baseUrl = (argValue("--base-url") || process.env.AGENT_EMAIL_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const passcode = argValue("--passcode") || process.env.VET_APP_ADMIN_PASSCODE || process.env.VET_ADMIN_PASSCODE || "246810";
const period = argValue("--period") || "2099-12";
const recipient = argValue("--recipient") || `agent-monthly-smoke-${Date.now()}@example.com`;

async function postMonthlyEmail() {
  const response = await fetch(`${baseUrl}/api/agent/email`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "vetagent-email-smoke"
    },
    body: JSON.stringify({
      actor: {
        name: "Email Smoke",
        role: "admin",
        passcode
      },
      mode: "disabled",
      cadence: "monthly",
      period,
      to: recipient,
      subject: "VetAgent monthly email smoke",
      message: "Monthly email smoke verification."
    }),
    signal: AbortSignal.timeout(20_000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${data.error || "unknown error"}`);
  }
  return data;
}

function firstResult(data) {
  return data?.result?.results?.[0] ?? null;
}

function assertRun(label, data, expectedStatus) {
  const result = firstResult(data);
  const errors = [];
  if (data.ok !== true) errors.push("ok not true");
  if (!data.runId) errors.push("runId missing");
  if (data.intent !== "email") errors.push(`intent ${data.intent || "missing"}`);
  if (data.cadence !== "monthly") errors.push(`cadence ${data.cadence || "missing"}`);
  if (data.period !== period) errors.push(`period ${data.period || "missing"}`);
  if (data.mode !== "disabled") errors.push(`mode ${data.mode || "missing"}`);
  if (!Array.isArray(data.workflowEvents) || data.workflowEvents.length < 1) errors.push("workflow event missing");
  if (!Array.isArray(data.toolCalls) || data.toolCalls[0]?.toolName !== "send_agent_example_email") errors.push("tool call missing");
  if (!result) errors.push("notification result missing");
  if (result && result.status !== expectedStatus) errors.push(`status ${result.status} expected ${expectedStatus}`);
  if (errors.length) {
    throw new Error(`${label}: ${errors.join("; ")}`);
  }
  console.log(`PASS ${label}: runId=${data.runId} status=${result.status} cadence=${data.cadence} period=${data.period}`);
}

try {
  const first = await postMonthlyEmail();
  assertRun("monthly email first call", first, "skipped");

  const second = await postMonthlyEmail();
  assertRun("monthly email duplicate call", second, "duplicate");

  console.log(`Agent monthly email smoke passed for ${baseUrl}`);
} catch (error) {
  console.error(`FAIL agent monthly email smoke: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exit(1);
}
