import { createHash } from "node:crypto";
import { getSql, type Actor } from "@central-vet/db";
import { NextResponse } from "next/server";

const maxPerHourByRole: Record<string, number> = {
  admin: 80,
  veterinarian: 80,
  va: 50,
  task_adder: 30,
  staff: 20
};

function hashValue(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function requestIp(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "local";
}

function redactForHash(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(redactForHash);
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      /passcode|api.?key|token|authorization|auth.?header|secret/i.test(key) ? "[redacted]" : redactForHash(item)
    ])
  );
}

function actorKey(request: Request, route: string, actor: Actor) {
  return hashValue([
    "internal-agent",
    route,
    actor.profileId ?? actor.name,
    actor.role,
    requestIp(request)
  ].join("|"));
}

function contentHash(route: string, body: Record<string, unknown>) {
  const content = { ...body };
  delete content.actor;
  return hashValue(`${route}:${JSON.stringify(redactForHash(content)).toLowerCase().replace(/\s+/g, " ").trim()}`);
}

export async function internalAgentGuard(args: {
  clinicId: string;
  request: Request;
  actor: Actor;
  route: string;
  body: Record<string, unknown>;
}) {
  const sql = getSql();
  const clientHash = actorKey(args.request, args.route, args.actor);
  const requestHash = contentHash(args.route, args.body);
  const maxPerHour = maxPerHourByRole[args.actor.role] ?? 30;
  const rows = await sql<{ client_count: number }[]>`
    select
      (
        select count(*)::int
        from request_guard_events
        where clinic_id = ${args.clinicId}
          and client_key_hash = ${clientHash}
          and status = 'internal_agent_started'
          and created_at > now() - interval '1 hour'
      ) as client_count
  `;
  const row = rows[0];
  if ((row?.client_count ?? 0) >= maxPerHour) {
    await sql`
      insert into request_guard_events (clinic_id, client_key_hash, content_hash, status)
      values (
        ${args.clinicId},
        ${clientHash},
        ${requestHash},
        'internal_agent_rate_limited'
      )
    `;
    return NextResponse.json(
      { error: "Too many agent requests. Please try again later." },
      { status: 429 }
    );
  }

  await sql`
    insert into request_guard_events (clinic_id, client_key_hash, content_hash, status)
    values (${args.clinicId}, ${clientHash}, ${requestHash}, 'internal_agent_started')
  `;
  return null;
}
