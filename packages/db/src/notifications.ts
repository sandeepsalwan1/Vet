import { getSql } from "./connection";
import { resolveClinicId } from "./clinics";

export async function createNotificationAttempt(args: {
  clinicId?: string | null;
  notificationType: string;
  recipient: string;
  idempotencyKey: string;
  taskId?: string | null;
}) {
  const sql = getSql();
  const clinicId = await resolveClinicId(args.clinicId);
  const rows = await sql<{ id: string }[]>`
    insert into notification_events (
      clinic_id,
      task_id,
      notification_type,
      recipient,
      status,
      idempotency_key
    )
    values (
      ${clinicId},
      ${args.taskId ?? null},
      ${args.notificationType},
      ${args.recipient},
      'pending',
      ${args.idempotencyKey}
    )
    on conflict (clinic_id, idempotency_key) where idempotency_key is not null do nothing
    returning id
  `;
  return rows[0]?.id ?? null;
}

export async function markNotificationSent(id: string, resendId?: string | null) {
  const sql = getSql();
  await sql`
    update notification_events
    set status = 'sent',
      resend_id = ${resendId ?? null},
      sent_at = now()
    where id = ${id}
  `;
}

export async function markNotificationSkipped(id: string, reason: string) {
  const sql = getSql();
  await sql`
    update notification_events
    set status = 'skipped',
      error = ${reason},
      sent_at = now()
    where id = ${id}
  `;
}

export async function markNotificationFailed(id: string, error: string) {
  const sql = getSql();
  await sql`
    update notification_events
    set status = 'failed',
      error = ${error}
    where id = ${id}
  `;
}
