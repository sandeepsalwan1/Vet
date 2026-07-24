import { getSql } from "./connection";
import {
  clinicColumns,
  normalizeClinic,
  type ClinicRow
} from "./clinicRows";
import { resolveMappedClinicForHostname } from "./clinicRouting";

export type ClinicContext = {
  clinicId: string;
  slug: string;
  name: string;
  timeZone: string;
  hostname: string | null;
};

const defaultClinicSlug = "central-vet";

async function defaultClinic() {
  const slug = process.env.DEFAULT_CLINIC_SLUG || defaultClinicSlug;
  const sql = getSql();
  const rows = await sql<ClinicRow[]>`
    select ${sql.unsafe(clinicColumns)}
    from clinics
    where slug = ${slug}
    limit 1
  `;
  if (rows[0]) return normalizeClinic(rows[0]);

  const fallback = await sql<ClinicRow[]>`
    insert into clinics (slug, name, time_zone)
    values (
      ${slug},
      ${process.env.HOSPITAL_NAME || "Central Veterinary Hospital"},
      ${process.env.APP_TIME_ZONE || process.env.TZ || "America/Los_Angeles"}
    )
    on conflict (slug) do update set updated_at = now()
    returning ${sql.unsafe(clinicColumns)}
  `;
  return normalizeClinic(fallback[0]);
}

async function getDefaultClinicContext(): Promise<ClinicContext> {
  const clinic = await defaultClinic();
  return {
    clinicId: clinic.id,
    slug: clinic.slug,
    name: clinic.name,
    timeZone: clinic.timeZone,
    hostname: null
  };
}

export async function resolveClinicId(clinicId?: string | null) {
  if (clinicId) return clinicId;
  return (await getDefaultClinicContext()).clinicId;
}

export async function getClinicById(id: string) {
  const sql = getSql();
  const rows = await sql<ClinicRow[]>`
    select ${sql.unsafe(clinicColumns)}
    from clinics
    where id = ${id}
    limit 1
  `;
  return rows[0] ? normalizeClinic(rows[0]) : null;
}

export async function resolveClinicForHostname(host: string | null | undefined): Promise<ClinicContext> {
  const sql = getSql();
  return resolveMappedClinicForHostname(host, async (hostname) => {
    const domainRows = await sql<ClinicRow[]>`
      select clinic.id, clinic.slug, clinic.name, clinic.time_zone, clinic.status, clinic.created_at, clinic.updated_at
      from clinic_domains domain
      join clinics clinic on clinic.id = domain.clinic_id
      where domain.hostname = ${hostname}
        and clinic.status = 'active'
      limit 1
    `;
    return domainRows[0] ? normalizeClinic(domainRows[0]) : null;
  });
}
