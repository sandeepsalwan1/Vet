import { dbError } from "../../../_apiResponse";
import { agentRunTimelineResponse } from "../../_auditRequest";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    return await agentRunTimelineResponse({ request, id });
  } catch (error) {
    return dbError(error, { route: "agent.runs.get" });
  }
}
