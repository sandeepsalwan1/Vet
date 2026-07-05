import type {
  AgentInput,
  AgentReportDraft,
  AgentWorkflowResult,
  MockApproval,
  MockFollowup,
  MockInvoice,
  MockReport,
  MockTask,
  RunAgentOptions
} from "./contracts";
import { mockLabDataSource, mockLabVendor } from "./agentVocabulary";
import { decideCapabilityRoute, withCapabilityDecision } from "./capabilityRouting";
import { checkBillingGuardrail, checkMedicalGuardrail } from "./guardrails";
import {
  buildResult,
  classifyIntent,
  createRuntime,
  normalizeAgentInput,
  resolveMode
} from "./mockProvider";
import { runFollowupAgent } from "./followupAgent";
import { runPricingAgent } from "./pricingAgent";
import { runRecordsAgent } from "./recordsAgent";
import { executeTool, getInputText, summarizeInvoice } from "./tools";

export async function runInternalAgent(input: AgentInput | unknown, options: RunAgentOptions = {}): Promise<AgentWorkflowResult> {
  const normalized = normalizeAgentInput(input);
  const intent = classifyIntent(normalized, "daily_ops");
  const routeIntent = intent === "unknown" ? "daily_ops" : intent;
  const capabilityDecision = decideCapabilityRoute("internal", normalized, routeIntent);
  const complete = (result: AgentWorkflowResult) => withCapabilityDecision(result, capabilityDecision);
  if (intent === "pricing") return complete(await runPricingAgent(normalized, options));
  if (intent === "records") return complete(await runRecordsAgent(normalized, { ...options, audience: "internal" }));
  if (intent === "followup") return complete(await runFollowupAgent(normalized, options));

  const mode = resolveMode(options);
  const runtime = createRuntime(normalized, intent === "unknown" ? "daily_ops" : intent, options);

  if (intent === "sick_pet") {
    const guardrail = checkMedicalGuardrail(normalized);
    const triage = await executeTool("dispatch_clinical_triage", {
      priority: guardrail.priority,
      clientName: normalized.clientName ?? null,
      clientPhone: normalized.clientPhone ?? null,
      petName: normalized.petName ?? null,
      message: getInputText(normalized),
      reasons: guardrail.reasons
    }, runtime);
    return complete(buildResult({
      intent,
      mode,
      message: guardrail.message ?? "Sick-pet message sent to the clinical triage mock integration.",
      result: { escalated: true, medicalAdviceGiven: false, reasons: guardrail.reasons, triage },
      runtime,
      options
    }));
  }

  if (intent === "invoice") {
    const guardrail = checkBillingGuardrail(getInputText(normalized));
    const invoice = runtime.data.invoices.find((candidate) => candidate.flags.length > 0) ?? runtime.data.invoices[0] ?? null;
    const reportResult = invoice
      ? await executeTool("review_invoice_flags", {
          invoiceId: invoice.id,
          issueDetails: invoice.flags[0]?.reason ?? "Invoice needs staff review."
        }, runtime) as { report: AgentReportDraft; invoice: MockInvoice | null; changedInvoices: false }
      : null;
    return complete(buildResult({
      intent,
      mode,
      message: guardrail.allowed
        ? invoice
          ? `Invoice audit report created for ${summarizeInvoice(invoice)}.`
          : "No mock invoice issues found."
        : guardrail.message ?? "Billing mutation blocked; invoice audit report created.",
      result: {
        changedInvoices: false,
        invoice: reportResult?.invoice ?? null
      },
      runtime,
      options,
      report: reportResult?.report
    }));
  }

  if (intent === "labs") {
    await executeTool("list_lab_catalog", { active: true }, runtime);
    const clientPet = runtime.data.pets.find((pet) =>
      normalized.petName ? pet.name.toLowerCase().includes(normalized.petName.toLowerCase()) : false
    );
    const ordersResult = await executeTool("lookup_lab_orders", {
      petId: clientPet?.id,
      patientName: normalized.petName,
      status: "final"
    }, runtime) as { orders: Array<{ id: string; externalOrderId: string; labVendor: string; patientName: string }> };
    const order = ordersResult.orders[0] ?? runtime.data.labOrders?.find((item) => item.status === "final") ?? null;
    const result = order
      ? await executeTool("get_lab_result", { labOrderId: order.id }, runtime) as { result: { abnormalFlags?: unknown[] } | null }
      : { result: null };
    const summary = order
      ? await executeTool("summarize_lab_result", { labOrderId: order.id }, runtime) as { summary: Record<string, unknown> }
      : { summary: { labVendor: mockLabVendor, source: mockLabDataSource, status: "not_found", medicalAdviceGiven: false } };
    const clientUpdate = order
      ? await executeTool("prepare_lab_client_update", {
          labOrderId: order.id,
          reason: result.result?.abnormalFlags?.length
            ? "Final mock lab result has abnormal flags; veterinarian review required."
            : "Final mock lab result requires staff review before client disclosure."
        }, runtime) as { update: Record<string, unknown> }
      : null;
    return complete(buildResult({
      intent,
      mode,
      message: "Mock lab data checked. I prepared the safe client-update state without giving medical advice.",
      result: {
        labVendor: mockLabVendor,
        source: mockLabDataSource,
        order,
        summary: summary.summary,
        clientUpdate: clientUpdate?.update ?? null,
        medicalAdviceGiven: false
      },
      runtime,
      options
    }));
  }

  const tasksResult = await executeTool("list_tasks", {}, runtime) as { tasks: MockTask[] };
  const approvalsResult = await executeTool("list_approvals", { status: "pending" }, runtime) as { approvals: MockApproval[] };
  const followupsResult = await executeTool("find_followup_candidates", { status: "open" }, runtime) as { candidates: MockFollowup[] };
  const reportsResult = await executeTool("list_reports", {}, runtime) as { reports: MockReport[] };
  const invoiceReviews = runtime.data.invoices.filter((invoice) => invoice.flags.length > 0).length;
  const openTasks = tasksResult.tasks.filter((task) => task.status !== "completed" && task.status !== "archived").length || runtime.data.messages.length;
  const highPriority = tasksResult.tasks.filter((task) => task.priority === "high").length ||
    runtime.data.messages.filter((message) => message.urgency === "high").length;
  const pendingFollowups = followupsResult.candidates.length;
  const summary = {
    openTasks,
    highPriority,
    pendingApprovals: approvalsResult.approvals.length,
    openFollowups: pendingFollowups,
    invoiceReviews,
    pricingItems: runtime.data.pricingObservations.length,
    recentReports: reportsResult.reports.length
  };
  const rankedWork = [
    highPriority ? "Review high-priority sick-pet or wait complaints first." : "No high-priority task spike in current context.",
    approvalsResult.approvals.length ? "Review pending approvals before sending records." : "No pending approval backlog found.",
    invoiceReviews ? "Review flagged invoices before client billing replies." : "No flagged invoice review backlog found.",
    pendingFollowups ? "Schedule open follow-up candidates." : "No open follow-up candidates found."
  ];
  const reportResult = await executeTool("create_daily_ops_report", { summary, rankedWork }, runtime) as { report: AgentReportDraft };

  return complete(buildResult({
    intent: "daily_ops",
    mode,
    message: reportResult.report.summary,
    result: reportResult.report.data,
    runtime,
    options,
    report: reportResult.report
  }));
}
