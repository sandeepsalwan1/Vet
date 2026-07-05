import { z } from "zod";
import {
  defineTool,
  recordEvent,
  type ToolRuntime
} from "../toolCore";

function followupCandidates(runtime: ToolRuntime, status = "open") {
  return runtime.data.followups.filter((followup) => followup.status === status);
}

async function sendFollowupOutreach(candidateId: string, runtime: ToolRuntime) {
  const result = await runtime.adapters.messaging.sendFollowupOutreach(candidateId);
  const { candidate, client, pet, outreach } = result;
  if (!candidate || !client || !pet || !outreach) return result;
  recordEvent(runtime, {
    eventType: "followup_outreach_sent",
    title: "Follow-up outreach sent",
    detail: candidate.recommendedAction,
    metadata: {
      candidateId: candidate.id,
      clientId: client.id,
      petId: pet.id,
      channel: outreach.channel,
      action: "followup_outreach_sent"
    }
  });
  return result;
}

export const followupTools = {
  find_followup_candidates: defineTool({
    description: "Find open follow-up opportunities.",
    parameters: z.object({
      status: z.enum(["open", "contacted", "closed"]).optional()
    }),
    execute: async (args, runtime) => {
      const status = args.status ?? "open";
      const candidates = followupCandidates(runtime, status);
      return { candidates };
    }
  }),
  send_followup_outreach: defineTool({
    description: "Send a mock follow-up outreach message for a due reminder candidate.",
    parameters: z.object({
      candidateId: z.string()
    }),
    execute: async (args, runtime) => sendFollowupOutreach(args.candidateId, runtime)
  })
};
