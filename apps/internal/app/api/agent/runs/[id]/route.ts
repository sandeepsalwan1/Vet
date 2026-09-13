import { withDbError } from "../../../_apiResponse";
import { agentRunTimelineResponse } from "../../_auditRequest";

export const dynamic = "force-dynamic";

export const GET = withDbError(
  "agent.runs.get",
  async (
    request: Request,
    context: { params: Promise<{ id: string }> }
  ) => {
    const { id } = await context.params;
    return agentRunTimelineResponse({ request, id });
  }
);
