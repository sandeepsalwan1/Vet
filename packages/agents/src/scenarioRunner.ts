import { runInSandbox } from "./e2bRunner";
import { externalToolNames, internalToolNames, sharedSafeToolNames } from "./adkTools";
import { runExternalAgent } from "./externalAgent";
import { runInternalAgent } from "./internalAgent";
import type { AgentWorkflowResult } from "./contracts";
import type { ToolName } from "./tools";

type Scenario = {
  name: string;
  run: () => Promise<AgentWorkflowResult>;
  expect: (result: AgentWorkflowResult) => string | null;
};

function expectIntent(intent: AgentWorkflowResult["intent"]) {
  return (result: AgentWorkflowResult) =>
    result.intent === intent ? null : `Expected intent ${intent}, got ${result.intent}`;
}

function expectNoTask(result: AgentWorkflowResult) {
  return result.task ? `Expected no staff task draft, got ${result.task.id}` : null;
}

function expectNoApproval(result: AgentWorkflowResult) {
  return result.approval ? `Expected no approval draft, got ${result.approval.id}` : null;
}

function expectResult(path: string, expected: unknown) {
  return (result: AgentWorkflowResult) => {
    const actual = path.split(".").reduce<unknown>((item, key) => {
      if (!item || typeof item !== "object") return undefined;
      return (item as Record<string, unknown>)[key];
    }, result.result);
    return actual === expected ? null : `Expected result.${path}=${String(expected)}, got ${String(actual)}`;
  };
}

function all(...checks: Array<(result: AgentWorkflowResult) => string | null>) {
  return (result: AgentWorkflowResult) => {
    for (const check of checks) {
      const message = check(result);
      if (message) return message;
    }
    return null;
  };
}

const externalDeniedToolNames = [
  "triage_message",
  "triage_call",
  "list_tasks",
  "list_approvals",
  "list_reports",
  "create_task",
  "create_daily_ops_report",
  "update_task",
  "get_invoice_summary",
  "review_invoice_flags",
  "list_service_catalog",
  "run_competitor_scan",
  "compare_service_prices",
  "create_price_review_report",
  "list_lab_catalog",
  "lookup_lab_orders",
  "get_lab_result",
  "summarize_lab_result",
  "prepare_lab_client_update"
] as const satisfies readonly ToolName[];

const externalRequiredToolNames = [
  "lookup_client",
  "lookup_pet",
  "lookup_appointment",
  "list_slots",
  "book_appointment",
  "start_arrival",
  "get_wait_status",
  "mark_arrived",
  "send_status_update",
  "dispatch_clinical_triage",
  "capture_arrival_exception",
  "capture_booking_request",
  "send_clinic_inbox_message",
  "prepare_records_packet",
  "audit_records_transfer",
  "complete_records_transfer",
  "find_followup_candidates",
  "send_followup_outreach"
] as const satisfies readonly ToolName[];

const internalRequiredToolNames = [
  "list_tasks",
  "list_approvals",
  "list_reports",
  "create_daily_ops_report",
  "review_invoice_flags",
  "list_service_catalog",
  "run_competitor_scan",
  "compare_service_prices",
  "create_price_review_report",
  "dispatch_clinical_triage",
  "list_lab_catalog",
  "lookup_lab_orders",
  "get_lab_result",
  "summarize_lab_result",
  "prepare_lab_client_update"
] as const satisfies readonly ToolName[];

function expectAdkToolBoundaries() {
  const failures: string[] = [];
  const external = new Set<string>(externalToolNames);
  const internal = new Set<string>(internalToolNames);
  const shared = new Set<string>(sharedSafeToolNames);
  const leaks = externalDeniedToolNames.filter((name) => external.has(name));
  const missingExternal = externalRequiredToolNames.filter((name) => !external.has(name));
  const missingInternal = internalRequiredToolNames.filter((name) => !internal.has(name));
  const sharedMissing = [...shared].filter((name) => !external.has(name) || !internal.has(name));
  if (leaks.length) failures.push(`External ADK allowlist leaked internal tools: ${leaks.join(", ")}`);
  if (missingExternal.length) failures.push(`External ADK allowlist missing tools: ${missingExternal.join(", ")}`);
  if (missingInternal.length) failures.push(`Internal ADK allowlist missing tools: ${missingInternal.join(", ")}`);
  if (sharedMissing.length) failures.push(`Shared safe tools absent from one allowlist: ${sharedMissing.join(", ")}`);
  return failures;
}

