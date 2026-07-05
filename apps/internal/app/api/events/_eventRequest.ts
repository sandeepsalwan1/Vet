import { listTaskEvents } from "@central-vet/db";
import { NextResponse } from "next/server";
import { canManage } from "../../lib/taskWorkflow";
import { logWarn } from "../_apiResponse";
import {
  authenticateActorFromQuery,
  resolveClinicFromRequest
} from "../_shared";

export async function eventListPayload(request: Request) {
  const url = new URL(request.url);
  const clinic = await resolveClinicFromRequest(request);
  const auth = await authenticateActorFromQuery(url, request, clinic);
  if ("response" in auth) {
    logWarn("events_read_rejected", { reason: "unauthorized" });
    return { response: auth.response };
  }
  if (!canManage(auth.actor.role)) {
    logWarn("events_read_rejected", { reason: "unauthorized" });
    return {
      response: NextResponse.json({ error: "Audit log requires VA, Veterinarian, or Admin." }, { status: 403 })
    };
  }

  return {
    events: await listTaskEvents(80, { clinicId: clinic.clinicId })
  };
}
