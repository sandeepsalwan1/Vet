import type {
  AgentApprovalDraft,
  AgentReportDraft,
  AgentTaskDraft,
  AgentWorkflowResult,
  WorkflowEventDraft
} from "@central-vet/agents";
import {
  createAgentDecision,
  createAgentReport,
  createAgentToolCall,
  createApproval,
  createTask,
  createWorkflowEvent,
  type Actor,
  type AgentReport,
  type AgentDecision,
  type Approval,
  type ClinicContext,
  type Task,
  type WorkflowEvent
} from "@central-vet/db";
import { persistOperationalMutations } from "./_operationalMutations";

export type PersistedAgentEffects = {
  task?: Task;
  approval?: Approval;
  report?: AgentReport;
  decisions: AgentDecision[];
  workflowEvents: WorkflowEvent[];
};

function today() {
  return new Date().toISOString().slice(0, 10);
}

function soonTime() {
  const date = new Date();
  date.setMinutes(date.getMinutes() + 30);
  return date.toTimeString().slice(0, 5);
}

function replaceDraftIds(value: unknown, ids: Map<string, string>): unknown {
  if (typeof value === "string") return ids.get(value) ?? value;
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => replaceDraftIds(item, ids));
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, replaceDraftIds(item, ids)])
  );
}

function decisionStatus(result: AgentWorkflowResult) {
  if (result.decision?.status) return result.decision.status;
  const nextAction = result.capabilityDecision?.nextAction;
  if (nextAction === "block") return "blocked";
  if (nextAction === "confirm" || nextAction === "ask_once") return "proposed";
  return "completed";
}

function decisionTtl(result: AgentWorkflowResult) {
  if (result.decision?.ttl) return result.decision.ttl;
  const capability = result.capabilityDecision?.capability ?? result.capability ?? result.intent;
  if (/booking|records|email/.test(capability)) return "permanent";
  if (result.capabilityDecision?.cachePolicy === "short_greeting" || result.capabilityDecision?.cachePolicy === "short_run_context") {
    return "short";
  }
  return "long";
}

function decisionAction(result: AgentWorkflowResult) {
  const action = result.result.action;
  return typeof action === "string"
    ? action
    : result.capabilityDecision?.nextAction ?? result.intent;
}

async function persistTask(draft: AgentTaskDraft, actor: Actor, clinic: ClinicContext) {
  return createTask({
    clinicId: clinic.clinicId,
    hospitalName: clinic.name,
    source: "admin",
    status: draft.status,
    priority: draft.priority,
    requestType: draft.requestType,
    clientName: draft.clientName,
    clientPhone: draft.clientPhone,
    petName: draft.petName,
    request: draft.request,
    notes: draft.notes,
    dueDate: today(),
    dueTime: draft.dueTimeHint || (draft.priority === "high" ? soonTime() : "19:00")
  }, actor);
}

export async function persistAgentEffects(
  runId: string,
  traceId: string,
  result: AgentWorkflowResult,
  actor: Actor,
  clinic: ClinicContext
): Promise<PersistedAgentEffects> {
  const draftIds = new Map<string, string>();
  const seen = new Set<string>();
  let task: Task | undefined;
  let approval: Approval | undefined;
  let report: AgentReport | undefined;
  const decisions: AgentDecision[] = [];
  const workflowEvents: WorkflowEvent[] = [];

  if (result.capabilityDecision || result.decision) {
    decisions.push(await createAgentDecision({
      clinicId: clinic.clinicId,
      runId,
      traceId,
      agent: result.capabilityDecision?.agent ?? "unknown",
      capability: result.capabilityDecision?.capability ?? result.capability ?? result.intent,
      decisionKind: result.decision?.kind ?? result.capabilityDecision?.capability ?? result.intent,
      status: decisionStatus(result),
      ttl: decisionTtl(result),
      actor,
      action: decisionAction(result),
      inputSummary: typeof result.capabilityDecision?.parsedInput.message === "string"
        ? result.capabilityDecision.parsedInput.message.slice(0, 500)
        : null,
      resultSummary: result.message.slice(0, 500),
      metadata: {
        decision: result.decision ?? null,
        capabilityDecision: result.capabilityDecision ?? null,
        result: result.result
      }
    }));
  }

  for (const effect of result.effects.filter((effect) => "kind" in effect && effect.kind === "task") as AgentTaskDraft[]) {
    if (seen.has(effect.id)) continue;
    seen.add(effect.id);
    const persisted = await persistTask(effect, actor, clinic);
    draftIds.set(effect.id, persisted.id);
    if (result.task?.id === effect.id || !task) task = persisted;
  }

  for (const effect of result.effects.filter((effect) => "kind" in effect && effect.kind === "approval") as AgentApprovalDraft[]) {
    if (seen.has(effect.id)) continue;
    seen.add(effect.id);
    const persisted = await createApproval({
      clinicId: clinic.clinicId,
      runId,
      taskId: effect.taskId ? draftIds.get(effect.taskId) ?? effect.taskId : null,
      approvalType: effect.approvalType,
      title: effect.title,
      summary: effect.summary,
      requestedAction: replaceDraftIds(effect.requestedAction, draftIds) as Record<string, unknown>
    });
    draftIds.set(effect.id, persisted.id);
    if (result.approval?.id === effect.id || !approval) approval = persisted;
  }

  for (const effect of result.effects.filter((effect) => "kind" in effect && effect.kind === "report") as AgentReportDraft[]) {
    if (seen.has(effect.id)) continue;
    seen.add(effect.id);
    const persisted = await createAgentReport({
      clinicId: clinic.clinicId,
      runId,
      taskId: effect.taskId ? draftIds.get(effect.taskId) ?? effect.taskId : null,
      reportType: effect.reportType,
      title: effect.title,
      summary: effect.summary,
      data: replaceDraftIds(effect.data, draftIds) as Record<string, unknown>
    });
    draftIds.set(effect.id, persisted.id);
    if (result.report?.id === effect.id || !report) report = persisted;
  }

  for (const effect of result.effects.filter((effect) => !("kind" in effect)) as WorkflowEventDraft[]) {
    if (seen.has(effect.id)) continue;
    seen.add(effect.id);
    workflowEvents.push(await createWorkflowEvent({
      clinicId: clinic.clinicId,
      runId,
      workflowType: effect.workflowType,
      eventType: effect.eventType,
      title: effect.title,
      detail: effect.detail,
      metadata: replaceDraftIds(effect.metadata, draftIds) as Record<string, unknown>
    }));
  }

  for (const [sequence, toolCall] of result.toolCalls.entries()) {
    await createAgentToolCall({
      clinicId: clinic.clinicId,
      runId,
      traceId,
      sequence: sequence + 1,
      toolName: toolCall.toolName,
      status: toolCall.status ?? "ok",
      args: toolCall.args,
      result: replaceDraftIds(toolCall.result, draftIds) as Record<string, unknown>,
      error: toolCall.error ?? null,
      durationMs: toolCall.durationMs ?? null
    });
  }

  const mutationEvents = await persistOperationalMutations(runId, traceId, result.toolCalls, clinic.clinicId);
  return { task, approval, report, decisions, workflowEvents: [...workflowEvents, ...mutationEvents] };
}
