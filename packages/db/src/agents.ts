import { getSql } from "./connection";
import { resolveClinicId } from "./clinics";
import type { Actor } from "./types";
import { jsonInput, redactedAgentObject } from "./agentJson";
import {
  agentRunColumns,
  approvalColumns,
  normalizeApproval,
  normalizeReport,
  normalizeRun,
  normalizeToolCall,
  normalizeWorkflowEvent,
  reportColumns,
  toolCallColumns,
  workflowEventColumns,
  type AgentReportRow,
  type AgentRunRow,
  type AgentToolCallRow,
  type ApprovalRow,
  type WorkflowEventRow
} from "./agentRows";
export type {
  AgentReport,
  Approval,
  WorkflowEvent
} from "./agentRows";

export async function createAgentRun(input: {
  clinicId?: string | null;
  agent: string;
  intent: string;
  mode?: string;
  status?: string;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  traceId?: string | null;
  requestId?: string | null;
  model?: string | null;
  inputHash?: string | null;
  inputSummary?: string | null;
}) {
  const sql = getSql();
  const clinicId = await resolveClinicId(input.clinicId);
  const rows = await sql<AgentRunRow[]>`
    insert into agent_runs (
      clinic_id,
      agent,
      intent,
      mode,
      status,
      input,
      output,
      trace_id,
      request_id,
      model,
      input_hash,
      input_summary
    )
    values (
      ${clinicId},
      ${input.agent},
      ${input.intent},
      ${input.mode ?? "mock"},
      ${input.status ?? "completed"},
      ${sql.json(jsonInput(redactedAgentObject(input.input)))},
      ${sql.json(jsonInput(redactedAgentObject(input.output)))},
      ${input.traceId ?? null},
      ${input.requestId ?? null},
      ${input.model ?? null},
      ${input.inputHash ?? null},
      ${input.inputSummary ?? null}
    )
    returning ${sql.unsafe(agentRunColumns)}
  `;
  return normalizeRun(rows[0]);
}

export async function updateAgentRun(
  id: string,
  patch: {
    clinicId?: string | null;
    status?: string;
    output?: Record<string, unknown>;
    error?: string | null;
    traceId?: string | null;
    requestId?: string | null;
    model?: string | null;
    durationMs?: number | null;
    outputSummary?: string | null;
    errorKind?: string | null;
    tokenInput?: number | null;
    tokenOutput?: number | null;
    toolCallCount?: number | null;
  }
) {
  const sql = getSql();
  const clinicId = await resolveClinicId(patch.clinicId);
  const rows = await sql<AgentRunRow[]>`
    update agent_runs
    set
      status = coalesce(${patch.status ?? null}, status),
      output = coalesce(${patch.output ? sql.json(jsonInput(redactedAgentObject(patch.output))) : null}, output),
      error = ${patch.error ?? null},
      trace_id = coalesce(${patch.traceId ?? null}, trace_id),
      request_id = coalesce(${patch.requestId ?? null}, request_id),
      model = coalesce(${patch.model ?? null}, model),
      duration_ms = coalesce(${patch.durationMs ?? null}, duration_ms),
      output_summary = coalesce(${patch.outputSummary ?? null}, output_summary),
      error_kind = coalesce(${patch.errorKind ?? null}, error_kind),
      token_input = coalesce(${patch.tokenInput ?? null}, token_input),
      token_output = coalesce(${patch.tokenOutput ?? null}, token_output),
      tool_call_count = coalesce(${patch.toolCallCount ?? null}, tool_call_count),
      updated_at = now()
    where id = ${id}
      and clinic_id = ${clinicId}
    returning ${sql.unsafe(agentRunColumns)}
  `;
  return rows[0] ? normalizeRun(rows[0]) : null;
}

export async function failAgentRun(
  id: string,
  patch: {
    clinicId?: string | null;
    error: string;
    errorKind?: string | null;
    output?: Record<string, unknown>;
    durationMs?: number | null;
    toolCallCount?: number | null;
  }
) {
  return updateAgentRun(id, {
    clinicId: patch.clinicId,
    status: "failed",
    error: patch.error,
    errorKind: patch.errorKind ?? "agent_error",
    output: patch.output,
    durationMs: patch.durationMs,
    toolCallCount: patch.toolCallCount
  });
}

