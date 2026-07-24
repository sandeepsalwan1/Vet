export type ClinicBrand = {
  clinicId: string | null;
  slug: string;
  name: string;
  timeZone: string;
};

export const defaultClinicBrand: ClinicBrand = {
  clinicId: null,
  slug: "central-vet",
  name: "Central Veterinary Hospital",
  timeZone: "America/Los_Angeles"
};

type ClinicBrandResponse = {
  clinic?: Partial<ClinicBrand>;
};

export async function readClinicBrand(): Promise<ClinicBrand> {
  const response = await fetch("/api/clinic", { cache: "no-store" });
  if (!response.ok) throw new Error("Clinic is unavailable.");
  const data = await response.json() as ClinicBrandResponse;
  const clinic = data.clinic;
  if (!clinic?.clinicId || !clinic.name) throw new Error("Clinic is unavailable.");
  return {
    clinicId: clinic.clinicId,
    slug: clinic.slug ?? defaultClinicBrand.slug,
    name: clinic.name,
    timeZone: clinic.timeZone ?? defaultClinicBrand.timeZone
  };
}
