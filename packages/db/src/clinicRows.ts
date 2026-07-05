export type Clinic = {
  id: string;
  slug: string;
  name: string;
  timeZone: string;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export type ClinicRow = {
  id: string;
  slug: string;
  name: string;
  time_zone: string;
  status: string;
  created_at: string;
  updated_at: string;
};

export const clinicColumns = `
  id,
  slug,
  name,
  time_zone,
  status,
  created_at,
  updated_at
`;

export function normalizeClinic(row: ClinicRow): Clinic {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    timeZone: row.time_zone,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
