import { NextResponse } from "next/server";
import { dbError } from "../_apiResponse";
import { requireManagerFromBody, resolveClinicFromRequest } from "../_shared";
import { internalAgentGuard } from "./_internalAgentGuard";
import { readPublicAgentBody } from "./_publicAgentGuard";
import { executeVetAgentWorkflow } from "./_runner";
import { getAgentWorkflowRoute } from "./_workflowRoutes";

export async function agentWorkflowResponse(input: {
  request: Request;
  workflow: string;
}) {
  const route = getAgentWorkflowRoute(input.workflow);
  if (!route) {
    return NextResponse.json({ error: "Agent workflow not found." }, { status: 404 });
  }

  try {
    const clinic = await resolveClinicFromRequest(input.request);
    if (route.auth === "manager") {
      const auth = await requireManagerFromBody(input.request);
      if ("response" in auth) return auth.response;
      const guard = await internalAgentGuard({
        clinicId: clinic.clinicId,
        request: input.request,
        actor: auth.actor,
        route: route.routeIntent,
        body: auth.body
      });
      if (guard) return guard;
      const response = await executeVetAgentWorkflow({
        agent: route.agent,
        routeIntent: route.routeIntent,
        input: auth.body,
        actor: auth.actor,
        clinic,
        request: input.request
      });
      if (response.ok) await auth.recordUsage();
      return response;
    }

    const parsed = await readPublicAgentBody(
      input.request,
      route.routeIntent,
      clinic.clinicId
    );
    if ("response" in parsed) return parsed.response;
    return executeVetAgentWorkflow({
      agent: route.agent,
      routeIntent: route.routeIntent,
      input: parsed.body,
      clinic,
      request: input.request
    });
  } catch (error) {
    return dbError(error, { route: `agent.${route.routeIntent}` });
  }
}
