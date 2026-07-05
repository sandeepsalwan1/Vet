import type {
  AgentInput,
  AgentWorkflowResult,
  RunAgentOptions
} from "./contracts";
import {
  buildResult,
  createRuntime,
  normalizeAgentInput,
  resolveMode
} from "./mockProvider";
import { executeTool, getInputText } from "./tools";

type RecordsAgentOptions = RunAgentOptions & {
  audience?: "external" | "internal";
};

export async function runRecordsAgent(input: AgentInput | unknown, options: RecordsAgentOptions = {}): Promise<AgentWorkflowResult> {
  const normalized = normalizeAgentInput(input);
  const intent = "records";
  const mode = resolveMode(options);
  const runtime = createRuntime(normalized, intent, options);
  const actionText = getInputText(normalized);
  const audience = options.audience ?? "external";

  const packet = await executeTool("prepare_records_packet", {
    clientName: normalized.clientName ?? normalized.callerName ?? null,
    petName: normalized.petName ?? null,
    destination: normalized.destination ?? null
  }, runtime);
  const audit = await executeTool("audit_records_transfer", {
    clientName: normalized.clientName ?? normalized.callerName ?? null,
    petName: normalized.petName ?? null,
    destination: normalized.destination ?? null
  }, runtime);
  const transfer = await executeTool("complete_records_transfer", {
    clientName: normalized.clientName ?? normalized.callerName ?? null,
    petName: normalized.petName ?? null,
    destination: normalized.destination ?? null,
    request: actionText || "transfer records"
  }, runtime);
  const transferStatus = transfer && typeof transfer === "object" && "transfer" in transfer
    && transfer.transfer && typeof transfer.transfer === "object" && "status" in transfer.transfer
    ? transfer.transfer.status
    : null;

  return buildResult({
    intent,
    mode,
    message: transferStatus === "blocked"
      ? "I prepared the records packet and audit, but need a destination before secure transfer can be submitted."
      : "I prepared the records packet, passed the disclosure audit, and submitted the secure transfer through the mock integration.",
    result: {
      audience,
      action: transferStatus === "blocked" ? "records_transfer_blocked" : "records_transfer_sent",
      requiresApproval: false,
      allowedAutomatically: true,
      recordsSentAutomatically: transferStatus !== "blocked",
      packet,
      audit,
      transfer
    },
    runtime,
    options
  });
}
