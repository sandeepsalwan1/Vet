import { getClinicById, resolveClinicId } from "./clinics";
import { getSql } from "./connection";
import {
  dateText,
  journeySettingsColumns,
  normalizeJourneySettings,
  type ClientContactPreferences,
  type DueClientJourneyMessage,
  type ClientJourneyAppointment,
  type ClientJourneyEvent,
  type ClientJourneyInvoice,
  type ClientJourneyMessage,
  type ClientJourneyProfile,
  type ClientJourneySettings,
  type ClientJourneySnapshot,
  type JourneySettingsRow,
  type StaffClientJourneySnapshot,
  type StaffJourneyClient,
  type StaffJourneyItem
} from "./clientJourneyRows";

type ClaimMatchRow = {
  client_id: string;
  client_name: string;
  email: string | null;
  phone: string;
  pet_id: string;
  pet_name: string;
};

type ClaimRow = {
  id: string;
  clinic_id: string;
  matched_client_id: string | null;
  matched_pet_id: string | null;
  code_hash: string | null;
  code_salt: string | null;
  status: string;
  attempts: number;
  expires_at: string | null;
};

type ProfileRow = ClaimMatchRow & {
  species: string;
  breed: string | null;
};

type PreferenceRow = {
  email: string | null;
  phone: string | null;
  email_enabled: boolean;
  sms_consent: boolean;
  preferred_channel: "email" | "sms" | "both";
};

type AppointmentRow = {
  id: string;
  appointment_date: string | Date;
  appointment_time: string;
  appointment_type: string;
  doctor: string;
  status: string;
  room_status: string;
};

type InvoiceRow = {
  id: string;
  invoice_number: string;
  invoice_date: string | Date;
  total_cents: number;
  status: string;
};

type EventRow = {
  id: string;
  event_type: string;
  audience: "customer" | "employee" | "both";
  source: string;
  summary: string;
  occurred_at: string;
};

type MessageRow = {
  id: string;
  message_type: string;
  audience: "customer" | "employee";
  channel: "email" | "sms" | "portal";
  subject: string | null;
  body: string;
  scheduled_for: string;
  status: "planned" | "sent" | "skipped" | "cancelled" | "failed";
  cancellation_reason: string | null;
};

function defaultSettings(clinicId: string, publicName: string, timeZone: string): ClientJourneySettings {
  return {
    clinicId,
    timeZone,
    publicName,
    familyStory: "",
    primaryDomain: null,
    pimsProvider: "unconfigured",
    pimsMode: "adapter",
    confirmationEmailEnabled: true,
    reminderEmailHours: 48,
    reminderSmsHours: 24,
    reminderSmsEnabled: true,
    quietHoursStart: "20:00:00",
    quietHoursEnd: "08:00:00",
    feedbackDelayMinutes: 75,
    petCheckDelayHours: 24,
    roomPressureNumerator: 2,
    roomPressureDenominator: 3
  };
}

export async function getClientJourneySettings(options?: { clinicId?: string | null }) {
  const sql = getSql();
  const clinicId = await resolveClinicId(options?.clinicId);
  const clinic = await getClinicById(clinicId);
  const timeZone = clinic?.timeZone ?? process.env.APP_TIME_ZONE ?? process.env.TZ ?? "America/Los_Angeles";
  const rows = await sql<JourneySettingsRow[]>`
    select ${sql.unsafe(journeySettingsColumns)}
    from client_journey_settings
    where clinic_id = ${clinicId}
    limit 1
  `;
  if (rows[0]) return normalizeJourneySettings(rows[0], timeZone);
  const clinics = await sql<{ name: string }[]>`select name from clinics where id = ${clinicId} limit 1`;
  const defaults = defaultSettings(clinicId, clinics[0]?.name ?? "Veterinary Hospital", timeZone);
  const inserted = await sql<JourneySettingsRow[]>`
    insert into client_journey_settings (clinic_id, public_name)
    values (${clinicId}, ${defaults.publicName})
    returning ${sql.unsafe(journeySettingsColumns)}
  `;
  return normalizeJourneySettings(inserted[0], defaults.timeZone);
}

