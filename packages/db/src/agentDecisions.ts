import { getSql } from "./connection";
import { resolveClinicId } from "./clinics";
import type { Actor } from "./types";
import { jsonInput, redactedAgentObject } from "./agentJson";
import {
  decisionColumns,
  normalizeDecision,
  type AgentDecisionRow,
  type AgentDecisionStatus,
  type AgentDecisionTtl
} from "./agentDecisionRows";
export type {
  AgentDecision,
  AgentDecisionStatus,
  AgentDecisionTtl
} from "./agentDecisionRows";

function expiresSql(ttl: AgentDecisionTtl) {
  if (ttl === "short") return "now() + interval '3 minutes'";
  if (ttl === "long") return "now() + interval '1 year'";
  return "null";
}

export async function createAgentDecision(input: {
  clinicId?: string | null;
  runId?: string | null;
  traceId?: string | null;
  agent: string;
  capability: string;
  decisionKind: string;
  status: AgentDecisionStatus;
  ttl?: AgentDecisionTtl;
  actor?: Actor | null;
  action: string;
  inputSummary?: string | null;
  resultSummary?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const sql = getSql();
  const clinicId = await resolveClinicId(input.clinicId);
  const ttl = input.ttl ?? "long";
  const rows = await sql<AgentDecisionRow[]>`
    insert into agent_decisions (
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
      expires_at
    )
    values (
      ${clinicId},
      ${input.runId ?? null},
      ${input.traceId ?? null},
      ${input.agent},
      ${input.capability},
      ${input.decisionKind},
      ${input.status},
      ${ttl},
      ${input.actor?.name ?? null},
      ${input.actor?.role ?? null},
      ${input.actor?.profileId ?? null},
      ${input.action},
      ${input.inputSummary ?? null},
      ${input.resultSummary ?? null},
      ${sql.json(jsonInput(redactedAgentObject(input.metadata)))},
      ${sql.unsafe(expiresSql(ttl))}
    )
    returning ${sql.unsafe(decisionColumns)}
  `;
  return normalizeDecision(rows[0]);
}

export async function listAgentDecisions(options: {
  clinicId?: string | null;
  runId?: string | null;
  decisionKind?: string | null;
  status?: AgentDecisionStatus | null;
  limit?: number;
} = {}) {
  const sql = getSql();
  const clinicId = await resolveClinicId(options.clinicId);
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const rows = await sql<AgentDecisionRow[]>`
    select ${sql.unsafe(decisionColumns)}
    from agent_decisions
    where clinic_id = ${clinicId}
      and (${options.runId ?? null}::uuid is null or run_id = ${options.runId ?? null})
      and (${options.decisionKind ?? null}::text is null or decision_kind = ${options.decisionKind ?? null})
      and (${options.status ?? null}::text is null or status = ${options.status ?? null})
    order by created_at desc
    limit ${limit}
  `;
  return rows.map(normalizeDecision);
}
