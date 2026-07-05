import { listMockClinic, resetMockClinicState } from "@central-vet/db";
import { requireManagerFromQuery } from "../../_shared";

export async function mockClinicPayload(request: Request) {
  const auth = await requireManagerFromQuery(request);
  if ("response" in auth) return { response: auth.response };
  return {
    clinic: await listMockClinic({ clinicId: auth.clinic.clinicId })
  };
}

export async function resetMockClinicPayload(request: Request) {
  const auth = await requireManagerFromQuery(request);
  if ("response" in auth) return { response: auth.response };
  return {
    reset: await resetMockClinicState({ clinicId: auth.clinic.clinicId })
  };
}
