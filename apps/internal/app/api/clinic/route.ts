import { NextResponse } from "next/server";
import { dbError, noStoreHeaders } from "../_apiResponse";
import { resolveClinicFromRequest } from "../_shared";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const clinic = await resolveClinicFromRequest(request);
    return NextResponse.json({ clinic }, { headers: noStoreHeaders });
  } catch (error) {
    return dbError(error, { route: "clinic.resolve" });
  }
}
