import { withDbError } from "../../_apiResponse";
import { agentDecisionListResponse } from "../_auditRequest";

export const dynamic = "force-dynamic";

export const GET = withDbError(
  "agent.decisions",
  agentDecisionListResponse
);
