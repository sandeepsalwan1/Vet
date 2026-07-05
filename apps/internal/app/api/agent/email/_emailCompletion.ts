import type { AgentDecisionStatus } from "@central-vet/db";
import type { emailConfirmation, resultStats } from "./_emailCampaign";

export type EmailCompletionPayload = {
  audience: string;
  cadence: string;
  capabilityDecision: Record<string, unknown>;
  confirmation: ReturnType<typeof emailConfirmation>;
  decisionIds: string[];
  decisionStatus: AgentDecisionStatus;
  message: string;
  mode: string;
  period: string | null;
  result: unknown;
  stats?: ReturnType<typeof resultStats>;
};

export const emailCapability = "internal_email";
export const emailDecisionKind = "email_campaign";
export const emailDecisionTtl = "long";

function emailDecision(status: AgentDecisionStatus) {
  return {
    kind: emailDecisionKind,
    status,
    ttl: emailDecisionTtl
  };
}

export function emailCompletionPayload(input: EmailCompletionPayload) {
  const payload = {
    ok: true,
    mode: input.mode,
    intent: "email",
    capability: emailCapability,
    capabilityDecision: input.capabilityDecision,
    message: input.message,
    cadence: input.cadence,
    audience: input.audience,
    period: input.period,
    confirmation: input.confirmation,
    decision: emailDecision(input.decisionStatus),
    decisionIds: input.decisionIds,
    result: input.result
  };
  return input.stats ? { ...payload, stats: input.stats } : payload;
}

export function emailCompletionResponse(input: EmailCompletionPayload & {
  durationMs: number;
  runId: string;
  toolCalls: unknown[];
  traceId: string;
  workflowEvents: unknown[];
}) {
  return {
    ...emailCompletionPayload(input),
    runId: input.runId,
    traceId: input.traceId,
    durationMs: input.durationMs,
    status: "completed",
    workflowEvents: input.workflowEvents,
    toolCalls: input.toolCalls
  };
}
