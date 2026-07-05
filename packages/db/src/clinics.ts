import { getSql } from "./connection";
import {
  clinicColumns,
  normalizeClinic,
  type ClinicRow
} from "./clinicRows";

export type ClinicContext = {
  clinicId: string;
  slug: string;
  name: string;
  timeZone: string;
  hostname: string | null;
};

const defaultClinicSlug = "central-vet";
const eepishSuffixes = [".vet.eepish.com", ".eepish.com"];

function cleanHostname(host: string | null | undefined) {
  const value = host?.split(",")[0]?.trim().toLowerCase() ?? "";
  return value.replace(/:\d+$/, "");
}

function slugFromKnownHost(hostname: string) {
  if (!hostname || hostname === "localhost" || hostname === "127.0.0.1") {
    return process.env.DEFAULT_CLINIC_SLUG || defaultClinicSlug;
  }
  for (const suffix of eepishSuffixes) {
    if (hostname.endsWith(suffix)) {
      const slug = hostname.slice(0, -suffix.length).split(".").pop();
      if (slug) return slug;
    }
  }
  return null;
}

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
  const hostname = cleanHostname(host);
  const sql = getSql();
  if (hostname) {
    const domainRows = await sql<ClinicRow[]>`
      select clinic.id, clinic.slug, clinic.name, clinic.time_zone, clinic.status, clinic.created_at, clinic.updated_at
      from clinic_domains domain
      join clinics clinic on clinic.id = domain.clinic_id
      where domain.hostname = ${hostname}
        and clinic.status = 'active'
      limit 1
    `;
    if (domainRows[0]) {
      const clinic = normalizeClinic(domainRows[0]);
      return {
        clinicId: clinic.id,
        slug: clinic.slug,
        name: clinic.name,
        timeZone: clinic.timeZone,
        hostname
      };
    }

    const slug = slugFromKnownHost(hostname);
    if (slug) {
      const slugRows = await sql<ClinicRow[]>`
        select ${sql.unsafe(clinicColumns)}
        from clinics
        where slug = ${slug}
          and status = 'active'
        limit 1
      `;
      if (slugRows[0]) {
        const clinic = normalizeClinic(slugRows[0]);
        return {
          clinicId: clinic.id,
          slug: clinic.slug,
          name: clinic.name,
          timeZone: clinic.timeZone,
          hostname
        };
      }
    }
  }
  return getDefaultClinicContext();
}
