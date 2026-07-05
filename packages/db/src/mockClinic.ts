import { getSql } from "./connection";
import { resolveClinicId } from "./clinics";
import {
  normalizeAppointment,
  normalizeFollowup,
  type AppointmentRow,
  type FollowupRow
} from "./mockClinicRows";
export type { MockAppointment } from "./mockClinicRows";
export type {
  MockLabCatalogItem,
  MockLabOrder,
  MockLabResult
} from "./mockClinicLabRows";

export async function resetMockClinicState(options?: { clinicId?: string | null }) {
  const sql = getSql();
  const clinicId = await resolveClinicId(options?.clinicId);
  const roomRows = await sql<{ id: string }[]>`
    update clinic_rooms
    set state = 'open',
      current_arrival_id = null,
      auto_open_at = null,
      state_changed_at = now(),
      updated_at = now()
    where clinic_id = ${clinicId}
      and (
        state <> 'open'
        or current_arrival_id is not null
        or auto_open_at is not null
      )
    returning id
  `;
  const arrivalRows = await sql<{ id: string }[]>`
    delete from arrival_intakes
    where clinic_id = ${clinicId}
      and (
        status = 'exception'
        or appointment_id in (
          'appt-biscuit-today',
          'appt-luna-today',
          'appt-otis-today',
          'appt-maple-tomorrow'
        )
      )
    returning id
  `;
  const appointmentRows = await sql<{ id: string }[]>`
    update mock_appointments
    set status = 'scheduled',
      appointment_date = case
        when id in ('appt-biscuit-today', 'appt-luna-today', 'appt-otis-today') then current_date
        when id = 'appt-maple-tomorrow' then current_date + interval '1 day'
        else appointment_date
      end,
      room_status = 'waiting',
      arrived_at = null,
      updated_at = now()
    where clinic_id = ${clinicId}
      and (
        status = 'arrived'
        or arrived_at is not null
        or (id in ('appt-biscuit-today', 'appt-luna-today', 'appt-otis-today') and appointment_date <> current_date)
        or (id = 'appt-maple-tomorrow' and appointment_date <> current_date + interval '1 day')
      )
    returning id
  `;
  const bookedRows = await sql<{ id: string }[]>`
    delete from mock_appointments
    where clinic_id = ${clinicId}
      and id like 'appointment-slot-%'
    returning id
  `;
  const slotRows = await sql<{ id: string }[]>`
    update mock_slots
    set available = true
    where clinic_id = ${clinicId}
      and available = false
    returning id
  `;
  const followupRows = await sql<{ id: string }[]>`
    update mock_followups
    set status = 'open'
    where clinic_id = ${clinicId}
      and status <> 'open'
    returning id
  `;
  return {
    resetRooms: roomRows.length,
    resetArrivals: arrivalRows.length,
    resetAppointments: appointmentRows.length,
    resetBookedAppointments: bookedRows.length,
    resetSlots: slotRows.length,
    resetFollowups: followupRows.length
  };
}

export async function markAppointmentArrived(id: string, options?: { clinicId?: string | null }) {
  const sql = getSql();
  const clinicId = await resolveClinicId(options?.clinicId);
  const rows = await sql<AppointmentRow[]>`
    update mock_appointments
    set status = 'arrived',
      room_status = case
        when room_status = 'ready' then room_status
        else 'checked in'
      end,
      arrived_at = coalesce(arrived_at, now()),
      updated_at = now()
    where id = ${id}
      and clinic_id = ${clinicId}
    returning id, client_id, pet_id, appointment_date, appointment_time, appointment_type, doctor, status, wait_minutes, room_status, arrived_at, notes
  `;
  return rows[0] ? normalizeAppointment(rows[0]) : null;
}

export async function bookMockAppointment(input: {
  clinicId?: string | null;
  slotId: string;
  clientId: string;
  petId: string;
  reason?: string | null;
}) {
  const sql = getSql();
  const clinicId = await resolveClinicId(input.clinicId);
  const rows = await sql<AppointmentRow[]>`
    with selected_slot as (
      update mock_slots
      set available = false
      where id = ${input.slotId}
        and clinic_id = ${clinicId}
        and available = true
      returning id, slot_date, slot_time, doctor, appointment_type
    ),
    inserted as (
      insert into mock_appointments (
        id,
        clinic_id,
        client_id,
        pet_id,
        appointment_date,
        appointment_time,
        appointment_type,
        doctor,
        status,
        wait_minutes,
        room_status,
        notes
      )
      select
        ${`appointment-${input.slotId}-${input.petId}`},
        ${clinicId},
        ${input.clientId},
        ${input.petId},
        slot_date,
        slot_time,
        appointment_type,
        doctor,
        'scheduled',
        0,
        'waiting',
        ${input.reason ?? "Booked by VetAgent"}
      from selected_slot
      on conflict (id) do update
        set status = excluded.status,
          updated_at = now()
        where mock_appointments.clinic_id = ${clinicId}
      returning id, client_id, pet_id, appointment_date, appointment_time, appointment_type, doctor, status, wait_minutes, room_status, arrived_at, notes
    )
    select * from inserted
  `;
  return rows[0] ? normalizeAppointment(rows[0]) : null;
}

export async function listOpenFollowups(options?: { clinicId?: string | null }) {
  const sql = getSql();
  const clinicId = await resolveClinicId(options?.clinicId);
  const rows = await sql<FollowupRow[]>`
    select id, client_id, pet_id, followup_type, due_date, recommended_action, status
    from mock_followups
    where clinic_id = ${clinicId}
      and status = 'open'
    order by due_date asc
  `;
  return rows.map(normalizeFollowup);
}

export async function markFollowupContacted(id: string, options?: { clinicId?: string | null }) {
  const sql = getSql();
  const clinicId = await resolveClinicId(options?.clinicId);
  const rows = await sql<FollowupRow[]>`
    update mock_followups
    set status = 'contacted'
    where id = ${id}
      and clinic_id = ${clinicId}
    returning id, client_id, pet_id, followup_type, due_date, recommended_action, status
  `;
  return rows[0] ? normalizeFollowup(rows[0]) : null;
}
