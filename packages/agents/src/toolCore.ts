import { z } from "zod";
import type {
  AgentEffect,
  AgentInput,
  AgentIntent,
  AgentReportDraft,
  AgentTaskDraft,
  MockClinicData,
  MockInvoice,
  ToolCallTrace,
  TaskPriority,
  TaskRequestType,
  WorkflowEventDraft
} from "./contracts";
import { createMockClinicAdapters, type VetAgentAdapters } from "./adapters";
import { mockClinicData } from "./mockData";
import {
  clientFor,
  firstClient,
  firstPet,
  id,
  looseMatch,
  petFor
} from "./mockClinicLookup";

export {
  clientFor,
  firstClient,
  firstPet,
  id,
  looseMatch,
  petFor
} from "./mockClinicLookup";

export type ToolRuntime = {
  data: MockClinicData;
  adapters: VetAgentAdapters;
  now: Date;
  input: AgentInput;
  workflowType: AgentIntent;
  effects: AgentEffect[];
  workflowEvents: WorkflowEventDraft[];
  toolCalls: ToolCallTrace[];
};

type ToolDefinition<T extends z.ZodTypeAny> = {
  description: string;
  parameters: T;
  execute: (args: z.infer<T>, runtime: ToolRuntime) => Promise<Record<string, unknown>>;
};

export type RunnableTool = {
  parameters: z.ZodTypeAny;
  execute: (args: unknown, runtime: ToolRuntime) => Promise<Record<string, unknown>>;
};

export function defineTool<TParameters extends z.ZodTypeAny>(
  definition: ToolDefinition<TParameters>
) {
  return definition;
}

export function defineTools<const TTools extends Record<string, ToolDefinition<z.ZodTypeAny>>>(
  definitions: TTools
) {
  return definitions;
}

function textFromInput(input: AgentInput) {
  return [
    input.message,
    input.request,
    input.transcript,
    input.body
  ].filter((value): value is string => Boolean(value?.trim())).join(" ");
}

export function makeTask(input: {
  status?: "pending_review" | "due" | "pending";
  priority?: TaskPriority;
  requestType?: TaskRequestType;
  clientName?: string | null;
  clientPhone?: string | null;
  petName?: string | null;
  request: string;
  notes?: string | null;
  dueTimeHint?: string;
}) {
  const task: AgentTaskDraft = {
    id: id("task", `${input.clientName ?? "clinic"}-${input.petName ?? "request"}-${input.request}`),
    kind: "task",
    status: input.status ?? "pending_review",
    priority: input.priority ?? "medium",
    requestType: input.requestType ?? "patient_update",
    clientName: input.clientName ?? null,
    clientPhone: input.clientPhone ?? null,
    petName: input.petName ?? null,
    request: input.request,
    notes: input.notes ?? null,
    dueTimeHint: input.dueTimeHint
  };
  return task;
}

export function makeReport(input: Omit<AgentReportDraft, "id" | "kind">) {
  return {
    id: id("report", `${input.reportType}-${input.title}`),
    kind: "report" as const,
    ...input
  };
}

export function recordEvent(runtime: ToolRuntime, event: Omit<WorkflowEventDraft, "id" | "createdAt" | "workflowType">) {
  const workflowEvent: WorkflowEventDraft = {
    id: id("event", `${runtime.workflowType}-${event.eventType}-${runtime.workflowEvents.length}`),
    workflowType: runtime.workflowType,
    eventType: event.eventType,
    title: event.title,
    detail: event.detail,
    metadata: event.metadata,
    createdAt: runtime.now.toISOString()
  };
  runtime.workflowEvents.push(workflowEvent);
  runtime.effects.push(workflowEvent);
  return workflowEvent;
}

export function addEffect<T extends AgentEffect>(runtime: ToolRuntime, effect: T) {
  runtime.effects.push(effect);
  return effect;
}

export function triageText(message: string) {
  const text = message.toLowerCase();
  const urgent = /(blood|seizure|collapse|poison|toxin|breathing|emergency|lethargic)/.test(text);
  const intent =
    urgent || /(vomit|diarrhea|pain|sick|hurt)/.test(text)
      ? "sick_pet"
      : /(record|transfer)/.test(text)
        ? "records"
        : /(arriv|outside|check.?in|waiting|here for)/.test(text)
            ? "checkin"
            : /(book|schedule|appointment|reschedule)/.test(text)
              ? "booking"
              : "unknown";
  return { triage: { intent, urgent } };
}

function traceJson(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[max-depth]";
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value.length > 1000 ? `${value.slice(0, 1000)}...` : value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 25).map((item) => traceJson(item, depth + 1));
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      /passcode|api.?key|token|authorization|auth.?header|secret/i.test(key) ? "[redacted]" : traceJson(item, depth + 1)
    ]));
  }
  return String(value);
}

export function traceObject(value: unknown) {
  return traceJson(value ?? {}) as Record<string, unknown>;
}

export function createToolRuntime(input: AgentInput, workflowType: AgentIntent, options: {
  clinicData?: MockClinicData;
  now?: Date;
} = {}): ToolRuntime {
  const data = options.clinicData ?? mockClinicData;
  const now = options.now ?? new Date("2026-05-31T12:00:00.000Z");
  return {
    data,
    adapters: createMockClinicAdapters({ data, now }),
    now,
    input,
    workflowType,
    effects: [],
    workflowEvents: [],
    toolCalls: []
  };
}

export function getInputText(input: AgentInput) {
  return textFromInput(input);
}

export function summarizeInvoice(invoice: MockInvoice) {
  const dollars = (invoice.totalCents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD"
  });
  return `${invoice.invoiceNumber} (${dollars}, ${invoice.flags.length} flag(s))`;
}
