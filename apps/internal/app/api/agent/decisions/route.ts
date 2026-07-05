import { dbError } from "../../_apiResponse";
import { agentDecisionListResponse } from "../_auditRequest";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    return await agentDecisionListResponse(request);
  } catch (error) {
    return dbError(error, { route: "agent.decisions" });
  }
}
