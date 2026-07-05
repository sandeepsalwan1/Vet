import { createHash, randomUUID } from "node:crypto";
import {
  googleAdkCredentialState,
  googleAdkModel,
  googleAdkRequested,
  resolveAgentMode,
  runExternalAgent,
  runInternalAgent,
  type AgentMode,
  type AgentWorkflowResult,
  type WorkflowEventDraft
} from "@central-vet/agents";
import {
  createAgentRun,
  createWorkflowEvent,
  failAgentRun,
  updateAgentRun,
  type Actor,
  type ClinicContext
} from "@central-vet/db";
import { NextResponse } from "next/server";
import { dbError, noStoreHeaders } from "../_apiResponse";
import { resolveClinicFromRequest } from "../_shared";
import { loadAgentClinicData } from "./_clinicData";
import { persistAgentEffects, type PersistedAgentEffects } from "./_effectPersistence";
import {
  normalizeAgentRouteInput,
  workflowEventIntent,
  type AgentKind,
  type RouteIntent
} from "./_workflowRoutes";

type RunnerInput = {
  agent: AgentKind;
  routeIntent: RouteIntent;
  input: Record<string, unknown>;
  actor?: Actor;
  clinic?: ClinicContext;
  request: Request;
};

const agentActor: Actor = { name: "VetAgent", role: "admin" };

function textFromInput(input: Record<string, unknown>) {
  return ["message", "request", "transcript", "body"]
    .map((key) => input[key])
    .filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
    .join(" ");
}

function summary(value: Record<string, unknown>) {
  const text = textFromInput(value);
  if (text) return text.slice(0, 500);
  const keys = Object.keys(value).filter((key) => key !== "actor").slice(0, 8);
  return keys.join(", ") || "empty input";
}

function hashInput(value: Record<string, unknown>) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function runGoogleAdkWorkflow(
  agent: AgentKind,
  input: Record<string, unknown>,
  options: {
    runId: string;
    traceId: string;
    routeIntent: RouteIntent;
    mode: AgentMode;
    model?: string;
    clinicData: NonNullable<Parameters<typeof runExternalAgent>[1]>["clinicData"];
    now: Date;
  }
) {
  const adkRuntime = await import("@central-vet/agents/adk-runtime");
  return agent === "internal"
    ? adkRuntime.runGoogleAdkInternalAgent(input, options)
    : adkRuntime.runGoogleAdkExternalAgent(input, options);
}

function fallbackEvent(routeIntent: RouteIntent, traceId: string, runId: string): WorkflowEventDraft {
  return {
    id: `event-runtime-fallback-${runId}`,
    workflowType: workflowEventIntent(routeIntent),
    eventType: "runtime_fallback",
    title: "Google ADK credentials missing",
    detail: "AGENT_RUNTIME=google-adk requested, but Google credentials were not present. Fallback registry path used.",
    metadata: {
      traceId,
      env: googleAdkCredentialState()
    },
    createdAt: new Date().toISOString()
  };
}

function withResponseFields(result: AgentWorkflowResult, input: {
  runId: string;
  traceId: string;
  durationMs: number;
} & PersistedAgentEffects) {
  return {
    ...result,
    runId: input.runId,
    traceId: input.traceId,
    durationMs: input.durationMs,
    task: input.task ?? result.task,
    approval: input.approval ?? result.approval,
    report: input.report ?? result.report,
    decisions: input.decisions,
    workflowEvents: input.workflowEvents,
    toolCalls: result.toolCalls
  };
}

function runnerHeaders(runId: string, traceId: string) {
  return {
    ...noStoreHeaders,
    "x-vetagent-run-id": runId,
    "x-vetagent-trace-id": traceId
  };
}

export async function executeVetAgentWorkflow(input: RunnerInput) {
  const traceId = randomUUID();
  const requestId = input.request.headers.get("x-request-id") || randomUUID();
  const started = Date.now();
  const mode = resolveAgentMode();
  const clinic = input.clinic ?? await resolveClinicFromRequest(input.request);
  const normalizedInput = normalizeAgentRouteInput(input.routeIntent, input.input);
  let runId: string | null = null;

  try {
    const run = await createAgentRun({
      clinicId: clinic.clinicId,
      agent: input.agent,
      intent: input.routeIntent,
      // Record the actual resolved runtime, not just the env flag: when
      // AGENT_RUNTIME=google-adk but credentials are absent, agentMode() falls back
      // to "mock" and the run row must reflect that (a runtime_fallback event is also
      // emitted below). Avoids a run row that falsely claims mode=google-adk.
      mode,
      status: "running",
      input: normalizedInput,
      traceId,
      requestId,
      model: mode === "google-adk" ? googleAdkModel() : null,
      inputHash: hashInput(normalizedInput),
      inputSummary: summary(normalizedInput)
    });
    runId = run.id;
    const clinicData = await loadAgentClinicData(clinic.clinicId);
    const options = {
      runId,
      traceId,
      routeIntent: input.routeIntent,
      mode,
      model: mode === "google-adk" ? googleAdkModel() : undefined,
      clinicData,
      now: new Date()
    };
    let result = input.agent === "internal"
      ? mode === "google-adk"
        ? await runGoogleAdkWorkflow("internal", normalizedInput, options)
        : await runInternalAgent(normalizedInput, options)
      : mode === "google-adk"
        ? await runGoogleAdkWorkflow("external", normalizedInput, options)
        : await runExternalAgent(normalizedInput, options);

    if (googleAdkRequested() && mode !== "google-adk") {
      const event = fallbackEvent(input.routeIntent, traceId, runId);
      result = {
        ...result,
        workflowEvents: [event, ...result.workflowEvents],
        effects: [event, ...result.effects],
        result: { ...result.result, adkFallback: true }
      };
    }

    const persisted = await persistAgentEffects(
      runId,
      traceId,
      result,
      input.actor ?? agentActor,
      clinic
    );
    const durationMs = Date.now() - started;
    await updateAgentRun(runId, {
      clinicId: clinic.clinicId,
      status: "completed",
      output: {
        ok: true,
        mode: result.mode,
        intent: result.intent,
        message: result.message,
        result: result.result,
        taskId: persisted.task?.id ?? null,
        approvalId: persisted.approval?.id ?? null,
        reportId: persisted.report?.id ?? null,
        decisionIds: persisted.decisions.map((decision) => decision.id)
      },
      error: null,
      durationMs,
      outputSummary: result.message.slice(0, 500),
      toolCallCount: result.toolCalls.length,
      model: mode === "google-adk" ? googleAdkModel() : null
    });
    const body = withResponseFields(result, {
      runId,
      traceId,
      durationMs,
      task: persisted.task,
      approval: persisted.approval,
      report: persisted.report,
      decisions: persisted.decisions,
      workflowEvents: persisted.workflowEvents
    });
    return NextResponse.json(body, { headers: runnerHeaders(runId, traceId) });
  } catch (error) {
    const durationMs = Date.now() - started;
    const message = error instanceof Error ? error.message : "Agent workflow failed";
    if (runId) {
      await failAgentRun(runId, {
        clinicId: clinic.clinicId,
        error: message,
        errorKind: error instanceof Error ? error.name : "agent_error",
        durationMs
      }).catch(() => null);
      await createWorkflowEvent({
        clinicId: clinic.clinicId,
        runId,
        workflowType: workflowEventIntent(input.routeIntent),
        eventType: "run_failed",
        title: "Agent run failed",
        detail: message,
        metadata: { traceId, requestId }
      }).catch(() => null);
    }
    return dbError(error, { route: `agent.${input.routeIntent}` });
  }
}
