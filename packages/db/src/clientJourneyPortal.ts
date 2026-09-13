import { resolveClinicId } from "./clinics";
import { getSql } from "./connection";
import {
  dateText,
  type ClientContactPreferences,
  type ClientJourneyAppointment,
  type ClientJourneyEvent,
  type ClientJourneyInvoice,
  type ClientJourneyMessage,
  type ClientJourneyProfile,
  type ClientJourneySnapshot
} from "./clientJourneyRows";
import { getClientJourneySettings } from "./clientJourneySettings";

type ProfileRow = {
  client_id: string;
  client_name: string;
  email: string | null;
  phone: string;
  pet_id: string;
  pet_name: string;
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

function normalizePreferences(
  row: PreferenceRow | undefined,
  profile: ClientJourneyProfile
): ClientContactPreferences {
  return {
    email: row?.email ?? profile.email,
    phone: row?.phone ?? profile.phone,
    emailEnabled: row?.email_enabled ?? true,
    smsConsent: row?.sms_consent ?? false,
    preferredChannel: row?.preferred_channel ?? "email"
  };
}

function normalizeAppointment(
  row: AppointmentRow | undefined
): ClientJourneyAppointment | null {
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

function normalizeInvoice(
  row: InvoiceRow | undefined
): ClientJourneyInvoice | null {
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
    join mock_pets pet
      on pet.clinic_id = client.clinic_id
      and pet.client_id = client.id
    where client.clinic_id = ${clinicId}
      and client.id = ${input.clientId}
      and pet.id = ${input.petId}
    limit 1
  `;
  return rows[0] ? normalizeProfile(rows[0]) : null;
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
    where clinic_id = ${clinicId}
      and client_id = ${input.clientId}
    limit 1
  `;
  return normalizePreferences(rows[0], input.profile);
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

  const profile = await getClientClaimProfile({
    clinicId,
    clientId: grant.client_id,
    petId: grant.pet_id
  });
  if (!profile) return null;

  const [settings, preferences, appointments, invoices, events, messages] =
    await Promise.all([
      getClientJourneySettings({ clinicId }),
      sql<PreferenceRow[]>`
        select email, phone, email_enabled, sms_consent, preferred_channel
        from client_contact_preferences
        where clinic_id = ${clinicId}
          and client_id = ${profile.clientId}
        limit 1
      `,
      sql<AppointmentRow[]>`
        select
          id,
          appointment_date,
          appointment_time,
          appointment_type,
          doctor,
          status,
          room_status
        from mock_appointments
        where clinic_id = ${clinicId}
          and client_id = ${profile.clientId}
          and pet_id = ${profile.petId}
        order by
          (appointment_date >= current_date) desc,
          case
            when appointment_date >= current_date then appointment_date
          end asc,
          appointment_date desc,
          appointment_time asc
        limit 1
      `,
      sql<InvoiceRow[]>`
        select id, invoice_number, invoice_date, total_cents, status
        from mock_invoices
        where clinic_id = ${clinicId}
          and client_id = ${profile.clientId}
          and pet_id = ${profile.petId}
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
        select
          id,
          message_type,
          audience,
          channel,
          subject,
          body,
          scheduled_for,
          status,
          cancellation_reason
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
      clinic_id,
      client_id,
      email,
      phone,
      email_enabled,
      sms_consent,
      sms_consented_at,
      sms_consent_source,
      preferred_channel
    ) values (
      ${clinicId},
      ${input.clientId},
      ${input.email},
      ${input.phone},
      ${input.emailEnabled},
      ${input.smsConsent},
      ${input.smsConsent ? new Date().toISOString() : null},
      ${input.smsConsent ? "customer_portal" : null},
      ${input.preferredChannel}
    )
    on conflict (clinic_id, client_id) do update set
      email = excluded.email,
      phone = excluded.phone,
      email_enabled = excluded.email_enabled,
      sms_consent = excluded.sms_consent,
      sms_consented_at = case
        when excluded.sms_consent
          then coalesce(client_contact_preferences.sms_consented_at, now())
        else null
      end,
      sms_consent_source = case
        when excluded.sms_consent then 'customer_portal'
        else null
      end,
      preferred_channel = excluded.preferred_channel,
      updated_at = now()
  `;
}
