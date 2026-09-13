import { agentWorkflowResponse } from "../_agentRequest";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ workflow: string }> }
) {
  const { workflow } = await context.params;
  return agentWorkflowResponse({ request, workflow });
}
