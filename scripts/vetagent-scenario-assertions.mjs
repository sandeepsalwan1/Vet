function getPath(value, path) {
  return path.split(".").reduce((item, key) => item?.[key], value);
}

export function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

export function detailSummary(detail) {
  if (!detail || detail.error) {
    return {
      ok: false,
      status: detail?.status ?? null,
      error: detail?.error ?? null,
      runStatus: null,
      runMode: null,
      model: null,
      workflowEventCount: 0,
      toolCallCount: 0,
      workflowEventTypes: [],
      toolNames: [],
      linkedTaskIds: [],
      linkedApprovalIds: [],
      linkedReportIds: [],
      linkedDecisionIds: []
    };
  }
  return {
    ok: Boolean(detail.run?.id),
    status: 200,
    runStatus: detail.run?.status ?? null,
    runMode: detail.run?.mode ?? null,
    model: detail.run?.model ?? null,
    workflowEventCount: detail.workflowEvents?.length ?? 0,
    toolCallCount: detail.toolCalls?.length ?? 0,
    workflowEventTypes: unique((detail.workflowEvents ?? []).map((event) => event.eventType)),
    toolNames: unique((detail.toolCalls ?? []).map((tool) => tool.toolName)),
    linkedTaskIds: detail.linkedTaskIds ?? [],
    linkedApprovalIds: detail.linkedApprovalIds ?? [],
    linkedReportIds: detail.linkedReportIds ?? [],
    linkedDecisionIds: detail.linkedDecisionIds ?? []
  };
}

export function assertScenario(scenario, data, detail) {
  const errors = [];
  const expect = scenario.expect;
  const responseToolNames = unique((data.toolCalls ?? []).map((tool) => tool.toolName));
  const responseEventTypes = unique((data.workflowEvents ?? []).map((event) => event.eventType));
  if (data.ok !== true) errors.push("ok not true");
  if (expect.intent && data.intent !== expect.intent) errors.push(`intent ${data.intent || "missing"} expected ${expect.intent}`);
  if (!data.runId) errors.push("runId missing");
  if (!data.traceId) errors.push("traceId missing");
  if (expect.task && !data.task?.id) errors.push("task missing");
  if (expect.noTask && data.task?.id) errors.push(`unexpected task ${data.task.id}`);
  if (expect.approval && !data.approval?.id) errors.push("approval missing");
  if (expect.noApproval && data.approval?.id) errors.push(`unexpected approval ${data.approval.id}`);
  if (expect.report && !data.report?.id) errors.push("report missing");
  if (expect.taskPriority && data.task?.priority !== expect.taskPriority) errors.push(`task priority ${data.task?.priority || "missing"} expected ${expect.taskPriority}`);
  if (expect.messageIncludes && !data.message?.includes(expect.messageIncludes)) errors.push(`message missing ${expect.messageIncludes}`);
  if (expect.messageExcludes && data.message?.includes(expect.messageExcludes)) errors.push(`message included ${expect.messageExcludes}`);
  if ((data.workflowEvents?.length ?? 0) < 1) errors.push("workflowEvents missing");
  if ((data.toolCalls?.length ?? 0) < (expect.minTools ?? 1)) errors.push(`toolCalls ${(data.toolCalls?.length ?? 0)} below ${expect.minTools ?? 1}`);
  for (const toolName of expect.tools ?? []) {
    if (!responseToolNames.includes(toolName)) errors.push(`tool ${toolName} missing`);
  }
  for (const eventType of expect.workflowEvents ?? []) {
    if (!responseEventTypes.includes(eventType)) errors.push(`workflow event ${eventType} missing`);
  }
  if (detail) {
    if (!detail.run?.id) errors.push("run detail missing persisted run");
    if ((detail.workflowEvents?.length ?? 0) < 1) errors.push("run detail workflow events missing");
    if ((detail.toolCalls?.length ?? 0) < (expect.minTools ?? 1)) errors.push("run detail tool calls missing");
    const detailToolNames = unique((detail.toolCalls ?? []).map((tool) => tool.toolName));
    for (const toolName of expect.tools ?? []) {
      if (!detailToolNames.includes(toolName)) errors.push(`run detail tool ${toolName} missing`);
    }
    if (expect.task && !detail.linkedTaskIds?.length) errors.push("run detail linked task missing");
    if (expect.noTask && detail.linkedTaskIds?.length) errors.push(`run detail unexpected task ${detail.linkedTaskIds.join(",")}`);
    if (expect.approval && !detail.linkedApprovalIds?.length) errors.push("run detail linked approval missing");
    if (expect.noApproval && detail.linkedApprovalIds?.length) errors.push(`run detail unexpected approval ${detail.linkedApprovalIds.join(",")}`);
    if (expect.report && !detail.linkedReportIds?.length) errors.push("run detail linked report missing");
    if (expect.decision !== false && !detail.linkedDecisionIds?.length) errors.push("run detail linked decision missing");
  }
  for (const [key, value] of Object.entries(expect.result ?? {})) {
    if (getPath(data.result, key) !== value) errors.push(`result.${key} expected ${String(value)}`);
  }
  for (const [key, value] of Object.entries(expect.resultNot ?? {})) {
    if (getPath(data.result, key) === value) errors.push(`result.${key} must not be ${String(value)}`);
  }
  for (const key of expect.resultPresent ?? []) {
    if (getPath(data.result, key) === undefined || getPath(data.result, key) === null) errors.push(`result.${key} missing`);
  }
  for (const [key, value] of Object.entries(expect.safety ?? {})) {
    if (getPath(data.result, key) !== value) errors.push(`safety ${key} expected ${String(value)}`);
  }
  return errors;
}

export function assertDeniedScenario(scenario, data, status) {
  const errors = [];
  const expect = scenario.expect ?? {};
  if (status !== expect.status) errors.push(`status ${status} expected ${expect.status}`);
  if (expect.errorIncludes && !String(data.error ?? "").includes(expect.errorIncludes)) {
    errors.push(`error missing ${expect.errorIncludes}`);
  }
  if (expect.noRunId && data.runId) errors.push(`unexpected runId ${data.runId}`);
  if (expect.noTraceId && data.traceId) errors.push(`unexpected traceId ${data.traceId}`);
  return errors;
}
