import { NextResponse } from "next/server";
import { dbError, noStoreHeaders } from "../_apiResponse";
import { eventListPayload } from "./_eventRequest";

export async function GET(request: Request) {
  try {
    const result = await eventListPayload(request);
    if ("response" in result) return result.response;
    return NextResponse.json(result, { headers: noStoreHeaders });
  } catch (error) {
    return dbError(error, { route: "events.list" });
  }
}
