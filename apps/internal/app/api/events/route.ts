import { NextResponse } from "next/server";
import { noStoreHeaders, withDbError } from "../_apiResponse";
import { eventListPayload } from "./_eventRequest";

export const GET = withDbError(
  "events.list",
  async (request: Request) => {
    const result = await eventListPayload(request);
    if ("response" in result) return result.response;
    return NextResponse.json(result, { headers: noStoreHeaders });
  }
);