export async function beginClientAccountClaim(input: {
  clinicId?: string | null;
  requesterHash: string;
  contactKind: "email" | "phone";
  contactValue: string;
  petName: string;
  codeHash: string;
  codeSalt: string;
  destinationHint: string;
}) {
  const sql = getSql();
  const clinicId = await resolveClinicId(input.clinicId);
  const recentClaims = await sql<Array<{ id: string; status: string }>>`
    select id, status
    from client_account_claims
    where clinic_id = ${clinicId}
      and requester_hash = ${input.requesterHash}
      and created_at >= now() - interval '1 hour'
    order by created_at desc
    limit 5
  `;
  if (recentClaims.length >= 5) {
    return {
      claimId: recentClaims[0].id,
      matched: false,
      destinationHint: null,
      match: null,
      rateLimited: true
    };
  }
  const contact = input.contactValue.trim().toLowerCase();
  const phoneDigits = input.contactValue.replace(/\D/g, "").slice(-10);
  const matches = await sql<ClaimMatchRow[]>`
    select
      client.id as client_id,
      client.full_name as client_name,
      client.email,
      client.phone,
      pet.id as pet_id,
      pet.name as pet_name
    from mock_clients client
    join mock_pets pet on pet.clinic_id = client.clinic_id and pet.client_id = client.id
    where client.clinic_id = ${clinicId}
      and lower(pet.name) = lower(${input.petName.trim()})
      and (
        (${input.contactKind} = 'email' and lower(coalesce(client.email, '')) = ${contact})
        or (${input.contactKind} = 'phone' and right(regexp_replace(client.phone, '[^0-9]', '', 'g'), 10) = ${phoneDigits})
      )
    limit 2
  `;
  const match = matches.length === 1 ? matches[0] : null;
  const pendingReview = recentClaims.find((claim) => claim.status === "pending_staff_review");
  if (!match && pendingReview) {
    return {
      claimId: pendingReview.id,
      matched: false,
      destinationHint: null,
      match: null,
      rateLimited: true
    };
  }
  const status = match ? "pending" : "pending_staff_review";
  const rows = await sql<{ id: string }[]>`
    insert into client_account_claims (
      clinic_id,
      requester_hash,
      matched_client_id,
      matched_pet_id,
      delivery_channel,
      destination_hint,
      code_hash,
      code_salt,
      status,
      expires_at
    ) values (
      ${clinicId},
      ${input.requesterHash},
      ${match?.client_id ?? null},
      ${match?.pet_id ?? null},
      ${match ? input.contactKind : null},
      ${match ? input.destinationHint : null},
      ${match ? input.codeHash : null},
      ${match ? input.codeSalt : null},
      ${status},
      ${match ? new Date(Date.now() + 10 * 60_000).toISOString() : null}
    )
    returning id
  `;
  return {
    claimId: rows[0].id,
    matched: Boolean(match),
    destinationHint: match ? input.destinationHint : null,
    match,
    rateLimited: false
  };
}

export async function getClientAccountClaimForVerification(input: {
  clinicId?: string | null;
  claimId: string;
}) {
  const sql = getSql();
  const clinicId = await resolveClinicId(input.clinicId);
  const rows = await sql<ClaimRow[]>`
    select id, clinic_id, matched_client_id, matched_pet_id, code_hash, code_salt, status, attempts, expires_at
    from client_account_claims
    where id = ${input.claimId}
      and clinic_id = ${clinicId}
    limit 1
  `;
  return rows[0] ?? null;
}

