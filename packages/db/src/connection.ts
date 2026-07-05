import postgres from "postgres";

export class MissingDatabaseUrlError extends Error {
  constructor() {
    super("Supabase DATABASE_URL is required.");
    this.name = "MissingDatabaseUrlError";
  }
}

let cachedSql: postgres.Sql | null = null;

function databaseUrl() {
  return process.env.DATABASE_URL || "";
}

function shouldUseSsl(url: string) {
  if (url.includes("sslmode=disable")) return false;
  return !url.includes("localhost") && !url.includes("127.0.0.1");
}

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function getSql() {
  const url = databaseUrl();
  if (!url) throw new MissingDatabaseUrlError();
  if (!cachedSql) {
    cachedSql = postgres(url, {
      max: positiveInteger(process.env.DATABASE_MAX_CONNECTIONS, 5),
      ssl: shouldUseSsl(url) ? "require" : false,
      prepare: false,
      idle_timeout: positiveInteger(process.env.DATABASE_IDLE_TIMEOUT_SECONDS, 20),
      connect_timeout: positiveInteger(process.env.DATABASE_CONNECT_TIMEOUT_SECONDS, 10),
      max_lifetime: positiveInteger(process.env.DATABASE_MAX_LIFETIME_SECONDS, 60 * 10)
    });
  }
  return cachedSql;
}
