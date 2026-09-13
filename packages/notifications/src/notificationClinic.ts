import { getClinicById } from "@central-vet/db";

const defaultClinicName = "Veterinary Hospital";

export async function clinicNameFor(
  clinicId: string | null | undefined
) {
  if (!clinicId) {
    return process.env.HOSPITAL_NAME || defaultClinicName;
  }
  const clinic = await getClinicById(clinicId);
  return clinic?.name || process.env.HOSPITAL_NAME || defaultClinicName;
}
