import { dbError } from "../../_apiResponse";
import { requireManagerFromBody } from "../../_shared";
import { internalAgentGuard } from "../_internalAgentGuard";
import { executeEmailAgentWorkflow } from "./_emailWorkflow";

export async function agentEmailResponse(request: Request) {
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

    const response = await executeEmailAgentWorkflow({
      actor: auth.actor,
      body: auth.body,
      clinic: auth.clinic,
      request
    });
    if (response.ok) await auth.recordUsage();
    return response;
  } catch (error) {
    return dbError(error, { route: "agent.email" });
  }
}
