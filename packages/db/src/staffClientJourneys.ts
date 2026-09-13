import { resolveClinicId } from "./clinics";
import { getSql } from "./connection";
import type {
  StaffClientJourneySnapshot,
  StaffJourneyClient,
  StaffJourneyItem
} from "./clientJourneyRows";
import { getClientJourneySettings } from "./clientJourneySettings";

export async function listStaffClientJourneys(options?: {
  clinicId?: string | null;
}): Promise<StaffClientJourneySnapshot> {
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
      join mock_pets pet
        on pet.clinic_id = client.clinic_id
        and pet.client_id = client.id
      left join mock_appointments appointment
        on appointment.clinic_id = client.clinic_id
        and appointment.client_id = client.id
        and appointment.pet_id = pet.id
      left join lateral (
        select total_cents
        from mock_invoices
        where clinic_id = client.clinic_id
          and client_id = client.id
          and pet_id = pet.id
        order by invoice_date desc
        limit 1
      ) invoice on true
      where client.clinic_id = ${clinicId}
      order by
        client.id,
        pet.id,
        appointment.appointment_date desc nulls last,
        appointment.appointment_time desc nulls last
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
      left join mock_clients client
        on client.clinic_id = message.clinic_id
        and client.id = message.client_id
      left join mock_pets pet
        on pet.clinic_id = message.clinic_id
        and pet.id = message.pet_id
      where message.clinic_id = ${clinicId}
      order by message.scheduled_for desc
      limit 80
    `
  ]);

  const counts = roomCounts[0] ?? { occupied: 0, total: 0 };
  const pressured = counts.total > 0 &&
    counts.occupied * settings.roomPressureDenominator >=
      counts.total * settings.roomPressureNumerator;
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
      thresholdLabel:
        `${settings.roomPressureNumerator}/${settings.roomPressureDenominator}`
    },
    clients,
    items
  };
}
