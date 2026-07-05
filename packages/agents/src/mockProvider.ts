import {
  agentInputSchema,
  type AgentEffect,
  type AgentInput,
  type AgentIntent,
  type AgentMode,
  type AgentReportDraft,
  type AgentTaskDraft,
  type AgentWorkflowResult,
  type RunAgentOptions,
  type ToolCallTrace,
  type WorkflowEventDraft
} from "./contracts";
export { resolveAgentMode as resolveMode } from "./runtimeConfig";
import { createToolRuntime, getInputText } from "./tools";

type AgentRuntime = ReturnType<typeof createToolRuntime>;

const intentPatterns: Array<[AgentIntent, RegExp]> = [
  ["checkin", /(arriv|outside|check.?in|waiting|here for)/i],
  ["booking", /(book|schedule|appointment|reschedule|first available|after 3|slot)/i],
  ["pickup", /(pickup|pick up|ready|medication|food|order)/i],
  ["records", /(record|transfer|another hospital|send.*hospital|eastside)/i],
  ["sick_pet", /(sick|breathing|cough|vomit|diarrhea|emergency|hurt|pain|blood|lethargic)/i],
  ["followup", /(follow.?up|vaccine|recheck|refill|due|booster)/i],
  ["invoice", /(invoice|bill|charge|payment|refund|surcharge)/i],
  ["pricing", /(price|pricing|competitor|market|underpriced|overpriced)/i],
  ["labs", /(lab|result|bloodwork|blood work|cbc|chemistry|urinalysis|antech)/i],
  ["daily_ops", /(daily|summary|ops|priorit|what should|attention)/i]
];

export function normalizeAgentInput(input: unknown): AgentInput {
  return agentInputSchema.parse(input);
}

export function classifyIntent(input: AgentInput, fallback: AgentIntent = "unknown"): AgentIntent {
  if (input.intent) return input.intent;
  if (input.scenario) return input.scenario;
  const text = getInputText(input);
  const match = intentPatterns.find(([, pattern]) => pattern.test(text));
  return match?.[0] ?? fallback;
}

function makeRunId(intent: AgentIntent, options: RunAgentOptions = {}) {
  if (options.runId) return options.runId;
  return `agent-${intent}-${(options.now ?? new Date("2026-05-31T12:00:00.000Z")).getTime()}`;
}

export function createRuntime(input: AgentInput, intent: AgentIntent, options: RunAgentOptions = {}) {
  return createToolRuntime(input, intent, {
    clinicData: options.clinicData,
    now: options.now
  });
}

export function buildResult(input: {
  intent: AgentIntent;
  mode: AgentMode;
  message: string;
  result: Record<string, unknown>;
  runtime: AgentRuntime;
  options?: RunAgentOptions;
  task?: AgentTaskDraft | null;
  approval?: AgentWorkflowResult["approval"] | null;
  report?: AgentReportDraft | null;
  decision?: AgentWorkflowResult["decision"] | null;
}): AgentWorkflowResult {
  const effects: AgentEffect[] = [...input.runtime.effects];
  const workflowEvents: WorkflowEventDraft[] = [...input.runtime.workflowEvents];
  const toolCalls: ToolCallTrace[] = [...input.runtime.toolCalls];
  return {
    ok: true,
    mode: input.mode,
    intent: input.intent,
    message: input.message,
    result: input.result,
    decision: input.decision ?? undefined,
    task: input.task ?? undefined,
    approval: input.approval ?? undefined,
    report: input.report ?? undefined,
    workflowEvents,
    runId: makeRunId(input.intent, input.options),
    effects,
    toolCalls
  };
}
