import { resolveClinicId } from "./clinics";
import { getSql } from "./connection";
import type { DueClientJourneyMessage } from "./clientJourneyRows";

export async function createClientJourneyEvent(input: {
  clinicId?: string | null;
  clientId?: string | null;
  petId?: string | null;
  appointmentId?: string | null;
  eventType: string;
  audience?: "customer" | "employee" | "both";
  source: string;
  summary: string;
  metadata?: Record<string, unknown>;
  occurredAt?: string;
}) {
  const sql = getSql();
  const clinicId = await resolveClinicId(input.clinicId);
  const rows = await sql<{ id: string }[]>`
    insert into client_journey_events (
      clinic_id,
      client_id,
      pet_id,
      appointment_id,
      event_type,
      audience,
      source,
      summary,
      metadata,
      occurred_at
    ) values (
      ${clinicId},
      ${input.clientId ?? null},
      ${input.petId ?? null},
      ${input.appointmentId ?? null},
      ${input.eventType},
      ${input.audience ?? "customer"},
      ${input.source},
      ${input.summary},
      ${sql.json((input.metadata ?? {}) as never)},
      ${input.occurredAt ?? new Date().toISOString()}
    )
    returning id
  `;
  return rows[0].id;
}

export async function planClientJourneyMessage(input: {
  clinicId?: string | null;
  clientId?: string | null;
  petId?: string | null;
  appointmentId?: string | null;
  eventId?: string | null;
  messageType: string;
  audience?: "customer" | "employee";
  channel: "email" | "sms" | "portal";
  subject?: string | null;
  body: string;
  scheduledFor: string;
  status?: "planned" | "skipped";
  idempotencyKey: string;
}) {
  const sql = getSql();
  const clinicId = await resolveClinicId(input.clinicId);
  await sql`
    insert into client_journey_messages (
      clinic_id,
      client_id,
      pet_id,
      appointment_id,
      event_id,
      message_type,
      audience,
      channel,
      subject,
      body,
      scheduled_for,
      status,
      idempotency_key
    ) values (
      ${clinicId},
      ${input.clientId ?? null},
      ${input.petId ?? null},
      ${input.appointmentId ?? null},
      ${input.eventId ?? null},
      ${input.messageType},
      ${input.audience ?? "customer"},
      ${input.channel},
      ${input.subject ?? null},
      ${input.body},
      ${input.scheduledFor},
      ${input.status ?? "planned"},
      ${input.idempotencyKey}
    )
    on conflict (clinic_id, idempotency_key) do nothing
  `;
}

export async function listDueClientJourneyMessages(options?: {
  clinicId?: string | null;
  limit?: number;
}) {
  const sql = getSql();
  const clinicId = await resolveClinicId(options?.clinicId);
  const limit = Math.min(Math.max(options?.limit ?? 100, 1), 500);
  const rows = await sql<Array<{
    id: string;
    clinic_id: string;
    clinic_name: string;
    message_type: string;
    channel: "email" | "sms";
    subject: string | null;
    body: string;
    idempotency_key: string;
    email: string | null;
    phone: string | null;
    email_enabled: boolean;
    sms_consent: boolean;
  }>>`
    select
      message.id,
      message.clinic_id,
      settings.public_name as clinic_name,
      message.message_type,
      message.channel,
      message.subject,
      message.body,
      message.idempotency_key,
      coalesce(preferences.email, client.email) as email,
      coalesce(preferences.phone, client.phone) as phone,
      coalesce(preferences.email_enabled, true) as email_enabled,
      coalesce(preferences.sms_consent, false) as sms_consent
    from client_journey_messages message
    join client_journey_settings settings
      on settings.clinic_id = message.clinic_id
    left join client_contact_preferences preferences
      on preferences.clinic_id = message.clinic_id
      and preferences.client_id = message.client_id
    left join mock_clients client
      on client.clinic_id = message.clinic_id
      and client.id = message.client_id
    where message.clinic_id = ${clinicId}
      and message.status = 'planned'
      and message.audience = 'customer'
      and message.channel in ('email', 'sms')
      and message.scheduled_for <= now()
    order by message.scheduled_for, message.created_at
    limit ${limit}
  `;
  return rows.map((row): DueClientJourneyMessage => ({
    id: row.id,
    clinicId: row.clinic_id,
    clinicName: row.clinic_name,
    messageType: row.message_type,
    channel: row.channel,
    subject: row.subject,
    body: row.body,
    idempotencyKey: row.idempotency_key,
    email: row.email,
    phone: row.phone,
    emailEnabled: row.email_enabled,
    smsConsent: row.sms_consent
  }));
}