export async function failClientAccountClaim(input: {
  clinicId?: string | null;
  claimId: string;
}) {
  const sql = getSql();
  const clinicId = await resolveClinicId(input.clinicId);
  await sql`
    update client_account_claims
    set attempts = attempts + 1,
      status = case when attempts + 1 >= 5 then 'locked' else status end,
      updated_at = now()
    where id = ${input.claimId}
      and clinic_id = ${clinicId}
  `;
}

export async function deferClientAccountClaim(input: {
  clinicId?: string | null;
  claimId: string;
}) {
  const sql = getSql();
  const clinicId = await resolveClinicId(input.clinicId);
  await sql`
    update client_account_claims
    set status = 'pending_staff_review',
      code_hash = null,
      code_salt = null,
      expires_at = null,
      updated_at = now()
    where id = ${input.claimId}
      and clinic_id = ${clinicId}
      and status = 'pending'
  `;
}

export async function completeClientAccountClaim(input: {
  clinicId?: string | null;
  claimId: string;
  clientId: string;
  petId: string;
  tokenHash: string;
}) {
  const sql = getSql();
  const clinicId = await resolveClinicId(input.clinicId);
  let completed = false;
  await sql.begin(async (transaction) => {
    const claims = await transaction<{ id: string }[]>`
      update client_account_claims
      set status = 'verified', verified_at = now(), updated_at = now()
      where id = ${input.claimId}
        and clinic_id = ${clinicId}
        and status = 'pending'
        and attempts < 5
        and expires_at > now()
      returning id
    `;
    if (!claims[0]) return;
    await transaction`
      insert into client_portal_access_grants (clinic_id, client_id, pet_id, token_hash, expires_at)
      values (${clinicId}, ${input.clientId}, ${input.petId}, ${input.tokenHash}, now() + interval '90 days')
    `;
    completed = true;
  });
  return completed;
}

export async function getClientClaimProfile(input: {
  clinicId?: string | null;
  clientId: string;
  petId: string;
}) {
  const sql = getSql();
  const clinicId = await resolveClinicId(input.clinicId);
  const rows = await sql<ProfileRow[]>`
    select
      client.id as client_id,
      client.full_name as client_name,
      client.email,
      client.phone,
      pet.id as pet_id,
      pet.name as pet_name,
      pet.species,
      pet.breed
    from mock_clients client
    join mock_pets pet on pet.clinic_id = client.clinic_id and pet.client_id = client.id
    where client.clinic_id = ${clinicId}
      and client.id = ${input.clientId}
      and pet.id = ${input.petId}
    limit 1
  `;
  return rows[0] ? normalizeProfile(rows[0]) : null;
}

function normalizeProfile(row: ProfileRow): ClientJourneyProfile {
  return {
    clientId: row.client_id,
    clientName: row.client_name,
    email: row.email,
    phone: row.phone,
    petId: row.pet_id,
    petName: row.pet_name,
    species: row.species,
    breed: row.breed
  };
}

function normalizePreferences(row: PreferenceRow | undefined, profile: ClientJourneyProfile): ClientContactPreferences {
  return {
    email: row?.email ?? profile.email,
    phone: row?.phone ?? profile.phone,
    emailEnabled: row?.email_enabled ?? true,
    smsConsent: row?.sms_consent ?? false,
    preferredChannel: row?.preferred_channel ?? "email"
  };
}

export async function getClientContactPreferences(input: {
  clinicId?: string | null;
  clientId: string;
  profile: ClientJourneyProfile;
}) {
  const sql = getSql();
  const clinicId = await resolveClinicId(input.clinicId);
  const rows = await sql<PreferenceRow[]>`
    select email, phone, email_enabled, sms_consent, preferred_channel
    from client_contact_preferences
    where clinic_id = ${clinicId} and client_id = ${input.clientId}
    limit 1
  `;
  return normalizePreferences(rows[0], input.profile);
}

function normalizeAppointment(row: AppointmentRow | undefined): ClientJourneyAppointment | null {
  if (!row) return null;
  return {
    id: row.id,
    appointmentDate: dateText(row.appointment_date),
    appointmentTime: row.appointment_time,
    appointmentType: row.appointment_type,
    doctor: row.doctor,
    status: row.status,
    roomStatus: row.room_status
  };
}

