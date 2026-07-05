import nextEnv from "@next/env";
import fs from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";

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
  for (const file of files) {
    const source = await fs.readFile(path.join(migrationsDir, file), "utf8");
    console.log(`running ${file}`);
    await sql.unsafe(source);
  }
  console.log("migrations complete");
} finally {
  await sql.end();
}
