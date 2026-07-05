import { createHash } from "node:crypto";
import { resolveClinicId } from "./clinics";
import { getSql } from "./connection";
import type { AppRole } from "./types";

const authWindowMinutes = 15;
const authFailureLimit = 12;

function hashAuthIdentity(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export async function checkAuthAttemptLimit(
  identity: string,
  options?: { clinicId?: string | null }
) {
  const sql = getSql();
  const clinicId = await resolveClinicId(options?.clinicId);
  const identityHash = hashAuthIdentity(identity);
  const rows = await sql<{ failure_count: number }[]>`
    select count(*)::int as failure_count
    from auth_attempt_events
    where clinic_id = ${clinicId}
      and identity_hash = ${identityHash}
      and success = false
      and created_at > now() - ${sql.unsafe(`interval '${authWindowMinutes} minutes'`)}
  `;
  const failureCount = rows[0]?.failure_count ?? 0;
  return {
    allowed: failureCount < authFailureLimit,
    failureCount,
    limit: authFailureLimit,
    windowMinutes: authWindowMinutes
  };
}

export async function recordAuthAttempt(args: {
  clinicId?: string | null;
  identity: string;
  role: AppRole;
  success: boolean;
}) {
  const sql = getSql();
  const clinicId = await resolveClinicId(args.clinicId);
  await sql`
    insert into auth_attempt_events (clinic_id, identity_hash, actor_role, success)
    values (${clinicId}, ${hashAuthIdentity(args.identity)}, ${args.role}, ${args.success})
  `;
  await sql`
    delete from auth_attempt_events
    where created_at < now() - interval '24 hours'
  `;
}
