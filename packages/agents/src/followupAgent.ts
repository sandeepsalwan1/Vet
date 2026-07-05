import type {
  AgentInput,
  AgentReportDraft,
  AgentWorkflowResult,
  MockClient,
  MockFollowup,
  MockPet,
  RunAgentOptions
} from "./contracts";
import {
  buildResult,
  createRuntime,
  normalizeAgentInput,
  resolveMode
} from "./mockProvider";
import { executeTool } from "./tools";

type FollowupCandidateResult = {
  candidates: MockFollowup[];
};

type FollowupTaskResult = {
  candidate: MockFollowup | null;
  client: MockClient | null;
  pet: MockPet | null;
  outreach?: {
    status: string;
    channel: string;
    sentAt?: string;
    message?: string;
  } | null;
  task?: null;
};

function normalize(value: string | undefined | null) {
  return value?.toLowerCase().replace(/[^a-z0-9]/g, "") ?? "";
}

function chooseFollowupCandidate(candidates: MockFollowup[], runtime: ReturnType<typeof createRuntime>, input: AgentInput) {
  const petQuery = normalize(input.petName);
  const clientQuery = normalize(input.clientName ?? input.callerName);
  if (!petQuery && !clientQuery) return candidates[0] ?? null;
  const matchesInput = (candidate: MockFollowup) => {
    const pet = runtime.data.pets.find((item) => item.id === candidate.petId);
    const client = runtime.data.clients.find((item) => item.id === candidate.clientId);
    const petOk = petQuery ? normalize(pet?.name).includes(petQuery) : true;
    const clientOk = clientQuery ? normalize(client?.fullName).includes(clientQuery) : true;
    return petOk && clientOk;
  };
  return candidates.find(matchesInput) ?? runtime.data.followups.find(matchesInput) ?? candidates[0] ?? null;
}

export async function runFollowupAgent(input: AgentInput | unknown, options: RunAgentOptions = {}): Promise<AgentWorkflowResult> {
  const normalized = normalizeAgentInput(input);
  const intent = "followup";
  const mode = resolveMode(options);
  const runtime = createRuntime(normalized, intent, options);
  const candidatesResult = await executeTool("find_followup_candidates", { status: "open" }, runtime) as FollowupCandidateResult;
  const candidate = chooseFollowupCandidate(candidatesResult.candidates, runtime, normalized);

  if (!candidate) {
    const report: AgentReportDraft = {
      id: "report-followup-empty",
      kind: "report",
      reportType: "followup",
      title: "Follow-up scan",
      summary: "No open follow-up candidates found.",
      data: { candidates: [] }
    };
    runtime.effects.push(report);
    return buildResult({
      intent,
      mode,
      message: "No pending follow-up candidates found.",
      result: { candidates: [] },
      runtime,
      options,
      report
    });
  }

  const taskResult = await executeTool("send_followup_outreach", { candidateId: candidate.id }, runtime) as FollowupTaskResult;
  const report: AgentReportDraft = {
    id: `report-followup-${candidate.id}`,
    kind: "report",
    reportType: "followup",
    title: "Follow-up candidate review",
    summary: `${taskResult.pet?.name ?? "A pet"} is due for ${candidate.followupType}.`,
    data: {
      candidate,
      client: taskResult.client,
      pet: taskResult.pet,
      outreach: taskResult.outreach ?? null
    },
    taskId: null
  };
  runtime.effects.push(report);
  return buildResult({
    intent,
    mode,
    message: taskResult.pet
      ? `I sent a mock follow-up portal message for ${taskResult.pet.name}.`
      : "I found a follow-up opportunity, but could not match the client and pet.",
    result: {
      candidate,
      client: taskResult.client,
      pet: taskResult.pet,
      outreach: taskResult.outreach ?? null,
      action: taskResult.outreach?.status === "sent" ? "followup_outreach_sent" : "followup_not_sent"
    },
    runtime,
    options,
    report
  });
}
