import { getSql } from "./connection";
import { resolveClinicId } from "./clinics";
import { listAgentDecisions } from "./agentDecisions";
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
  type AgentRunTimeline,
  type AgentToolCallRow,
  type ApprovalRow,
  type WorkflowEventRow
} from "./agentRows";

function boundedLimit(limit: number | undefined, defaultLimit: number, maxLimit: number) {
  return Math.min(Math.max(limit ?? defaultLimit, 1), maxLimit);
}

async function getAgentRun(id: string, options?: { clinicId?: string | null }) {
  const sql = getSql();
  const clinicId = await resolveClinicId(options?.clinicId);
  const rows = await sql<AgentRunRow[]>`
    select ${sql.unsafe(agentRunColumns)}
    from agent_runs
    where id = ${id}
      and clinic_id = ${clinicId}
  `;
  return rows[0] ? normalizeRun(rows[0]) : null;
}

async function listAgentToolCalls(options: {
  clinicId?: string | null;
  runId?: string | null;
  toolName?: string | null;
  limit?: number;
} = {}) {
  const sql = getSql();
  const clinicId = await resolveClinicId(options.clinicId);
  const limit = boundedLimit(options.limit, 100, 500);
  const rows = options.runId
    ? await sql<AgentToolCallRow[]>`
        select ${sql.unsafe(toolCallColumns)}
        from agent_tool_calls
        where run_id = ${options.runId}
          and clinic_id = ${clinicId}
        order by sequence asc, created_at asc
        limit ${limit}
      `
    : options.toolName
      ? await sql<AgentToolCallRow[]>`
          select ${sql.unsafe(toolCallColumns)}
          from agent_tool_calls
          where clinic_id = ${clinicId}
            and tool_name = ${options.toolName}
          order by created_at desc
          limit ${limit}
        `
      : await sql<AgentToolCallRow[]>`
          select ${sql.unsafe(toolCallColumns)}
          from agent_tool_calls
          where clinic_id = ${clinicId}
          order by created_at desc
          limit ${limit}
        `;
  return rows.map(normalizeToolCall);
}

async function listWorkflowEvents(options: {
  clinicId?: string | null;
  runId?: string | null;
  workflowType?: string | null;
  limit?: number;
} = {}) {
  const sql = getSql();
  const clinicId = await resolveClinicId(options.clinicId);
  const limit = boundedLimit(options.limit, 50, 200);
  const rows = options.runId
    ? await sql<WorkflowEventRow[]>`
        select ${sql.unsafe(workflowEventColumns)}
        from workflow_events
        where run_id = ${options.runId}
          and clinic_id = ${clinicId}
        order by created_at asc
        limit ${limit}
      `
    : options.workflowType
      ? await sql<WorkflowEventRow[]>`
          select ${sql.unsafe(workflowEventColumns)}
          from workflow_events
          where clinic_id = ${clinicId}
            and workflow_type = ${options.workflowType}
          order by created_at desc
          limit ${limit}
        `
      : await sql<WorkflowEventRow[]>`
          select ${sql.unsafe(workflowEventColumns)}
          from workflow_events
          where clinic_id = ${clinicId}
          order by created_at desc
          limit ${limit}
        `;
  return rows.map(normalizeWorkflowEvent);
}

export async function listApprovals(options: {
  clinicId?: string | null;
  status?: string | null;
  limit?: number;
} = {}) {
  const sql = getSql();
  const clinicId = await resolveClinicId(options.clinicId);
  const limit = boundedLimit(options.limit, 50, 200);
  const rows = options.status
    ? await sql<ApprovalRow[]>`
        select ${sql.unsafe(approvalColumns)}
        from approvals
        where clinic_id = ${clinicId}
          and status = ${options.status}
        order by created_at desc
        limit ${limit}
      `
    : await sql<ApprovalRow[]>`
        select ${sql.unsafe(approvalColumns)}
        from approvals
        where clinic_id = ${clinicId}
        order by created_at desc
        limit ${limit}
      `;
  return rows.map(normalizeApproval);
}

export async function listAgentReports(options: {
  clinicId?: string | null;
  reportType?: string | null;
  limit?: number;
} = {}) {
  const sql = getSql();
  const clinicId = await resolveClinicId(options.clinicId);
  const limit = boundedLimit(options.limit, 50, 200);
  const rows = options.reportType
    ? await sql<AgentReportRow[]>`
        select ${sql.unsafe(reportColumns)}
        from agent_reports
        where clinic_id = ${clinicId}
          and report_type = ${options.reportType}
        order by created_at desc
        limit ${limit}
      `
    : await sql<AgentReportRow[]>`
        select ${sql.unsafe(reportColumns)}
        from agent_reports
        where clinic_id = ${clinicId}
        order by created_at desc
        limit ${limit}
      `;
  return rows.map(normalizeReport);
}

export async function getAgentRunWithTimeline(
  id: string,
  options?: { clinicId?: string | null }
): Promise<AgentRunTimeline | null> {
  const clinicId = await resolveClinicId(options?.clinicId);
  const run = await getAgentRun(id, { clinicId });
  if (!run) return null;
  const sql = getSql();
  const [workflowEvents, toolCalls, approvalRows, reportRows] = await Promise.all([
    listWorkflowEvents({ clinicId, runId: id, limit: 200 }),
    listAgentToolCalls({ clinicId, runId: id, limit: 500 }),
    sql<ApprovalRow[]>`
      select ${sql.unsafe(approvalColumns)}
      from approvals
      where run_id = ${id}
        and clinic_id = ${clinicId}
      order by created_at asc
    `,
    sql<AgentReportRow[]>`
      select ${sql.unsafe(reportColumns)}
      from agent_reports
      where run_id = ${id}
        and clinic_id = ${clinicId}
      order by created_at asc
    `
  ]);
  const decisions = await listAgentDecisions({ clinicId, runId: id, limit: 100 });
  const approvals = approvalRows.map(normalizeApproval);
  const reports = reportRows.map(normalizeReport);
  const eventTaskIds = workflowEvents
    .map((event) => event.metadata.taskId)
    .filter((value): value is string => typeof value === "string");
  const outputTaskId = typeof run.output.taskId === "string" ? run.output.taskId : null;
  const linkedTaskIds = Array.from(new Set([
    outputTaskId,
    ...eventTaskIds,
    ...approvals.map((approval) => approval.taskId),
    ...reports.map((report) => report.taskId)
  ].filter((value): value is string => Boolean(value))));
  return {
    run,
    workflowEvents,
    toolCalls,
    approvals,
    reports,
    decisions,
    linkedTaskIds,
    linkedApprovalIds: approvals.map((approval) => approval.id),
    linkedReportIds: reports.map((report) => report.id),
    linkedDecisionIds: decisions.map((decision) => decision.id)
  };
}
