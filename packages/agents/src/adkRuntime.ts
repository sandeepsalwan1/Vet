import {
  InMemoryRunner,
  getFunctionCalls,
  getFunctionResponses,
  isFinalResponse,
  stringifyContent,
  type Event
} from "@google/adk";
import { createUserContent } from "@google/genai";
import { createExternalAdkAgent, createInternalAdkAgent } from "./adkAgents";
import type {
  AgentInput,
  AgentIntent,
  AgentWorkflowResult,
  RunAgentOptions,
  WorkflowEventDraft
} from "./contracts";
import { classifyIntent, createRuntime, normalizeAgentInput } from "./mockProvider";
import { runExternalAgent } from "./externalAgent";
import { runInternalAgent } from "./internalAgent";
import { googleAdkModel } from "./runtimeConfig";
import { getInputText } from "./tools";

type AgentKind = "external" | "internal";

function eventId(intent: AgentIntent, type: string, count: number) {
  return `event-${intent}-${type}-${count}`.replace(/[^a-zA-Z0-9-]/g, "-");
}

function addEvent(runtime: ReturnType<typeof createRuntime>, intent: AgentIntent, input: Omit<WorkflowEventDraft, "id" | "createdAt" | "workflowType">) {
  const event: WorkflowEventDraft = {
    id: eventId(intent, input.eventType, runtime.workflowEvents.length),
    workflowType: intent,
    eventType: input.eventType,
    title: input.title,
    detail: input.detail,
    metadata: input.metadata,
    createdAt: runtime.now.toISOString()
  };
  runtime.workflowEvents.push(event);
  runtime.effects.push(event);
  return event;
}

function promptFor(kind: AgentKind, intent: AgentIntent, input: AgentInput, maxToolCalls: number) {
  return JSON.stringify({
    task: "Run this veterinary workflow using tools, then return concise JSON.",
    agent: kind,
    intent,
    maxToolCalls,
    input,
    requiredSafety: {
      medicalAdviceGiven: false,
      recordsSentAutomatically: intent === "records",
      changedInvoices: false,
      changedPrices: false
    },
    requestText: getInputText(input)
  });
}

function adkTimeoutMs(kind: AgentKind) {
  const raw = process.env.AGENT_ADK_TIMEOUT_MS || process.env.GOOGLE_ADK_TIMEOUT_MS;
  const parsed = raw ? Number(raw) : NaN;
  if (Number.isFinite(parsed) && parsed >= 1_000) return parsed;
  return kind === "internal" ? 20_000 : 15_000;
}

const concreteIntents = new Set<AgentIntent>([
  "booking",
  "call",
  "checkin",
  "daily_ops",
  "followup",
  "invoice",
  "labs",
  "pickup",
  "pricing",
  "records",
  "sick_pet"
]);

function concreteRouteIntent(value: string | undefined): AgentIntent | null {
  return value && concreteIntents.has(value as AgentIntent) ? value as AgentIntent : null;
}

function intentFor(kind: AgentKind, input: AgentInput, options: RunAgentOptions): AgentIntent {
  return concreteRouteIntent(options.routeIntent) ?? classifyIntent(input, kind === "internal" ? "daily_ops" : "call");
}

// HYBRID DESIGN (intentional, demo-safe).
// The real ADK LlmAgent above executes for real: it reasons, calls FunctionTools
// (the same typed registry as the deterministic path), and its tool calls + events
// are mirrored into runtime.toolCalls / runtime.workflowEvents and persisted — so
// run-detail proves the ADK agent invoked tools (e.g. an `adk_tool_call`
// book_appointment/send_followup_outreach plus an agent_tool_calls row with the
// ADK args).
//
// For the STABLE API contract (message/result/task/approval/report), we then run the
// deterministic agent once and use ITS effects. This keeps the response shape and
// safety invariants reliable regardless of LLM nondeterminism.
//
// Persisted reports and workflow events are finalized by the deterministic re-run,
// not the ADK FunctionTool drafts (which live in runtime.effects and are
// intentionally not merged here). This keeps no-HITL action contracts stable while
// still proving real ADK tool execution.
async function contractResultFor(input: {
  kind: AgentKind;
  normalized: AgentInput;
  intent: AgentIntent;
  runtime: ReturnType<typeof createRuntime>;
  options: RunAgentOptions;
  model: string;
  finalText: string;
}) {
  addEvent(input.runtime, input.intent, {
    eventType: "adk_contract_normalized",
    title: "ADK run normalized to route contract",
    detail: "Real ADK execution completed; shared package workflow produced the stable API contract.",
    metadata: {
      model: input.model,
      routeIntent: input.options.routeIntent ?? null,
      adkToolCallCount: input.runtime.toolCalls.length,
      finalText: input.finalText.slice(0, 500) || null
    }
  });

  const adkWorkflowEvents = [...input.runtime.workflowEvents];
  const adkToolCalls = [...input.runtime.toolCalls];
  const contractInput: AgentInput = { ...input.normalized, intent: input.intent };
  const contractOptions: RunAgentOptions = {
    ...input.options,
    mode: "google-adk",
    model: input.model
  };
  const contract = input.kind === "internal"
    ? await runInternalAgent(contractInput, contractOptions)
    : await runExternalAgent(contractInput, contractOptions);

  return {
    ...contract,
    mode: contract.mode === "apify" ? "apify" : "google-adk",
    workflowEvents: [...adkWorkflowEvents, ...contract.workflowEvents],
    effects: [...adkWorkflowEvents, ...contract.effects],
    toolCalls: [...adkToolCalls, ...contract.toolCalls],
    result: {
      ...contract.result,
      adkExecuted: true,
      adkToolCallCount: adkToolCalls.length,
      adkContractNormalized: true
    }
  } satisfies AgentWorkflowResult;
}

