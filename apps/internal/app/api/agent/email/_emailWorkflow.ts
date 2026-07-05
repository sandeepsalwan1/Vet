import { createHash, randomUUID } from "node:crypto";
import {
  createAgentDecision,
  createAgentRun,
  createAgentToolCall,
  createWorkflowEvent,
  failAgentRun,
  updateAgentRun,
  type Actor,
  type ClinicContext
} from "@central-vet/db";
import { notificationEmailFrom, sendAgentExampleEmail } from "@central-vet/notifications";
import { NextResponse } from "next/server";
import { dbError, logInfo, noStoreHeaders } from "../../_apiResponse";
import {
  audienceFromBody,
  blockedMessage,
  cadenceFromBody,
  emailBlockers,
  emailBodySchema,
  emailConfirmation,
  recipientsFromBody,
  resultStats,
  statusMessage
} from "./_emailCampaign";
import {
  emailCapability,
  emailCompletionPayload,
  emailCompletionResponse,
  emailDecisionKind,
  emailDecisionTtl,
  type EmailCompletionPayload
} from "./_emailCompletion";

type EmailWorkflowInput = {
  actor: Actor;
  body: Record<string, unknown>;
  clinic: ClinicContext;
  request: Request;
};

function hashInput(value: Record<string, unknown>) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function summarizeInput(value: Record<string, unknown>) {
  const message = typeof value.message === "string" ? value.message : "";
  return message.trim().slice(0, 500) || "agent email send";
}

function responseHeaders(runId: string, traceId: string) {
  return {
    ...noStoreHeaders,
    "x-vetagent-run-id": runId,
    "x-vetagent-trace-id": traceId
  };
}