function normalizeInvoice(row: InvoiceRow | undefined): ClientJourneyInvoice | null {
  if (!row) return null;
  return {
    id: row.id,
    invoiceNumber: row.invoice_number,
    invoiceDate: dateText(row.invoice_date),
    totalCents: row.total_cents,
    status: row.status
  };
}

function normalizeEvent(row: EventRow): ClientJourneyEvent {
  return {
    id: row.id,
    eventType: row.event_type,
    audience: row.audience,
    source: row.source,
    summary: row.summary,
    occurredAt: row.occurred_at
  };
}

function normalizeMessage(row: MessageRow): ClientJourneyMessage {
  return {
    id: row.id,
    messageType: row.message_type,
    audience: row.audience,
    channel: row.channel,
    subject: row.subject,
    body: row.body,
    scheduledFor: row.scheduled_for,
    status: row.status,
    cancellationReason: row.cancellation_reason
  };
}

export async function getClientJourneySnapshot(input: {
  clinicId?: string | null;
  tokenHash: string;
}): Promise<ClientJourneySnapshot | null> {
  const sql = getSql();
  const clinicId = await resolveClinicId(input.clinicId);
  const grants = await sql<{ client_id: string; pet_id: string }[]>`
    update client_portal_access_grants
    set last_used_at = now()
    where clinic_id = ${clinicId}
      and token_hash = ${input.tokenHash}
      and revoked_at is null
      and expires_at > now()
    returning client_id, pet_id
  `;
  const grant = grants[0];
  if (!grant) return null;
  const profile = await getClientClaimProfile({ clinicId, clientId: grant.client_id, petId: grant.pet_id });
  if (!profile) return null;
  const [settings, preferences, appointments, invoices, events, messages] = await Promise.all([
    getClientJourneySettings({ clinicId }),
    sql<PreferenceRow[]>`
      select email, phone, email_enabled, sms_consent, preferred_channel
      from client_contact_preferences
      where clinic_id = ${clinicId} and client_id = ${profile.clientId}
      limit 1
    `,
    sql<AppointmentRow[]>`
      select id, appointment_date, appointment_time, appointment_type, doctor, status, room_status
      from mock_appointments
      where clinic_id = ${clinicId} and client_id = ${profile.clientId} and pet_id = ${profile.petId}
      order by (appointment_date >= current_date) desc,
        case when appointment_date >= current_date then appointment_date end asc,
        appointment_date desc,
        appointment_time asc
      limit 1
    `,
    sql<InvoiceRow[]>`
      select id, invoice_number, invoice_date, total_cents, status
      from mock_invoices
      where clinic_id = ${clinicId} and client_id = ${profile.clientId} and pet_id = ${profile.petId}
      order by invoice_date desc
      limit 1
    `,
    sql<EventRow[]>`
      select id, event_type, audience, source, summary, occurred_at
      from client_journey_events
      where clinic_id = ${clinicId}
        and client_id = ${profile.clientId}
        and audience in ('customer', 'both')
      order by occurred_at desc
      limit 30
    `,
    sql<MessageRow[]>`
      select id, message_type, audience, channel, subject, body, scheduled_for, status, cancellation_reason
      from client_journey_messages
      where clinic_id = ${clinicId}
        and client_id = ${profile.clientId}
        and audience = 'customer'
      order by scheduled_for desc
      limit 40
    `
  ]);
  return {
    settings,
    profile,
    preferences: normalizePreferences(preferences[0], profile),
    appointment: normalizeAppointment(appointments[0]),
    invoice: normalizeInvoice(invoices[0]),
    events: events.map(normalizeEvent),
    messages: messages.map(normalizeMessage)
  };
}

