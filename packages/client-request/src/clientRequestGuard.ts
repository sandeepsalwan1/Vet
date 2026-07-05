import { createHash } from "node:crypto";
import { getSql } from "@central-vet/db";

const hits = new Map<string, number[]>();
const maxPerHour = 5;
const rateWindowMs = 60 * 60 * 1000;
let lastRateLimitSweep = 0;

export function hashValue(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function contentHash(value: unknown) {
  return hashValue(JSON.stringify(value).toLowerCase().replace(/\s+/g, " ").trim());
}

export function clientKey(request: Request) {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "local";
  return `${ip}|${request.headers.get("user-agent") || "unknown"}`;
}

export function rateLimited(key: string, maxTrackedClients: number) {
  const now = Date.now();
  if (now - lastRateLimitSweep > 60_000 || hits.size >= maxTrackedClients) {
    lastRateLimitSweep = now;
    for (const [trackedKey, stamps] of hits) {
      const freshStamps = stamps.filter((stamp) => now - stamp < rateWindowMs);
      if (freshStamps.length) hits.set(trackedKey, freshStamps);
      else hits.delete(trackedKey);
    }
    while (hits.size >= maxTrackedClients) {
      const oldestKey = hits.keys().next().value;
      if (!oldestKey) break;
      hits.delete(oldestKey);
    }
  }

  const fresh = (hits.get(key) ?? []).filter((stamp) => now - stamp < rateWindowMs);
  if (fresh.length >= maxPerHour) {
    hits.set(key, fresh);
    return true;
  }
  fresh.push(now);
  hits.set(key, fresh);
  return false;
}

export async function persistentGuard(
  clinicId: string,
  clientHash: string,
  requestHash: string
) {
  const sql = getSql();
  const rows = await sql<{ client_count: number; duplicate_count: number }[]>`
    select
      (
        select count(*)::int
        from request_guard_events
        where clinic_id = ${clinicId}
          and client_key_hash = ${clientHash}
          and created_at > now() - interval '1 hour'
      ) as client_count,
      (
        select count(*)::int
        from request_guard_events
        where clinic_id = ${clinicId}
          and content_hash = ${requestHash}
          and status = 'accepted'
          and created_at > now() - interval '24 hours'
      ) as duplicate_count
  `;
  const row = rows[0];
  return {
    rateLimited: (row?.client_count ?? 0) >= maxPerHour,
    duplicate: (row?.duplicate_count ?? 0) > 0
  };
}

export async function recordGuard(
  clinicId: string,
  clientHash: string,
  requestHash: string,
  status: string
) {
  const sql = getSql();
  await sql`
    insert into request_guard_events (clinic_id, client_key_hash, content_hash, status)
    values (${clinicId}, ${clientHash}, ${requestHash}, ${status})
  `;
}
