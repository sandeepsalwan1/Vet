import { getClientJourneySettings } from "@central-vet/db";
import { NextResponse } from "next/server";
import { dbError, noStoreHeaders } from "../_apiResponse";
import { resolveClinicFromRequest } from "../_shared";

export async function clinicResponse(request: Request) {
  try {
    const clinic = await resolveClinicFromRequest(request);
    const journey = await getClientJourneySettings({ clinicId: clinic.clinicId });
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