export async function markClientJourneyMessageStatus(input: {
  clinicId?: string | null;
  messageId: string;
  status: "sent" | "skipped" | "failed";
  reason?: string | null;
}) {
  const sql = getSql();
  const clinicId = await resolveClinicId(input.clinicId);
  await sql`
    update client_journey_messages
    set
      status = ${input.status},
      cancellation_reason = ${input.reason ?? null},
      sent_at = case
        when ${input.status} = 'sent' then now()
        else sent_at
      end,
      updated_at = now()
    where id = ${input.messageId}
      and clinic_id = ${clinicId}
      and status = 'planned'
  `;
}

export async function cancelClientJourneyMessages(input: {
  clinicId?: string | null;
  clientId: string;
  appointmentId?: string | null;
  messageTypes: string[];
  reason: string;
}) {
  const sql = getSql();
  const clinicId = await resolveClinicId(input.clinicId);
  await sql`
    update client_journey_messages
    set
      status = 'cancelled',
      cancellation_reason = ${input.reason},
      updated_at = now()
    where clinic_id = ${clinicId}
      and client_id = ${input.clientId}
      and (
        ${input.appointmentId ?? null}::text is null
        or appointment_id = ${input.appointmentId ?? null}
      )
      and message_type = any(${input.messageTypes})
      and status = 'planned'
  `;
}

export async function recordClientJourneyResponse(input: {
  clinicId?: string | null;
  clientId: string;
  petId?: string | null;
  appointmentId?: string | null;
  responseType: "visit_experience" | "pet_health";
  sentiment: "up" | "down";
  comment?: string | null;
  followupTaskId?: string | null;
}) {
  const sql = getSql();
  const clinicId = await resolveClinicId(input.clinicId);
  await sql`
    insert into client_journey_responses (
      clinic_id,
      client_id,
      pet_id,
      appointment_id,
      response_type,
      sentiment,
      comment,
      followup_task_id
    ) values (
      ${clinicId},
      ${input.clientId},
      ${input.petId ?? null},
      ${input.appointmentId ?? null},
      ${input.responseType},
      ${input.sentiment},
      ${input.comment ?? null},
      ${input.followupTaskId ?? null}
    )
    on conflict (
      clinic_id,
      client_id,
      pet_id,
      appointment_id,
      response_type
    ) do update set
      sentiment = excluded.sentiment,
      comment = excluded.comment,
      followup_task_id = coalesce(
        excluded.followup_task_id,
        client_journey_responses.followup_task_id
      ),
      created_at = now()
  `;
}

export async function createClientRecordRelease(input: {
  clinicId?: string | null;
  clientId: string;
  petId?: string | null;
  recipientName: string;
  recipientDestination: string;
  recordScope: string;
}) {
  const sql = getSql();
  const clinicId = await resolveClinicId(input.clinicId);
  const rows = await sql<{ id: string }[]>`
    insert into client_record_releases (
      clinic_id,
      client_id,
      pet_id,
      recipient_name,
      recipient_destination,
      record_scope,
      confirmed_at
    ) values (
      ${clinicId},
      ${input.clientId},
      ${input.petId ?? null},
      ${input.recipientName},
      ${input.recipientDestination},
      ${input.recordScope},
      now()
    )
    returning id
  `;
  return rows[0].id;
}
