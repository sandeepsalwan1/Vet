import { getClientAnalytics, type AnalyticsRangeDays } from "@central-vet/db";
import { NextResponse } from "next/server";
import { z } from "zod";
import { dbError, noStoreHeaders } from "../_apiResponse";
import {
  authenticateActorFromQuery,
  resolveClinicFromRequest
} from "../_shared";

export const dynamic = "force-dynamic";

const rangeSchema = z.coerce.number().pipe(z.union([
  z.literal(30),
  z.literal(90),
  z.literal(365)
]));

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const clinic = await resolveClinicFromRequest(request);
    const auth = await authenticateActorFromQuery(url, request, clinic);
    if ("response" in auth) return auth.response;
    if (auth.actor.role !== "admin") {
      return NextResponse.json({ error: "Admin access required." }, { status: 403 });
    }
    const range = rangeSchema.safeParse(url.searchParams.get("days") ?? "30");
    if (!range.success) {
      return NextResponse.json({ error: "Choose a 30, 90, or 365 day range." }, { status: 400 });
    }
    return NextResponse.json(
      await getClientAnalytics({
        clinicId: clinic.clinicId,
        rangeDays: range.data as AnalyticsRangeDays
      }),
      { headers: noStoreHeaders }
    );
  } catch (error) {
    return dbError(error, { route: "analytics.get" });
  }
}
