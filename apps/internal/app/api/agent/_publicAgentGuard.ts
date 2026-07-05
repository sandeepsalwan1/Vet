import { createHash } from "node:crypto";
import { getSql } from "@central-vet/db";
import { NextResponse } from "next/server";
import { z } from "zod";

const publicAgentMaxPerHour = 12;
const publicAgentMaxTrackedClients = 2000;
const publicAgentWindowMs = 60 * 60 * 1000;
const publicAgentHits = new Map<string, number[]>();
let lastPublicAgentSweep = 0;

const publicAgentSchema = z.object({
  intent: z.string().trim().max(80).optional(),
  clientName: z.string().trim().max(120).optional(),
  name: z.string().trim().max(120).optional(),
  clientPhone: z.string().trim().max(80).optional(),
  phone: z.string().trim().max(80).optional(),
  callerName: z.string().trim().max(120).optional(),
  callerPhone: z.string().trim().max(80).optional(),
  petName: z.string().trim().max(120).optional(),
  appointmentType: z.string().trim().max(120).optional(),
  requestType: z.string().trim().max(120).optional(),
  destination: z.string().trim().max(200).optional(),
  message: z.string().trim().max(4000).optional(),
  request: z.string().trim().max(4000).optional(),
  transcript: z.string().trim().max(4000).optional(),
  body: z.string().trim().max(4000).optional()
}).passthrough();

function hashValue(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function contentHash(route: string, value: unknown) {
  return hashValue(`${route}:${JSON.stringify(value).toLowerCase().replace(/\s+/g, " ").trim()}`);
}

function textValue(body: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = body[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function phoneDigits(body: Record<string, unknown>) {
  return textValue(body, ["clientPhone", "phone", "callerPhone"]).replace(/\D/g, "");
}

function publicAgentValidationError(body: Record<string, unknown>) {
  const clientName = textValue(body, ["clientName", "name", "callerName"]);
  const petName = textValue(body, ["petName"]);
  const requestText = textValue(body, ["message", "request", "transcript", "body"]);
  if (clientName.length < 2) return "Enter your name.";
  if (phoneDigits(body).length < 7) return "Enter a real phone number.";
  if (petName.length < 2) return "Enter your pet's name.";
  if (requestText.length < 8) return "Describe the request.";
  return null;
}

function publicClientKey(request: Request, route: string) {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "local";
  return hashValue([
    "public-agent",
    route,
    ip,
    request.headers.get("user-agent") || "unknown"
  ].join("|"));
}

function memoryRateLimited(key: string) {
  const now = Date.now();
  if (now - lastPublicAgentSweep > 60_000) {
    lastPublicAgentSweep = now;
    for (const [trackedKey, stamps] of publicAgentHits) {
      const fresh = stamps.filter((stamp) => now - stamp < publicAgentWindowMs);
      if (fresh.length) publicAgentHits.set(trackedKey, fresh);
      else publicAgentHits.delete(trackedKey);
    }
  }
  const fresh = (publicAgentHits.get(key) ?? []).filter((stamp) => now - stamp < publicAgentWindowMs);
  if (fresh.length >= publicAgentMaxPerHour) {
    publicAgentHits.set(key, fresh);
    return true;
  }
  if (!publicAgentHits.has(key) && publicAgentHits.size >= publicAgentMaxTrackedClients) {
    const oldestKey = publicAgentHits.keys().next().value;
    if (oldestKey) publicAgentHits.delete(oldestKey);
  }
  fresh.push(now);
  publicAgentHits.set(key, fresh);
  return false;
}

async function publicAgentGuard(
  request: Request,
  body: Record<string, unknown>,
  route: string,
  clinicId: string
) {
  const clientHash = publicClientKey(request, route);
  const requestHash = contentHash(route, body);
  if (memoryRateLimited(clientHash)) {
    return NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429 });
  }

  const sql = getSql();
  const rows = await sql<{ client_count: number; duplicate_count: number }[]>`
    select
      (
        select count(*)::int
        from request_guard_events
        where clinic_id = ${clinicId}
          and client_key_hash = ${clientHash}
          and status = 'public_agent_started'
          and created_at > now() - interval '1 hour'
      ) as client_count,
      (
        select count(*)::int
        from request_guard_events
        where clinic_id = ${clinicId}
          and content_hash = ${requestHash}
          and status = 'public_agent_started'
          and created_at > now() - interval '5 minutes'
      ) as duplicate_count
  `;
  const row = rows[0];
  if ((row?.client_count ?? 0) >= publicAgentMaxPerHour || (row?.duplicate_count ?? 0) > 0) {
    await sql`
      insert into request_guard_events (clinic_id, client_key_hash, content_hash, status)
      values (
        ${clinicId},
        ${clientHash},
        ${requestHash},
        ${(row?.duplicate_count ?? 0) > 0 ? "public_agent_duplicate" : "public_agent_rate_limited"}
      )
    `;
    return NextResponse.json(
      { error: (row?.duplicate_count ?? 0) > 0 ? "This request was already submitted." : "Too many requests. Please try again later." },
      { status: 429 }
    );
  }

  await sql`
    insert into request_guard_events (clinic_id, client_key_hash, content_hash, status)
    values (${clinicId}, ${clientHash}, ${requestHash}, 'public_agent_started')
  `;
  return null;
}

export async function readPublicAgentBody(request: Request, route: string, clinicId: string) {
  const body = await request.json().catch(() => null);
  const parsed = publicAgentSchema.safeParse(body);
  if (!parsed.success) {
    return {
      response: NextResponse.json({ error: "Invalid agent request." }, { status: 400 })
    };
  }
  const validationError = publicAgentValidationError(parsed.data);
  if (validationError) {
    return {
      response: NextResponse.json({ error: validationError }, { status: 400 })
    };
  }
  const response = await publicAgentGuard(request, parsed.data, route, clinicId);
  if (response) return { response };
  return { body: parsed.data };
}
