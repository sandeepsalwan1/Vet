import { NextResponse } from "next/server";
import { dbError } from "../../_apiResponse";
import { requireManagerFromBody, resolveClinicFromRequest } from "../../_shared";
import { internalAgentGuard } from "../_internalAgentGuard";
import { readPublicAgentBody } from "../_publicAgentGuard";
import { executeVetAgentWorkflow } from "../_runner";
import { getAgentWorkflowRoute } from "../_workflowRoutes";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ workflow: string }> }
) {
  const { workflow } = await context.params;
  const route = getAgentWorkflowRoute(workflow);
  if (!route) return NextResponse.json({ error: "Agent workflow not found." }, { status: 404 });

  try {
    const clinic = await resolveClinicFromRequest(request);
    if (route.auth === "manager") {
      const auth = await requireManagerFromBody(request);
      if ("response" in auth) return auth.response;
      const guard = await internalAgentGuard({
        clinicId: clinic.clinicId,
        request,
        actor: auth.actor,
        route: route.routeIntent,
        body: auth.body
      });
      if (guard) return guard;
      return executeVetAgentWorkflow({
        agent: route.agent,
        routeIntent: route.routeIntent,
        input: auth.body,
        actor: auth.actor,
        clinic,
        request
      });
    }

    const parsed = await readPublicAgentBody(request, route.routeIntent, clinic.clinicId);
    if ("response" in parsed) return parsed.response;
    return executeVetAgentWorkflow({
      agent: route.agent,
      routeIntent: route.routeIntent,
      input: parsed.body,
      clinic,
      request
    });
  } catch (error) {
    return dbError(error, { route: `agent.${route.routeIntent}` });
  }
}
