#!/usr/bin/env node

const args = process.argv.slice(2);

function argValue(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

const baseUrl = (argValue("--base-url") || process.env.EXTERNAL_ACTION_BASE_URL || process.env.SCENARIO_BASE_URL || process.env.LOCAL_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const expectedMode = argValue("--expect-mode") || process.env.EXTERNAL_ACTION_EXPECT_MODE || "google-adk";
const demoAdminPasscode = process.env.DEMO_ACCOUNTS === "disabled" ? "" : "246810";
const managerPasscode = process.env.VET_APP_ADMIN_PASSCODE || process.env.VET_ADMIN_PASSCODE || demoAdminPasscode;
const runSalt = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
const userAgent = `vetagent-external-action-smoke/${runSalt}`;
const skipReset = args.includes("--skip-reset") || process.env.EXTERNAL_ACTION_SKIP_RESET === "1";

const flows = [
  {
    label: "booking books appointment",
    path: "/api/agent/booking",
    body: {
      clientName: "Luis Rivera",
      clientPhone: "(415) 555-0199",
      petName: "Luna",
      appointmentType: "Vaccines",
      message: `Book vaccines next week after 3 if anything is open. Smoke ${runSalt}.`
    },
    expect: {
      intent: "booking",
      "result.action": "appointment_booked",
      "result.booked": true,
      present: ["result.confirmationId", "result.appointment.id"]
    }
  },
  {
    label: "pickup sends portal update",
    path: "/api/agent/pickup",
    body: {
      clientName: "Luis Rivera",
      clientPhone: "(415) 555-0199",
      petName: "Luna",
      message: `Is Luna ready for pickup yet? Smoke ${runSalt}.`
    },
    expect: {
      intent: "pickup",
      "result.action": "pickup_ready_confirmed",
      "result.ready": true,
      "result.statusUpdate.sent": true
    }
  },
  {
    label: "records sends secure transfer",
    path: "/api/agent/records",
    body: {
      clientName: "Hannah Kim",
      clientPhone: "(415) 555-0172",
      petName: "Maple",
      destination: "Bayview Animal Clinic",
      message: `Please send Maple's vaccine records to Bayview Animal Clinic. Smoke ${runSalt}.`
    },
    expect: {
      intent: "records",
      "result.action": "records_transfer_sent",
      "result.requiresApproval": false,
      "result.recordsSentAutomatically": true,
      "result.transfer.transfer.status": "sent"
    }
  },
  {
    label: "follow-up sends outreach",
    path: "/api/agent/followup",
    body: {
      clientName: "Maya Parker",
      clientPhone: "(415) 555-0134",
      petName: "Biscuit",
      message: `I got a vaccine reminder and want to know what is due. Smoke ${runSalt}.`
    },
    expect: {
      intent: "followup",
      "result.action": "followup_outreach_sent",
      "result.pet.name": "Biscuit",
      "result.outreach.status": "sent"
    }
  }
];

function getPath(value, path) {
  return path.split(".").reduce((item, key) => item?.[key], value);
}

function assertFlow(flow, data) {
  const errors = [];
  if (data.ok !== true) errors.push("ok not true");
  if (expectedMode !== "any" && data.mode !== expectedMode) errors.push(`mode ${data.mode || "missing"} expected ${expectedMode}`);
  if (data.task?.id) errors.push(`unexpected task ${data.task.id}`);
  if (data.approval?.id) errors.push(`unexpected approval ${data.approval.id}`);
  for (const [path, expected] of Object.entries(flow.expect)) {
    if (path === "present") continue;
    const actual = getPath(data, path);
    if (actual !== expected) errors.push(`${path}=${String(actual)} expected ${String(expected)}`);
  }
  for (const path of flow.expect.present ?? []) {
    const actual = getPath(data, path);
    if (actual === undefined || actual === null || actual === "") errors.push(`${path} missing`);
  }
  return errors;
}

async function resetFixtures() {
  if (skipReset) return { skipped: true };
  if (!managerPasscode) {
    throw new Error("manager passcode is required for deterministic fixture reset when demo passcodes are disabled.");
  }
  const url = `${baseUrl}/api/mock/clinic?role=admin&name=External%20Smoke`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "user-agent": userAgent,
      "x-central-vet-passcode": managerPasscode
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`fixture reset failed: ${response.status} ${data.error ?? ""}`);
  return data.reset ?? data;
}

async function runFlow(flow) {
  const started = performance.now();
  const response = await fetch(`${baseUrl}${flow.path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": userAgent
    },
    body: JSON.stringify(flow.body),
    signal: AbortSignal.timeout(45_000)
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  const ms = Math.round(performance.now() - started);
  const errors = response.ok ? assertFlow(flow, data) : [data.error || text.slice(0, 180) || `HTTP ${response.status}`];
  return {
    label: flow.label,
    ok: response.ok && errors.length === 0,
    status: response.status,
    ms,
    mode: data.mode ?? null,
    action: data.result?.action ?? null,
    taskId: data.task?.id ?? null,
    approvalId: data.approval?.id ?? null,
    runId: data.runId ?? null,
    errors
  };
}

let reset;
try {
  reset = await resetFixtures();
} catch (error) {
  console.error(`FAIL reset: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exit(1);
}

console.log(`RESET external smoke fixtures: ${JSON.stringify(reset)}`);

let failed = false;
for (const flow of flows) {
  const result = await runFlow(flow);
  if (!result.ok) failed = true;
  const state = result.ok ? "PASS" : "FAIL";
  const detail = result.errors.length ? ` ${result.errors.join("; ")}` : "";
  console.log(`${state} ${result.label}: ${result.status} ${result.ms}ms mode=${result.mode || "none"} action=${result.action || "none"} task=${result.taskId || "none"} approval=${result.approvalId || "none"} runId=${result.runId || "none"}${detail}`);
}

if (failed) {
  console.error(`External action smoke failed for ${baseUrl}`);
  process.exit(1);
}

console.log(`External action smoke passed for ${baseUrl}`);
