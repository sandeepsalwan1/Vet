import type { AppRole } from "./types";
import type { AgentDecision } from "./agentDecisionRows";

type AgentRun = {
  id: string;
  clinicId: string;
  agent: string;
  intent: string;
  mode: string;
  status: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  error: string | null;
  traceId: string | null;
  requestId: string | null;
  model: string | null;
  durationMs: number | null;
  inputHash: string | null;
  inputSummary: string | null;
  outputSummary: string | null;
  errorKind: string | null;
  tokenInput: number | null;
  tokenOutput: number | null;
  toolCallCount: number;
  createdAt: string;
  updatedAt: string;
};

export type WorkflowEvent = {
  id: string;
  clinicId: string;
  runId: string | null;
  workflowType: string;
  eventType: string;
  title: string;
  detail: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type Approval = {
  id: string;
  clinicId: string;
  runId: string | null;
  taskId: string | null;
  approvalType: string;
  status: string;
  title: string;
  summary: string;
  requestedAction: Record<string, unknown>;
  decidedByName: string | null;
  decidedByRole: AppRole | null;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AgentReport = {
  id: string;
  clinicId: string;
  runId: string | null;
  taskId: string | null;
  reportType: string;
  title: string;
  summary: string;
  data: Record<string, unknown>;
  createdAt: string;
};

type AgentToolCall = {
  id: string;
  clinicId: string;
  runId: string | null;
  traceId: string | null;
  sequence: number;
  toolName: string;
  status: string;
  args: Record<string, unknown>;
  result: Record<string, unknown>;
  error: string | null;
  durationMs: number | null;
  createdAt: string;
};

export type AgentRunTimeline = {
  run: AgentRun;
  workflowEvents: WorkflowEvent[];
  toolCalls: AgentToolCall[];
  approvals: Approval[];
  reports: AgentReport[];
  decisions: AgentDecision[];
  linkedTaskIds: string[];
  linkedApprovalIds: string[];
  linkedReportIds: string[];
  linkedDecisionIds: string[];
};

export type AgentRunRow = {
  id: string;
  clinic_id: string;
  agent: string;
  intent: string;
  mode: string;
  status: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  error: string | null;
  trace_id: string | null;
  request_id: string | null;
  model: string | null;
  duration_ms: number | null;
  input_hash: string | null;
  input_summary: string | null;
  output_summary: string | null;
  error_kind: string | null;
  token_input: number | null;
  token_output: number | null;
  tool_call_count: number;
  created_at: string;
  updated_at: string;
};

export type WorkflowEventRow = {
  id: string;
  clinic_id: string;
  run_id: string | null;
  workflow_type: string;
  event_type: string;
  title: string;
  detail: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type ApprovalRow = {
  id: string;
  clinic_id: string;
  run_id: string | null;
  task_id: string | null;
  approval_type: string;
  status: string;
  title: string;
  summary: string;
  requested_action: Record<string, unknown>;
  decided_by_name: string | null;
  decided_by_role: AppRole | null;
  decided_at: string | null;
  decision_note: string | null;
  created_at: string;
  updated_at: string;
};

export type AgentReportRow = {
  id: string;
  clinic_id: string;
  run_id: string | null;
  task_id: string | null;
  report_type: string;
  title: string;
  summary: string;
  data: Record<string, unknown>;
  created_at: string;
};

export type AgentToolCallRow = {
  id: string;
  clinic_id: string;
  run_id: string | null;
  trace_id: string | null;
  sequence: number;
  tool_name: string;
  status: string;
  args: Record<string, unknown>;
  result: Record<string, unknown>;
  error: string | null;
  duration_ms: number | null;
  created_at: string;
};

export const agentRunColumns = `
  id,
  clinic_id,
  agent,
  intent,
  mode,
  status,
  input,
  output,
  error,
  trace_id,
  request_id,
  model,
  duration_ms,
  input_hash,
  input_summary,
  output_summary,
  error_kind,
  token_input,
  token_output,
  tool_call_count,
  created_at,
  updated_at
`;

export const workflowEventColumns = `
  id,
  clinic_id,
  run_id,
  workflow_type,
  event_type,
  title,
  detail,
  metadata,
  created_at
`;

export const approvalColumns = `
  id,
  clinic_id,
  run_id,
  task_id,
  approval_type,
  status,
  title,
  summary,
  requested_action,
  decided_by_name,
  decided_by_role,
  decided_at,
  decision_note,
  created_at,
  updated_at
`;

export const reportColumns = `
  id,
  clinic_id,
  run_id,
  task_id,
  report_type,
  title,
  summary,
  data,
  created_at
`;

export const toolCallColumns = `
  id,
  clinic_id,
  run_id,
  trace_id,
  sequence,
  tool_name,
  status,
  args,
  result,
  error,
  duration_ms,
  created_at
`;

export function normalizeRun(row: AgentRunRow): AgentRun {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    agent: row.agent,
    intent: row.intent,
    mode: row.mode,
    status: row.status,
    input: row.input ?? {},
    output: row.output ?? {},
    error: row.error,
    traceId: row.trace_id,
    requestId: row.request_id,
    model: row.model,
    durationMs: row.duration_ms,
    inputHash: row.input_hash,
    inputSummary: row.input_summary,
    outputSummary: row.output_summary,
    errorKind: row.error_kind,
    tokenInput: row.token_input,
    tokenOutput: row.token_output,
    toolCallCount: row.tool_call_count ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function normalizeWorkflowEvent(row: WorkflowEventRow): WorkflowEvent {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    runId: row.run_id,
    workflowType: row.workflow_type,
    eventType: row.event_type,
    title: row.title,
    detail: row.detail,
    metadata: row.metadata ?? {},
    createdAt: row.created_at
  };
}

export function normalizeApproval(row: ApprovalRow): Approval {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    runId: row.run_id,
    taskId: row.task_id,
    approvalType: row.approval_type,
    status: row.status,
    title: row.title,
    summary: row.summary,
    requestedAction: row.requested_action ?? {},
    decidedByName: row.decided_by_name,
    decidedByRole: row.decided_by_role,
    decidedAt: row.decided_at,
    decisionNote: row.decision_note,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function normalizeReport(row: AgentReportRow): AgentReport {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    runId: row.run_id,
    taskId: row.task_id,
    reportType: row.report_type,
    title: row.title,
    summary: row.summary,
    data: row.data ?? {},
    createdAt: row.created_at
  };
}

export function normalizeToolCall(row: AgentToolCallRow): AgentToolCall {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    runId: row.run_id,
    traceId: row.trace_id,
    sequence: row.sequence,
    toolName: row.tool_name,
    status: row.status,
    args: row.args ?? {},
    result: row.result ?? {},
    error: row.error,
    durationMs: row.duration_ms,
    createdAt: row.created_at
  };
}