export async function executeEmailAgentWorkflow(input: EmailWorkflowInput) {
  const traceId = randomUUID();
  const requestId = input.request.headers.get("x-request-id") || randomUUID();
  const started = Date.now();
  const clinicId = input.clinic.clinicId;
  let runId: string | null = null;

  try {
    const parsed = emailBodySchema.safeParse(input.body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid email agent request." }, { status: 400 });
    }

    const recipients = recipientsFromBody(parsed.data);
    const mode = parsed.data.mode ?? "test";
    const cadence = cadenceFromBody(parsed.data);
    const audience = audienceFromBody(parsed.data, cadence, recipients);
    const confirmation = emailConfirmation({
      body: parsed.data,
      mode,
      cadence,
      audience,
      recipients,
      actorProfileId: input.actor.profileId ?? null
    });
    const blockers = emailBlockers(confirmation, parsed.data.confirmed);
    const capabilityDecision = {
      agent: "internal",
      agentKind: "internal",
      capability: emailCapability,
      parsedInput: {
        mode,
        cadence,
        audience,
        subject: confirmation.subject,
        recipientCount: confirmation.recipientCount,
        templateId: confirmation.templateId,
        templateVersion: confirmation.templateVersion,
        templateReviewed: confirmation.templateReviewed,
        sendNow: confirmation.sendNow,
        scheduledFor: confirmation.scheduledFor ?? null,
        postAppointmentDelayDays: confirmation.postAppointmentDelayDays ?? null
      },
      requiredMissingFields: blockers,
      riskLevel: mode === "production" || cadence !== "once" ? "high" : "medium",
      cachePolicy: "none",
      nextAction: blockers.length ? "confirm" : "call_tool"
    };
    const runInput = {
      intent: "email",
      mode,
      cadence,
      audience,
      period: parsed.data.period,
      subject: parsed.data.subject,
      message: parsed.data.message,
      recipients,
      confirmation,
      actor: {
        name: input.actor.name,
        role: input.actor.role,
        profileId: input.actor.profileId ?? null
      }
    };
    const run = await createAgentRun({
      clinicId,
      agent: "internal",
      intent: "email",
      mode,
      status: "running",
      input: runInput,
      traceId,
      requestId,
      inputHash: hashInput(runInput),
      inputSummary: summarizeInput(runInput)
    });
    runId = run.id;

    if (blockers.length > 0) {
      const message = blockedMessage(blockers);
      const durationMs = Date.now() - started;
      const toolCall = await createAgentToolCall({
        clinicId,
        runId,
        traceId,
        sequence: 1,
        toolName: "validate_email_campaign_confirmation",
        status: "ok",
        args: { confirmation },
        result: { blocked: true, blockers },
        error: null,
        durationMs
      });
      const event = await createWorkflowEvent({
        clinicId,
        runId,
        workflowType: "email",
        eventType: "agent_email_decision",
        title: "Agent email blocked for confirmation",
        detail: message,
        metadata: {
          traceId,
          status: "blocked",
          blockers,
          confirmation,
          capabilityDecision
        }
      });
      const decisionRow = await createAgentDecision({
        clinicId,
        runId,
        traceId,
        agent: "internal",
        capability: emailCapability,
        decisionKind: emailDecisionKind,
        status: "blocked",
        ttl: emailDecisionTtl,
        actor: input.actor,
        action: "validate_email_campaign_confirmation",
        inputSummary: summarizeInput(runInput),
        resultSummary: message,
        metadata: { blockers, confirmation, capabilityDecision }
      });
      const completion = {
        mode,
        cadence,
        audience,
        period: parsed.data.period ?? null,
        confirmation,
        capabilityDecision,
        message,
        result: { blocked: true, blockers, confirmation },
        decisionStatus: "blocked",
        decisionIds: [decisionRow.id]
      } satisfies EmailCompletionPayload;
      await updateAgentRun(runId, {
        clinicId,
        status: "completed",
        output: emailCompletionPayload(completion),
        error: null,
        durationMs,
        outputSummary: message,
        toolCallCount: 1
      });
      logInfo("agent_email_blocked", { mode, cadence, blockers: blockers.join(", ") });

      return NextResponse.json(
        emailCompletionResponse({
          ...completion,
          runId,
          traceId,
          durationMs,
          workflowEvents: [event],
          toolCalls: [toolCall]
        }),
        { headers: responseHeaders(runId, traceId) }
      );
    }

    const sent = await sendAgentExampleEmail({
      clinicId,
      timeZone: input.clinic.timeZone,
      modeOverride: mode,
      recipients,
      subject: parsed.data.subject,
      message: parsed.data.message,
      actorName: input.actor.name,
      cadence,
      period: parsed.data.period,
      postAppointmentDelayDays: confirmation.postAppointmentDelayDays
    });
    const stats = resultStats(sent.results);
    const message = statusMessage(stats, mode);
    const durationMs = Date.now() - started;
    const decisionStatus = stats.sent > 0 ? "completed" : stats.skipped > 0 ? "blocked" : "proposed";
    const toolCall = await createAgentToolCall({
      clinicId,
      runId,
      traceId,
      sequence: 1,
      toolName: "send_agent_example_email",
      status: stats.failed > 0 && stats.sent === 0 && stats.skipped === 0 && stats.duplicate === 0 ? "error" : "ok",
      args: {
        from: notificationEmailFrom(),
        recipients: recipients.length > 0 ? recipients : "env configured recipients",
        subject: sent.subject,
        cadence,
        audience,
        period: sent.period,
        mode
      },
      result: sent,
      error: stats.failed > 0 && stats.sent === 0 ? "No email was sent." : null,
      durationMs
    });
    const event = await createWorkflowEvent({
      clinicId,
      runId,
      workflowType: "email",
      eventType: "agent_email_checked",
      title: "Agent email send checked",
      detail: message,
      metadata: {
        traceId,
        from: sent.from,
        recipientCount: recipients.length,
        mode,
        cadence,
        audience,
        period: sent.period,
        stats,
        confirmation,
        capabilityDecision
      }
    });
    const decisionRow = await createAgentDecision({
      clinicId,
      runId,
      traceId,
      agent: "internal",
      capability: emailCapability,
      decisionKind: emailDecisionKind,
      status: decisionStatus,
      ttl: emailDecisionTtl,
      actor: input.actor,
      action: "send_agent_email",
      inputSummary: summarizeInput(runInput),
      resultSummary: message,
      metadata: { stats, confirmation, capabilityDecision, sent }
    });
    const completion = {
      mode,
      cadence,
      audience,
      period: sent.period,
      confirmation,
      capabilityDecision,
      message,
      result: sent,
      stats,
      decisionStatus,
      decisionIds: [decisionRow.id]
    } satisfies EmailCompletionPayload;
    await updateAgentRun(runId, {
      clinicId,
      status: "completed",
      output: emailCompletionPayload(completion),
      error: null,
      durationMs,
      outputSummary: message,
      toolCallCount: 1
    });
    logInfo("agent_email_checked", { mode, resultCount: sent.results.length });

    return NextResponse.json(
      emailCompletionResponse({
        ...completion,
        runId,
        traceId,
        durationMs,
        workflowEvents: [event],
        toolCalls: [toolCall]
      }),
      { headers: responseHeaders(runId, traceId) }
    );
  } catch (error) {
    const durationMs = Date.now() - started;
    const message = error instanceof Error ? error.message : "Agent email workflow failed.";
    if (runId) {
      await failAgentRun(runId, {
        clinicId,
        error: message,
        errorKind: error instanceof Error ? error.name : "agent_email_error",
        durationMs,
        toolCallCount: 0
      }).catch(() => null);
      await createWorkflowEvent({
        clinicId,
        runId,
        workflowType: "email",
        eventType: "run_failed",
        title: "Agent email run failed",
        detail: message,
        metadata: { traceId, requestId }
      }).catch(() => null);
    }
    return dbError(error, { route: "agent.email" });
  }
}
