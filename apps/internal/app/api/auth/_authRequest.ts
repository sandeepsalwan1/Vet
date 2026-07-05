import { NextResponse } from "next/server";
import { logWarn, noStoreHeaders } from "../_apiResponse";
import {
  actorSchema,
  authenticateActor,
  resolveClinicFromRequest
} from "../_shared";

export async function authValidationResponse(request: Request) {
  const body = await request.json();
  const parsed = actorSchema.safeParse(body.actor);
  if (!parsed.success) {
    logWarn("auth_rejected", { reason: "invalid_payload" });
    return NextResponse.json({ error: "Invalid role or passcode." }, { status: 403 });
  }

  const clinic = await resolveClinicFromRequest(request);
  const auth = await authenticateActor(parsed.data, request, clinic);
  if ("response" in auth) {
    logWarn("auth_rejected", { reason: "invalid_passcode", actorRole: parsed.data.role });
    return auth.response;
  }

  return NextResponse.json({ actor: auth.actor, clinic }, { headers: noStoreHeaders });
}