async function runGoogleAdkAgent(kind: AgentKind, input: AgentInput | unknown, options: RunAgentOptions = {}): Promise<AgentWorkflowResult> {
  const normalized = normalizeAgentInput(input);
  const intent = intentFor(kind, normalized, options);
  const runtime = createRuntime(normalized, intent, {
    ...options,
    mode: "google-adk"
  });
  const maxToolCalls = kind === "internal" ? 12 : 8;
  const model = options.model || googleAdkModel();
  const timeoutMs = adkTimeoutMs(kind);
  const abortController = new AbortController();

  addEvent(runtime, intent, {
    eventType: "adk_start",
    title: "Google ADK run started",
    detail: "LlmAgent and InMemoryRunner execution started.",
    metadata: { model, agent: kind, routeIntent: options.routeIntent ?? null, timeoutMs }
  });

  try {
    const agent = kind === "internal" ? createInternalAdkAgent(runtime) : createExternalAdkAgent(runtime);
    const runner = new InMemoryRunner({ agent, appName: "central-vet" });
    const session = await runner.sessionService.createSession({
      appName: runner.appName,
      userId: `vetagent-${options.runId ?? "run"}`,
      state: {
        traceId: options.traceId ?? null,
        runId: options.runId ?? null,
        routeIntent: options.routeIntent ?? intent,
        inputSummary: getInputText(normalized).slice(0, 500),
        clinicContext: {
          clients: runtime.data.clients.length,
          pets: runtime.data.pets.length,
          appointments: runtime.data.appointments.length,
          labOrders: runtime.data.labOrders?.length ?? 0
        }
      }
    });
    let finalText = "";
    const runPromise = (async () => {
      for await (const event of runner.runAsync({
        userId: session.userId,
        sessionId: session.id,
        newMessage: createUserContent(promptFor(kind, intent, normalized, maxToolCalls)),
        runConfig: { maxLlmCalls: kind === "internal" ? 8 : 6 },
        abortSignal: abortController.signal
      })) {
        mirrorAdkEvent(runtime, intent, event);
        if (isFinalResponse(event)) finalText = stringifyContent(event).trim();
      }
      return finalText;
    })();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        abortController.abort();
        reject(new Error(`Google ADK execution timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });
    try {
      finalText = await Promise.race([runPromise, timeoutPromise]);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      runPromise.catch(() => undefined);
    }

    addEvent(runtime, intent, {
      eventType: "adk_final_response",
      title: "Google ADK final response received",
      detail: finalText.slice(0, 500) || null,
      metadata: { model, toolCallCount: runtime.toolCalls.length }
    });

    if (!runtime.toolCalls.length) {
      addEvent(runtime, intent, {
        eventType: "adk_parse_fallback",
        title: "ADK produced no tool calls",
        detail: "Using shared package workflow after real ADK execution.",
        metadata: { model }
      });
    }

    return contractResultFor({ kind, normalized, intent, runtime, options, model, finalText });
  } catch (error) {
    const message = abortController.signal.aborted
      ? `Google ADK execution timed out after ${timeoutMs}ms`
      : error instanceof Error ? error.message : "ADK execution failed";
    addEvent(runtime, intent, {
      eventType: "runtime_fallback",
      title: "Google ADK runtime fallback",
      detail: message,
      metadata: { model, agent: kind, timeoutMs }
    });
    const fallback = kind === "internal"
      ? await runInternalAgent(normalized, { ...options, mode: "mock" })
      : await runExternalAgent(normalized, { ...options, mode: "mock" });
    fallback.workflowEvents.unshift(...runtime.workflowEvents);
    fallback.effects.unshift(...runtime.workflowEvents);
    fallback.result = {
      ...fallback.result,
      adkFallback: true,
      adkError: message
    };
    return fallback;
  }
}

function mirrorAdkEvent(runtime: ReturnType<typeof createRuntime>, intent: AgentIntent, event: Event) {
  const calls = getFunctionCalls(event);
  const responses = getFunctionResponses(event);
  if (calls.length) {
    addEvent(runtime, intent, {
      eventType: "adk_tool_call",
      title: "ADK requested tool call",
      detail: calls.map((call) => call.name).join(", "),
      metadata: { calls: calls.map((call) => ({ name: call.name, id: call.id ?? null })) }
    });
  }
  if (responses.length) {
    addEvent(runtime, intent, {
      eventType: "adk_tool_response",
      title: "ADK received tool response",
      detail: responses.map((response) => response.name).join(", "),
      metadata: { responses: responses.map((response) => ({ name: response.name, id: response.id ?? null })) }
    });
  }
}

export function runGoogleAdkExternalAgent(input: AgentInput | unknown, options: RunAgentOptions = {}) {
  return runGoogleAdkAgent("external", input, options);
}

export function runGoogleAdkInternalAgent(input: AgentInput | unknown, options: RunAgentOptions = {}) {
  return runGoogleAdkAgent("internal", input, options);
}
