import nextEnv from "@next/env";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";
import { planMigrations } from "./migrationPlan.mjs";

const root = path.resolve(import.meta.dirname, "../../..");
const { loadEnvConfig } = nextEnv;
loadEnvConfig(root);
loadEnvConfig(path.join(root, "apps", "internal"));

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("Supabase DATABASE_URL is required.");
  process.exit(1);
}

const ssl =
  databaseUrl.includes("localhost") ||
  databaseUrl.includes("127.0.0.1") ||
  databaseUrl.includes("sslmode=disable")
    ? false
    : "require";

const sql = postgres(databaseUrl, { ssl, max: 1, prepare: false });
const migrationsDir = path.join(root, "db", "migrations");
const files = (await fs.readdir(migrationsDir))
  .filter((file) => file.endsWith(".sql"))
  .sort();

try {
  await sql`
    create table if not exists app_schema_migrations (
      filename text primary key,
      checksum text not null,
      applied_at timestamptz not null default now()
    )
  `;

  const appliedRows = await sql`
    select filename, checksum
    from app_schema_migrations
    order by filename
  `;
  const [{ tenantTablesExist }] = await sql`
    select
      to_regclass('public.clinics') is not null
      and to_regclass('public.clinic_domains') is not null
      as "tenantTablesExist"
  `;
  let legacyBaselineComplete = false;

  if (tenantTablesExist) {
    const [baselineState] = await sql`
      select
        exists (
          select 1
          from clinics clinic
          join clinic_domains domain on domain.clinic_id = clinic.id
          where clinic.slug = 'central-vet'
            and domain.hostname = 'centralvet.eepish.com'
        )
        and exists (
          select 1
          from clinics clinic
          join clinic_domains domain on domain.clinic_id = clinic.id
          where clinic.slug = 'tri-city-vet'
            and domain.hostname = 'tricityvet.eepish.com'
        )
        as "legacyBaselineComplete"
    `;
    legacyBaselineComplete = baselineState.legacyBaselineComplete;
  }

  const sources = new Map(
    await Promise.all(
      files.map(async (file) => [
        file,
        await fs.readFile(path.join(migrationsDir, file), "utf8")
      ])
    )
  );
  const checksums = new Map(
    [...sources].map(([file, source]) => [
      file,
      createHash("sha256").update(source).digest("hex")
    ])
  );
  const appliedChecksums = new Map(
    appliedRows.map((row) => [row.filename, row.checksum])
  );
  const { baseline, pending } = planMigrations({
    files,
    appliedFiles: [...appliedChecksums.keys()],
    legacyBaselineComplete
  });

  for (const file of baseline) {
    await sql`
      insert into app_schema_migrations (filename, checksum)
      values (${file}, ${checksums.get(file)})
    `;
  }
  if (baseline.length > 0) {
    console.log(`baselined ${baseline.length} existing migrations`);
  }

  for (const file of files) {
    const appliedChecksum = appliedChecksums.get(file);
    if (appliedChecksum && appliedChecksum !== checksums.get(file)) {
      throw new Error(`Applied migration changed: ${file}`);
    }
  }

  for (const file of pending) {
    const source = sources.get(file);
    console.log(`running ${file}`);
    await sql.begin(async (transaction) => {
      await transaction.unsafe(source);
      await transaction`
        insert into app_schema_migrations (filename, checksum)
        values (${file}, ${checksums.get(file)})
      `;
    });
  }
  console.log("migrations complete");
} finally {
  await sql.end();
}
