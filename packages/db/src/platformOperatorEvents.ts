import { createHash } from "node:crypto";
import { getSql } from "./connection";

const operatorAuthWindowMinutes = 15;
const operatorAuthFailureLimit = 5;

function hashPrivateValue(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export async function checkPlatformOperatorAttemptLimit(identity: string) {
  const sql = getSql();
  const identityHash = hashPrivateValue(identity);
  const rows = await sql<{ failure_count: number }[]>`
    select count(*)::int as failure_count
    from platform_operator_audit_events
    where action = 'login_failed'
      and identity_hash = ${identityHash}
      and created_at > now() - interval '15 minutes'
  `;
  const failureCount = rows[0]?.failure_count ?? 0;
  return {
    allowed: failureCount < operatorAuthFailureLimit,
    failureCount,
    limit: operatorAuthFailureLimit,
    windowMinutes: operatorAuthWindowMinutes
  };
}

export async function recordPlatformOperatorAudit(input: {
  action:
    | "login_succeeded"
    | "login_failed"
    | "dashboard_viewed"
    | "settings_updated";
  identity?: string | null;
  details?: Record<string, string | number | boolean | null>;
}) {
  const sql = getSql();
  await sql`
    insert into platform_operator_audit_events (
      action,
      identity_hash,
      details
    )
    values (
      ${input.action},
      ${input.identity ? hashPrivateValue(input.identity) : null},
      ${sql.json(input.details ?? {})}
    )
  `;
  await sql`
    delete from platform_operator_audit_events
    where action in ('login_succeeded', 'login_failed')
      and created_at < now() - interval '30 days'
  `;
}

export async function createPlatformOperatorNotificationAttempt(input: {
  notificationType: string;
  recipient: string;
  idempotencyKey: string;
}) {
  const sql = getSql();
  const rows = await sql<{ id: string }[]>`
    insert into platform_operator_notification_events (
      notification_type,
      recipient_hash,
      status,
      idempotency_key
    )
    values (
      ${input.notificationType},
      ${hashPrivateValue(input.recipient.trim().toLowerCase())},
      'pending',
      ${input.idempotencyKey}
    )
    on conflict (idempotency_key) do nothing
    returning id
  `;
  if (rows[0]) {
    return {
      id: rows[0].id,
      status: "pending" as const,
      duplicate: false as const
    };
  }
  const existing = await sql<Array<{
    id: string;
    status: "pending" | "sent" | "skipped" | "failed";
  }>>`
    select id, status
    from platform_operator_notification_events
    where idempotency_key = ${input.idempotencyKey}
    limit 1
  `;
  if (!existing[0]) {
    throw new Error("Platform operator notification attempt is unavailable.");
  }
  return {
    id: existing[0].id,
    status: existing[0].status,
    duplicate: true as const
  };
}

export async function markPlatformOperatorNotification(input: {
  id: string;
  status: "sent" | "skipped" | "failed";
  providerId?: string | null;
  error?: string | null;
}) {
  const sql = getSql();
  await sql`
    update platform_operator_notification_events
    set
      status = ${input.status},
      provider_id = ${input.providerId ?? null},
      error = ${input.error ?? null},
      sent_at = case
        when ${input.status} = 'sent' then now()
        else sent_at
      end
    where id = ${input.id}
  `;
}