export async function saveClientContactPreferences(input: {
  clinicId?: string | null;
  clientId: string;
  email: string | null;
  phone: string | null;
  emailEnabled: boolean;
  smsConsent: boolean;
  preferredChannel: "email" | "sms" | "both";
}) {
  const sql = getSql();
  const clinicId = await resolveClinicId(input.clinicId);
  await sql`
    insert into client_contact_preferences (
      clinic_id, client_id, email, phone, email_enabled, sms_consent,
      sms_consented_at, sms_consent_source, preferred_channel
    ) values (
      ${clinicId}, ${input.clientId}, ${input.email}, ${input.phone}, ${input.emailEnabled}, ${input.smsConsent},
      ${input.smsConsent ? new Date().toISOString() : null}, ${input.smsConsent ? "customer_portal" : null}, ${input.preferredChannel}
    )
    on conflict (clinic_id, client_id) do update set
      email = excluded.email,
      phone = excluded.phone,
      email_enabled = excluded.email_enabled,
      sms_consent = excluded.sms_consent,
      sms_consented_at = case when excluded.sms_consent then coalesce(client_contact_preferences.sms_consented_at, now()) else null end,
      sms_consent_source = case when excluded.sms_consent then 'customer_portal' else null end,
      preferred_channel = excluded.preferred_channel,
      updated_at = now()
  `;
}

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
      clinic_id, client_id, pet_id, appointment_id, event_type, audience, source, summary, metadata, occurred_at
    ) values (
      ${clinicId}, ${input.clientId ?? null}, ${input.petId ?? null}, ${input.appointmentId ?? null},
      ${input.eventType}, ${input.audience ?? "customer"}, ${input.source}, ${input.summary},
      ${sql.json((input.metadata ?? {}) as never)}, ${input.occurredAt ?? new Date().toISOString()}
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
      clinic_id, client_id, pet_id, appointment_id, event_id, message_type, audience,
      channel, subject, body, scheduled_for, status, idempotency_key
    ) values (
      ${clinicId}, ${input.clientId ?? null}, ${input.petId ?? null}, ${input.appointmentId ?? null}, ${input.eventId ?? null},
      ${input.messageType}, ${input.audience ?? "customer"}, ${input.channel}, ${input.subject ?? null},
      ${input.body}, ${input.scheduledFor}, ${input.status ?? "planned"}, ${input.idempotencyKey}
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
    join client_journey_settings settings on settings.clinic_id = message.clinic_id
    left join client_contact_preferences preferences
      on preferences.clinic_id = message.clinic_id and preferences.client_id = message.client_id
    left join mock_clients client
      on client.clinic_id = message.clinic_id and client.id = message.client_id
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
    set status = ${input.status},
      cancellation_reason = ${input.reason ?? null},
      sent_at = case when ${input.status} = 'sent' then now() else sent_at end,
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
    set status = 'cancelled', cancellation_reason = ${input.reason}, updated_at = now()
    where clinic_id = ${clinicId}
      and client_id = ${input.clientId}
      and (${input.appointmentId ?? null}::text is null or appointment_id = ${input.appointmentId ?? null})
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
      clinic_id, client_id, pet_id, appointment_id, response_type, sentiment, comment, followup_task_id
    ) values (
      ${clinicId}, ${input.clientId}, ${input.petId ?? null}, ${input.appointmentId ?? null},
      ${input.responseType}, ${input.sentiment}, ${input.comment ?? null}, ${input.followupTaskId ?? null}
    )
    on conflict (clinic_id, client_id, pet_id, appointment_id, response_type) do update set
      sentiment = excluded.sentiment,
      comment = excluded.comment,
      followup_task_id = coalesce(excluded.followup_task_id, client_journey_responses.followup_task_id),
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
      clinic_id, client_id, pet_id, recipient_name, recipient_destination, record_scope, confirmed_at
    ) values (
      ${clinicId}, ${input.clientId}, ${input.petId ?? null}, ${input.recipientName},
      ${input.recipientDestination}, ${input.recordScope}, now()
    )
    returning id
  `;
  return rows[0].id;
}

export async function listStaffClientJourneys(options?: { clinicId?: string | null }): Promise<StaffClientJourneySnapshot> {
  const sql = getSql();
  const clinicId = await resolveClinicId(options?.clinicId);
  const [settings, roomCounts, clientRows, rows] = await Promise.all([
    getClientJourneySettings({ clinicId }),
    sql<{ occupied: number; total: number }[]>`
      select
        count(*) filter (where state = 'occupied')::int as occupied,
        count(*)::int as total
      from clinic_rooms
      where clinic_id = ${clinicId}
    `,
    sql<Array<{
      client_id: string;
      client_name: string;
      phone: string;
      pet_id: string;
      pet_name: string;
      appointment_id: string | null;
      appointment_status: string | null;
      appointment_time: string | null;
      invoice_balance_cents: number | null;
    }>>`
      select distinct on (client.id, pet.id)
        client.id as client_id,
        client.full_name as client_name,
        client.phone,
        pet.id as pet_id,
        pet.name as pet_name,
        appointment.id as appointment_id,
        appointment.status as appointment_status,
        appointment.appointment_time,
        invoice.total_cents as invoice_balance_cents
      from mock_clients client
      join mock_pets pet on pet.clinic_id = client.clinic_id and pet.client_id = client.id
      left join mock_appointments appointment on appointment.clinic_id = client.clinic_id
        and appointment.client_id = client.id and appointment.pet_id = pet.id
      left join lateral (
        select total_cents
        from mock_invoices
        where clinic_id = client.clinic_id and client_id = client.id and pet_id = pet.id
        order by invoice_date desc
        limit 1
      ) invoice on true
      where client.clinic_id = ${clinicId}
      order by client.id, pet.id, appointment.appointment_date desc nulls last, appointment.appointment_time desc nulls last
      limit 60
    `,
    sql<Array<{
      client_id: string | null;
      client_name: string | null;
      pet_name: string | null;
      message_type: string;
      channel: string;
      status: string;
      scheduled_for: string;
      body: string;
    }>>`
      select
        message.client_id,
        client.full_name as client_name,
        pet.name as pet_name,
        message.message_type,
        message.channel,
        message.status,
        message.scheduled_for,
        message.body
      from client_journey_messages message
      left join mock_clients client on client.clinic_id = message.clinic_id and client.id = message.client_id
      left join mock_pets pet on pet.clinic_id = message.clinic_id and pet.id = message.pet_id
      where message.clinic_id = ${clinicId}
      order by message.scheduled_for desc
      limit 80
    `
  ]);
  const counts = roomCounts[0] ?? { occupied: 0, total: 0 };
  const pressured = counts.total > 0 && counts.occupied * settings.roomPressureDenominator >= counts.total * settings.roomPressureNumerator;
  const items: StaffJourneyItem[] = rows.map((row) => ({
    clientId: row.client_id,
    clientName: row.client_name ?? "Unmatched client",
    petName: row.pet_name ?? "Pet",
    messageType: row.message_type,
    channel: row.channel,
    status: row.status,
    scheduledFor: row.scheduled_for,
    body: row.body
  }));
  const clients: StaffJourneyClient[] = clientRows.map((row) => ({
    clientId: row.client_id,
    clientName: row.client_name,
    phone: row.phone,
    petId: row.pet_id,
    petName: row.pet_name,
    appointmentId: row.appointment_id,
    appointmentStatus: row.appointment_status,
    appointmentTime: row.appointment_time,
    invoiceBalanceCents: row.invoice_balance_cents
  }));
  return {
    settings,
    roomPressure: {
      occupied: counts.occupied,
      total: counts.total,
      pressured,
      thresholdLabel: `${settings.roomPressureNumerator}/${settings.roomPressureDenominator}`
    },
    clients,
    items
  };
}
