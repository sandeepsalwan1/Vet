import { z } from "zod";
import { defineTool, triageText } from "../toolCore";

export const safetyTools = {
  triage_message: defineTool({
    description: "Classify client message urgency and intent.",
    parameters: z.object({
      message: z.string()
    }),
    execute: async (args) => triageText(args.message)
  }),
  triage_call: defineTool({
    description: "Classify a phone transcript.",
    parameters: z.object({
      transcript: z.string()
    }),
    execute: async (args) => triageText(args.transcript)
  })
};
