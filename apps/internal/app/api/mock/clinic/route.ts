import { NextResponse } from "next/server";
import { noStoreHeaders, withDbError } from "../../_apiResponse";
import { mockClinicPayload, resetMockClinicPayload } from "./_mockClinicRequest";

export const dynamic = "force-dynamic";

export const GET = withDbError(
  "mock.clinic",
  async (request: Request) => {
    const payload = await mockClinicPayload(request);
    if ("response" in payload) return payload.response;
    return NextResponse.json(
      { ok: true, clinic: payload.clinic },
      { headers: noStoreHeaders }
    );
  }
);

export const POST = withDbError(
  "mock.clinic.reset",
  async (request: Request) => {
    const payload = await resetMockClinicPayload(request);
    if ("response" in payload) return payload.response;
    return NextResponse.json(
      { ok: true, reset: payload.reset },
      { headers: noStoreHeaders }
    );
  }
);
