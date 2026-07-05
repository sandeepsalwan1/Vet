import { dbError } from "../../_apiResponse";
import { requireManagerFromBody } from "../../_shared";
import { internalAgentGuard } from "../_internalAgentGuard";
import { executeEmailAgentWorkflow } from "./_emailWorkflow";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const auth = await requireManagerFromBody(request);
    if ("response" in auth) return auth.response;

    const guard = await internalAgentGuard({
      clinicId: auth.clinic.clinicId,
      request,
      actor: auth.actor,
      route: "email",
      body: auth.body
    });
    if (guard) return guard;

    return executeEmailAgentWorkflow({
      actor: auth.actor,
      body: auth.body,
      clinic: auth.clinic,
      request
    });
  } catch (error) {
    return dbError(error, { route: "agent.email" });
  }
}