const scenarios: Scenario[] = [
  {
    name: "arrival happy path",
    run: () => runExternalAgent({
      clientName: "Maya Parker",
      clientPhone: "(415) 555-0134",
      petName: "Biscuit",
      message: "I'm outside for my appointment. Can you check me in?"
    }),
    expect: all(expectIntent("checkin"), expectNoTask, expectResult("matched", true))
  },
  {
    name: "arrival no appointment",
    run: () => runExternalAgent({
      clientName: "Unknown Client",
      petName: "Ghost",
      message: "I'm here for my appointment."
    }),
    expect: all(expectIntent("checkin"), expectNoTask, expectResult("action", "arrival_exception_captured"))
  },
  {
    name: "booking happy path",
    run: () => runExternalAgent({
      clientName: "Alice Johnson",
      petName: "Bella",
      appointmentType: "Vaccines",
      message: "Can I book Bella for vaccines next Tuesday?"
    }),
    expect: all(expectIntent("booking"), expectNoTask, expectResult("booked", true))
  },
  {
    name: "booking ambiguous",
    run: () => runExternalAgent({
      message: "Can I get the first appointment after 3?"
    }),
    expect: all(expectIntent("booking"), expectNoTask, expectResult("booked", false), expectResult("action", "booking_request_captured"))
  },
  {
    name: "sick-pet emergency",
    run: () => runExternalAgent({
      clientName: "Jane Doe",
      petName: "Buddy",
      message: "Buddy is vomiting blood and very lethargic."
    }),
    expect: all(expectIntent("sick_pet"), expectNoTask, expectResult("medicalAdviceGiven", false))
  },
  {
    name: "records transfer",
    run: () => runExternalAgent({
      clientName: "Alice Johnson",
      petName: "Bella",
      destination: "Eastside Vet Clinic",
      message: "Please transfer Bella's records to Eastside Vet Clinic."
    }),
    expect: all(expectIntent("records"), expectNoTask, expectNoApproval, expectResult("recordsSentAutomatically", true))
  },
  {
    name: "pickup status",
    run: () => runExternalAgent({
      clientName: "Jane Doe",
      petName: "Buddy",
      message: "Is Buddy ready for pickup?"
    }),
    expect: all(expectIntent("pickup"), expectNoTask, expectResult("ready", false))
  },
  {
    name: "follow-up vaccine due",
    run: () => runInternalAgent({
      message: "Scan follow-up vaccine candidates."
    }),
    expect: all(expectIntent("followup"), expectNoTask, expectResult("action", "followup_outreach_sent"))
  },
  {
    name: "invoice issue",
    run: () => runInternalAgent({
      message: "Run invoice audit for unusual charges."
    }),
    expect: all(expectIntent("invoice"), expectNoTask, expectResult("changedInvoices", false))
  },
  {
    name: "pricing review",
    run: () => runInternalAgent({
      message: "Check competitor prices and flag differences."
    }),
    expect: all(expectIntent("pricing"), expectNoTask, expectResult("changedPrices", false))
  },
  {
    name: "call transcript to check-in",
    run: () => runExternalAgent({
      callerName: "Maya Parker",
      callerPhone: "(415) 555-0134",
      transcript: "Hi, I parked outside with Biscuit. Can you check us in?"
    }),
    expect: all(expectIntent("checkin"), expectNoTask)
  }
];

async function main() {
  const sandbox = await runInSandbox("VetAgent scenarios", async () => {
    const failures: string[] = expectAdkToolBoundaries();
    console.log(`${failures.length ? "FAIL" : "PASS"} ADK tool boundary allowlists`);
    for (const scenario of scenarios) {
      const result = await scenario.run();
      const failure = scenario.expect(result);
      const tools = result.toolCalls.map((tool) => tool.toolName).join(", ") || "none";
      console.log(`${failure ? "FAIL" : "PASS"} ${scenario.name}: ${result.message}`);
      console.log(`  intent: ${result.intent}; tools: ${tools}`);
      if (failure) failures.push(`${scenario.name}: ${failure}`);
    }
    return { failures };
  });

  if (sandbox.stdout) console.log(sandbox.stdout);
  if (sandbox.stderr) console.error(sandbox.stderr);
  const failures = sandbox.result?.failures ?? ["scenario runner failed"];
  if (failures.length > 0) {
    for (const failure of failures) console.error(failure);
    process.exit(1);
  }
  process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
