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
  const data = await fetch("/api/clinic", { cache: "no-store" })
    .then((response) => response.json() as Promise<ClinicBrandResponse>)
    .catch((): ClinicBrandResponse => ({}));
  const clinic = data.clinic;
  if (!clinic?.clinicId || !clinic.name) return defaultClinicBrand;
  return {
    clinicId: clinic.clinicId,
    slug: clinic.slug ?? defaultClinicBrand.slug,
    name: clinic.name,
    timeZone: clinic.timeZone ?? defaultClinicBrand.timeZone
  };
}
