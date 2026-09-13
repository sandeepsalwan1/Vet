import { getClientJourneySettings } from "@central-vet/db";
import { NextResponse } from "next/server";
import { dbError, noStoreHeaders } from "../_apiResponse";
import { resolveClinicFromRequest } from "../_shared";
import { agentProofFixturesEnabled } from "../_agentProofFixtures";

export async function clinicResponse(request: Request) {
  try {
    const clinic = await resolveClinicFromRequest(request);
    const journey = agentProofFixturesEnabled(request)
      ? { publicName: clinic.name }
      : await getClientJourneySettings({ clinicId: clinic.clinicId });
    return NextResponse.json({
      clinic: {
        ...clinic,
        name: journey.publicName
      }
    }, { headers: noStoreHeaders });
  } catch (error) {
    return dbError(error, { route: "clinic.resolve" });
  }
}
