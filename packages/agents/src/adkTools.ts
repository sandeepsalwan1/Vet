import { FunctionTool } from "@google/adk";
import { z } from "zod";
import { executeTool, tools, type ToolName, type ToolRuntime } from "./tools";

function defineToolNames<const TNames extends readonly ToolName[]>(names: TNames) {
  return names;
}

export const sharedSafeToolNames = defineToolNames([
  "lookup_client",
  "lookup_pet",
  "lookup_appointment",
  "list_slots",
  "start_arrival",
  "get_wait_status",
  "dispatch_clinical_triage",
  "prepare_records_packet",
  "audit_records_transfer",
  "complete_records_transfer",
  "find_followup_candidates",
  "send_followup_outreach"
] as const);

export const externalToolNames = defineToolNames([
  ...sharedSafeToolNames,
  "book_appointment",
  "capture_booking_request",
  "mark_arrived",
  "send_status_update",
  "capture_arrival_exception",
  "send_clinic_inbox_message"
] as const);

export const internalToolNames = defineToolNames([
  ...sharedSafeToolNames,
  "capture_booking_request",
  "book_appointment",
  "mark_arrived",
  "send_status_update",
  "capture_arrival_exception",
  "send_clinic_inbox_message",
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
] as const);

export function createAdkFunctionTools(runtime: ToolRuntime, allowlist: readonly ToolName[] = externalToolNames) {
  const allowed = new Set<ToolName>(allowlist);
  return Object.entries(tools)
    .filter(([name]) => allowed.has(name as ToolName))
    .map(([name, definition]) => {
      const tool = definition as {
        description: string;
        parameters: z.ZodObject<z.ZodRawShape>;
      };
      return new FunctionTool({
        name,
        description: tool.description,
        parameters: tool.parameters,
        execute: async (args) => executeTool(name as ToolName, args, runtime)
      });
    });
}
