import { NextResponse } from "next/server";
import { dbError, noStoreHeaders } from "../../_apiResponse";
import { mockClinicPayload, resetMockClinicPayload } from "./_mockClinicRequest";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const payload = await mockClinicPayload(request);
    if ("response" in payload) return payload.response;
    return NextResponse.json({ ok: true, clinic: payload.clinic }, { headers: noStoreHeaders });
  } catch (error) {
    return dbError(error, { route: "mock.clinic" });
  }
}

export async function POST(request: Request) {
  try {
    const payload = await resetMockClinicPayload(request);
    if ("response" in payload) return payload.response;
    return NextResponse.json({ ok: true, reset: payload.reset }, { headers: noStoreHeaders });
  } catch (error) {
    return dbError(error, { route: "mock.clinic.reset" });
  }
}
