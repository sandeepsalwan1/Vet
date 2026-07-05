import { handleClientRequest } from "@central-vet/client-request";
import { NextResponse } from "next/server";
import { resolveClinicFromRequest } from "../_shared";

export async function POST(request: Request) {
  const clinic = await resolveClinicFromRequest(request);
  const result = await handleClientRequest(request, {
    clinicId: clinic.clinicId,
    hospitalName: clinic.name,
    maxTrackedClients: 2000
  });
  return NextResponse.json(result.body, { status: result.status });
}
