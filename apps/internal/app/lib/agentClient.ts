// Browser adapter for the agent routes.
// Customer/staff chat and console actions for POST /api/agent/* routes.

import { readJson } from "./apiClient";
import { browserActorBody, type BrowserActorSession } from "./browserActor";

export type AgentActorSession = BrowserActorSession;

export type WorkflowStatus = "running" | "needs_approval" | "completed" | "failed";

type WorkflowEventDTO = {
  id: string;
  eventType: string;
  toolName?: string;
  createdAt: string;
  payload: Record<string, unknown>;
};

export type ReportSummary = {
  id: string;
  reportType: string;
  title: string;
  summary: string;
  data: Record<string, unknown>;
  createdAt: string;
};

type AgentRunResponse = {
  runId: string;
  status: WorkflowStatus;
  message: string;
  taskIds: string[];
  approvalIds: string[];
  events: WorkflowEventDTO[];
  report?: ReportSummary;
};

export type AgentConsoleResult = {
  message?: string;
  mode?: string;
  intent?: string;
  capability?: string;
  runId?: string;
  decisionIds?: string[];
  task?: { id: string };
  approval?: { id: string };
  report?: { id: string; title?: string; summary?: string };
  decision?: { kind?: string; status?: string; ttl?: string };
  confirmation?: {
    cadence?: string;
    audience?: string;
    recipientCount?: number;
    templateReviewed?: boolean;
    postAppointmentDelayDays?: number | null;
  };
  result?: {
    blocked?: boolean;
    blockers?: string[];
    from?: string;
    subject?: string;
    results?: Array<{
      recipient: string;
      status: string;
      channel: string;
      resendId?: string | null;
      error?: string;
    }>;
  };
};

export type PublicAgentResponse = {
  ok?: boolean;
  intent?: string;
  mode?: string;
  message?: string;
  runId?: string;
  task?: { id: string; request?: string; priority?: string };
  approval?: { id: string; title?: string };
  result?: Record<string, unknown>;
};

export type PublicAgentWorkflow = "booking" | "call" | "followup" | "pickup" | "records";

const publicAgentWorkflowEndpoints: Record<PublicAgentWorkflow, string> = {
  booking: "/api/agent/booking",
  call: "/api/agent/call",
  followup: "/api/agent/followup",
  pickup: "/api/agent/pickup",
  records: "/api/agent/records"
};

type WorkflowResult = {
  ok: true;
  runId: string;
  intent: string;
  mode: string;
  message: string;
  result: Record<string, unknown>;
  task?: { id: string };
  approval?: { id: string };
  report?: {
    id: string;
    reportType: string;
    title: string;
    summary: string;
    data: Record<string, unknown>;
    createdAt: string;
  };
  workflowEvents: Array<{
    id: string;
    eventType: string;
    createdAt: string;
    metadata?: Record<string, unknown>;
  }>;
};

function mapWorkflowResult(r: WorkflowResult): AgentRunResponse {
  return {
    runId: r.runId,
    status: r.approval ? "needs_approval" : "completed",
    message: r.message,
    taskIds: r.task ? [r.task.id] : [],
    approvalIds: r.approval ? [r.approval.id] : [],
    events: r.workflowEvents.map((e) => ({
      id: e.id,
      eventType: e.eventType,
      createdAt: e.createdAt,
      payload: e.metadata ?? {}
    })),
    report: r.report ?? undefined
  };
}

async function postWorkflow(url: string, body: Record<string, unknown>): Promise<AgentRunResponse> {
  const data = await readJson<WorkflowResult>(
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    })
  );
  return mapWorkflowResult(data);
}

async function postRawAgent(url: string, body: Record<string, unknown>): Promise<AgentConsoleResult> {
  return readJson<AgentConsoleResult>(
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }),
    "Agent failed."
  );
}

export type CustomerContext = {
  name: string;
  phone?: string;
  petName?: string;
};

export async function sendCustomerMessage(
  ctx: CustomerContext,
  message: string
): Promise<AgentRunResponse> {
  return postWorkflow("/api/agent/external", {
    clientName: ctx.name,
    clientPhone: ctx.phone,
    petName: ctx.petName,
    message
  });
}

export async function sendVetMessage(
  session: AgentActorSession,
  message: string,
  intent?: string
): Promise<AgentRunResponse> {
  return postWorkflow("/api/agent/internal", {
    actor: browserActorBody(session),
    message,
    ...(intent ? { intent } : {})
  });
}

export async function runAgentConsoleAction(args: {
  endpoint: string;
  session: AgentActorSession;
  message: string;
  intent?: string;
  payload?: Record<string, unknown>;
}): Promise<AgentConsoleResult> {
  return postRawAgent(args.endpoint, {
    actor: browserActorBody(args.session),
    ...(args.intent ? { intent: args.intent } : {}),
    message: args.message,
    ...(args.payload ?? {})
  });
}

export async function runPublicAgentFlow(args: {
  workflow: PublicAgentWorkflow;
  clientName: string;
  clientPhone: string;
  petName: string;
  destination?: string;
  message: string;
  transcript?: boolean;
}) {
  return readJson<PublicAgentResponse>(
    await fetch(publicAgentWorkflowEndpoints[args.workflow], {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        intent: args.workflow,
        clientName: args.clientName,
        clientPhone: args.clientPhone,
        phone: args.clientPhone,
        petName: args.petName,
        destination: args.destination,
        message: args.transcript ? "" : args.message,
        transcript: args.transcript ? args.message : ""
      })
    })
  );
}
