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

type TriageResult = {
  triage: {
    intent: string;
    urgent: boolean;
  };
};

export async function runCallAgent(input: AgentInput | unknown, options: RunAgentOptions = {}): Promise<AgentWorkflowResult> {
  const normalized = normalizeAgentInput(input);
  const intent = "call";
  const mode = resolveMode(options);
  const runtime = createRuntime(normalized, intent, options);
  const transcript = normalized.transcript ?? getInputText(normalized);
  const triage = await executeTool("triage_call", { transcript }, runtime) as TriageResult;
  if (triage.triage.intent === "checkin") {
    const arrival = await executeTool("start_arrival", {
      clientName: normalized.callerName ?? normalized.clientName,
      clientPhone: normalized.callerPhone ?? normalized.clientPhone,
      petName: normalized.petName
    }, runtime) as {
      client: unknown;
      pet: { name?: string } | null;
      appointment: { id: string; waitMinutes?: number } | null;
    };
    if (arrival.appointment) {
      const waitComplaint = /wait|waiting|been here|long time|so long/i.test(transcript);
      const arrived = await executeTool("mark_arrived", { appointmentId: arrival.appointment.id, waitComplaint }, runtime) as {
        alreadyArrived?: boolean;
      };
      const wait = await executeTool("get_wait_status", { appointmentId: arrival.appointment.id }, runtime);
      return buildResult({
        intent: "checkin",
        mode,
        message: arrived.alreadyArrived
          ? `${arrival.pet?.name ?? "Your pet"} is already checked in. Your arrival is on the clinic board.`
          : `You are checked in for ${arrival.pet?.name ?? "your pet"}. Your arrival is on the clinic board.`,
        result: {
          classifiedIntent: "checkin",
          matched: true,
          action: "checked_in",
          alreadyArrived: Boolean(arrived.alreadyArrived),
          waitStatus: wait
        },
        runtime,
        options
      });
    }
  }
  const action = triage.triage.urgent || triage.triage.intent === "sick_pet"
    ? await executeTool("dispatch_clinical_triage", {
        priority: triage.triage.urgent ? "high" : "medium",
        clientName: normalized.callerName ?? normalized.clientName ?? null,
        clientPhone: normalized.callerPhone ?? normalized.clientPhone ?? null,
        petName: normalized.petName ?? null,
        message: transcript || "No transcript provided.",
        reasons: [triage.triage.intent]
      }, runtime)
    : triage.triage.intent === "booking"
      ? await executeTool("capture_booking_request", {
          clientName: normalized.callerName ?? normalized.clientName ?? null,
          clientPhone: normalized.callerPhone ?? normalized.clientPhone ?? null,
          petName: normalized.petName ?? null,
          request: transcript || "No transcript provided."
        }, runtime)
      : await executeTool("send_clinic_inbox_message", {
          subject: "Client call captured",
          priority: "medium",
          clientName: normalized.callerName ?? normalized.clientName ?? null,
          clientPhone: normalized.callerPhone ?? normalized.clientPhone ?? null,
          petName: normalized.petName ?? null,
          message: transcript || "No transcript provided."
        }, runtime);

  return buildResult({
    intent,
    mode,
    message: triage.triage.urgent
      ? "I sent this call to the clinical triage mock integration."
      : "I captured this call through a mock clinic integration.",
    result: {
      classifiedIntent: triage.triage.intent,
      urgent: triage.triage.urgent,
      action
    },
    runtime,
    options
  });
}
