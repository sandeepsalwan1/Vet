export type AgentDecisionStatus = "proposed" | "confirmed" | "completed" | "blocked" | "skipped" | "failed";
export type AgentDecisionTtl = "short" | "long" | "permanent";

export type AgentDecision = {
  id: string;
  clinicId: string;
  runId: string | null;
  traceId: string | null;
  agent: string;
  capability: string;
  decisionKind: string;
  status: AgentDecisionStatus;
  ttl: AgentDecisionTtl;
  actorName: string | null;
  actorRole: string | null;
  actorProfileId: string | null;
  action: string;
  inputSummary: string | null;
  resultSummary: string | null;
  metadata: Record<string, unknown>;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AgentDecisionRow = {
  id: string;
  clinic_id: string;
  run_id: string | null;
  trace_id: string | null;
  agent: string;
  capability: string;
  decision_kind: string;
  status: AgentDecisionStatus;
  ttl: AgentDecisionTtl;
  actor_name: string | null;
  actor_role: string | null;
  actor_profile_id: string | null;
  action: string;
  input_summary: string | null;
  result_summary: string | null;
  metadata: Record<string, unknown>;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
};

export const decisionColumns = `
  id,
  clinic_id,
  run_id,
  trace_id,
  agent,
  capability,
  decision_kind,
  status,
  ttl,
  actor_name,
  actor_role,
  actor_profile_id,
  action,
  input_summary,
  result_summary,
  metadata,
  expires_at,
  created_at,
  updated_at
`;

export function normalizeDecision(row: AgentDecisionRow): AgentDecision {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    runId: row.run_id,
    traceId: row.trace_id,
    agent: row.agent,
    capability: row.capability,
    decisionKind: row.decision_kind,
    status: row.status,
    ttl: row.ttl,
    actorName: row.actor_name,
    actorRole: row.actor_role,
    actorProfileId: row.actor_profile_id,
    action: row.action,
    inputSummary: row.input_summary,
    resultSummary: row.result_summary,
    metadata: row.metadata ?? {},
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
