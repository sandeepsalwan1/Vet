import { withDbError } from "../../_apiResponse";
import { approvalDecisionResponse } from "../_approvalRequest";

export const dynamic = "force-dynamic";

export const PATCH = withDbError(
  "approvals.decide",
  async (
    request: Request,
    context: { params: Promise<{ id: string }> }
  ) => {
    const { id } = await context.params;
    return approvalDecisionResponse({ request, id });
  }
);