export async function createAgentToolCall(input: {
  clinicId?: string | null;
  runId?: string | null;
  traceId?: string | null;
  sequence: number;
  toolName: string;
  status: string;
  args?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: string | null;
  durationMs?: number | null;
}) {
  const sql = getSql();
  const clinicId = await resolveClinicId(input.clinicId);
  const rows = await sql<AgentToolCallRow[]>`
    insert into agent_tool_calls (
      clinic_id,
      run_id,
      trace_id,
      sequence,
      tool_name,
      status,
      args,
      result,
      error,
      duration_ms
    )
    values (
      ${clinicId},
      ${input.runId ?? null},
      ${input.traceId ?? null},
      ${input.sequence},
      ${input.toolName},
      ${input.status},
      ${sql.json(jsonInput(redactedAgentObject(input.args)))},
      ${sql.json(jsonInput(redactedAgentObject(input.result)))},
      ${input.error ?? null},
      ${input.durationMs ?? null}
    )
    returning ${sql.unsafe(toolCallColumns)}
  `;
  return normalizeToolCall(rows[0]);
}

export async function createWorkflowEvent(input: {
  clinicId?: string | null;
  runId?: string | null;
  workflowType: string;
  eventType: string;
  title: string;
  detail?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const sql = getSql();
  const clinicId = await resolveClinicId(input.clinicId);
  const rows = await sql<WorkflowEventRow[]>`
    insert into workflow_events (
      clinic_id,
      run_id,
      workflow_type,
      event_type,
      title,
      detail,
      metadata
    )
    values (
      ${clinicId},
      ${input.runId ?? null},
      ${input.workflowType},
      ${input.eventType},
      ${input.title},
      ${input.detail ?? null},
      ${sql.json(jsonInput(input.metadata ?? {}))}
    )
    returning ${sql.unsafe(workflowEventColumns)}
  `;
  return normalizeWorkflowEvent(rows[0]);
}

export async function createApproval(input: {
  clinicId?: string | null;
  runId?: string | null;
  taskId?: string | null;
  approvalType: string;
  title: string;
  summary: string;
  requestedAction?: Record<string, unknown>;
}) {
  const sql = getSql();
  const clinicId = await resolveClinicId(input.clinicId);
  const rows = await sql<ApprovalRow[]>`
    insert into approvals (
      clinic_id,
      run_id,
      task_id,
      approval_type,
      title,
      summary,
      requested_action
    )
    values (
      ${clinicId},
      ${input.runId ?? null},
      ${input.taskId ?? null},
      ${input.approvalType},
      ${input.title},
      ${input.summary},
      ${sql.json(jsonInput(input.requestedAction ?? {}))}
    )
    returning ${sql.unsafe(approvalColumns)}
  `;
  return normalizeApproval(rows[0]);
}

export async function decideApproval(
  id: string,
  input: {
    clinicId?: string | null;
    status: "approved" | "rejected";
    actor: Actor;
    note?: string | null;
  }
) {
  const sql = getSql();
  const clinicId = await resolveClinicId(input.clinicId);
  const rows = await sql<ApprovalRow[]>`
    update approvals
    set
      status = ${input.status},
      decided_by_name = ${input.actor.name},
      decided_by_role = ${input.actor.role}::app_role,
      decided_at = now(),
      decision_note = ${input.note ?? null},
      updated_at = now()
    where id = ${id}
      and clinic_id = ${clinicId}
    returning ${sql.unsafe(approvalColumns)}
  `;
  return rows[0] ? normalizeApproval(rows[0]) : null;
}

export async function createAgentReport(input: {
  clinicId?: string | null;
  runId?: string | null;
  taskId?: string | null;
  reportType: string;
  title: string;
  summary: string;
  data?: Record<string, unknown>;
}) {
  const sql = getSql();
  const clinicId = await resolveClinicId(input.clinicId);
  const rows = await sql<AgentReportRow[]>`
    insert into agent_reports (
      clinic_id,
      run_id,
      task_id,
      report_type,
      title,
      summary,
      data
    )
    values (
      ${clinicId},
      ${input.runId ?? null},
      ${input.taskId ?? null},
      ${input.reportType},
      ${input.title},
      ${input.summary},
      ${sql.json(jsonInput(input.data ?? {}))}
    )
    returning ${sql.unsafe(reportColumns)}
  `;
  return normalizeReport(rows[0]);
}
