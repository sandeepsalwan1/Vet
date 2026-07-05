import { dbError } from "../../_apiResponse";
import { approvalDecisionResponse } from "../_approvalRequest";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    return await approvalDecisionResponse({ request, id });
  } catch (error) {
    return dbError(error, { route: "approvals.decide" });
  }
}
