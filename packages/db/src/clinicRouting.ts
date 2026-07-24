export type HostnameClinic = {
  id: string;
  slug: string;
  name: string;
  timeZone: string;
};

export class UnknownClinicHostnameError extends Error {
  readonly hostname: string;

  constructor(hostname: string) {
    super("Clinic is not configured for this domain.");
    this.name = "UnknownClinicHostnameError";
    this.hostname = hostname;
  }
}

export function normalizeClinicHostname(host: string | null | undefined) {
  const value = host?.split(",")[0]?.trim().toLowerCase() ?? "";
  return value.replace(/:\d+$/, "");
}

export async function resolveMappedClinicForHostname(
  host: string | null | undefined,
  findClinic: (hostname: string) => Promise<HostnameClinic | null>
) {
  const hostname = normalizeClinicHostname(host);
  const clinic = hostname ? await findClinic(hostname) : null;
  if (!clinic) throw new UnknownClinicHostnameError(hostname);
  return {
    clinicId: clinic.id,
    slug: clinic.slug,
    name: clinic.name,
    timeZone: clinic.timeZone,
    hostname
  };
}
