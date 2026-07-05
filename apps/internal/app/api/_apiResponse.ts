import { MissingDatabaseUrlError } from "@central-vet/db";
import { NextResponse } from "next/server";

export const noStoreHeaders = {
  "Cache-Control": "no-store, max-age=0, must-revalidate"
};

type LogValue = string | number | boolean | null | undefined;
type LogFields = Record<string, LogValue>;

function logPayload(event: string, fields: LogFields = {}) {
  return {
    event,
    at: new Date().toISOString(),
    ...fields
  };
}

export function logInfo(event: string, fields?: LogFields) {
  console.info(logPayload(event, fields));
}

export function logWarn(event: string, fields?: LogFields) {
  console.warn(logPayload(event, fields));
}

export function logError(event: string, error: unknown, fields?: LogFields) {
  const message = error instanceof Error ? error.message : "Unknown error";
  console.error(logPayload(event, { ...fields, error: message }));
}

export function dbError(error: unknown, fields?: LogFields) {
  if (error instanceof MissingDatabaseUrlError) {
    logWarn("database_missing_url", fields);
    return NextResponse.json(
      {
        error: "Database not configured.",
        detail: "Set Supabase DATABASE_URL, then run npm run db:migrate."
      },
      { status: 503 }
    );
  }

  logError("server_error", error, fields);
  return NextResponse.json({ error: "Server error." }, { status: 500 });
}
