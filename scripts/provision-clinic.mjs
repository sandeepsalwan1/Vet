#!/usr/bin/env node
import nextEnv from "@next/env";
import path from "node:path";
import postgres from "postgres";

const root = path.resolve(import.meta.dirname, "..");
const { loadEnvConfig } = nextEnv;
loadEnvConfig(root);
loadEnvConfig(path.join(root, "apps", "internal"));

function valuesFor(flag) {
  const values = [];
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === flag && args[index + 1]) {
      values.push(args[index + 1]);
      index += 1;
    }
  }
  return values;
}

function valueFor(flag) {
  return valuesFor(flag)[0] ?? null;
}

function usage() {
  console.error("Usage: npm run clinic:provision -- --slug <slug> --name <clinic name> [--host <host>] [--time-zone <tz>]");
  process.exit(1);
}

const slug = valueFor("--slug")?.trim().toLowerCase();
const name = valueFor("--name")?.trim();
const timeZone = valueFor("--time-zone")?.trim() || "America/Los_Angeles";
const status = valueFor("--status")?.trim() || "active";
const hosts = valuesFor("--host").map((host) => host.trim().toLowerCase()).filter(Boolean);

if (!slug || !name || !/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(slug)) {
  usage();
}
if (status !== "active" && status !== "disabled") {
  usage();
}

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
const domains = hosts.length > 0 ? hosts : [`${slug}.vet.eepish.com`];

try {
  const [clinic] = await sql`
    insert into clinics (slug, name, time_zone, status)
    values (${slug}, ${name}, ${timeZone}, ${status})
    on conflict (slug) do update
    set name = excluded.name,
        time_zone = excluded.time_zone,
        status = excluded.status,
        updated_at = now()
    returning id, slug, name, time_zone, status
  `;

  for (const [index, hostname] of domains.entries()) {
    await sql`
      insert into clinic_domains (clinic_id, hostname, is_primary)
      values (${clinic.id}, ${hostname}, ${index === 0})
      on conflict (hostname) do update
      set clinic_id = excluded.clinic_id,
          is_primary = excluded.is_primary,
          updated_at = now()
    `;
  }

  console.log(`clinic: ${clinic.slug}`);
  console.log(`id: ${clinic.id}`);
  console.log(`name: ${clinic.name}`);
  console.log(`timeZone: ${clinic.time_zone}`);
  console.log(`status: ${clinic.status}`);
  console.log(`domains: ${domains.join(", ")}`);
} finally {
  await sql.end();
}
