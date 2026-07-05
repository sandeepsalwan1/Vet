import { resolveClinicId } from "./clinics";
import { getSql } from "./connection";
import {
  normalizeRoom,
  type RoomRow,
  type RoomState
} from "./arrivalIntakeRows";

export async function ensureArrivalSetup(options?: { clinicId?: string | null }) {
  const sql = getSql();
  const clinicId = await resolveClinicId(options?.clinicId);
  await sql`
    insert into arrival_settings (clinic_id)
    values (${clinicId})
    on conflict (clinic_id) do nothing
  `;
  await sql`
    insert into clinic_rooms (clinic_id, name, sort_order)
    select ${clinicId}, room.name, room.sort_order
    from (
      values
        ('Exam Room 1', 1),
        ('Exam Room 2', 2),
        ('Exam Room 3', 3),
        ('Exam Room 4', 4),
        ('Exam Room 5', 5),
        ('Exam Room 6', 6)
    ) as room(name, sort_order)
    where not exists (
      select 1 from clinic_rooms existing where existing.clinic_id = ${clinicId}
    )
    on conflict (clinic_id, name) do nothing
  `;
  return clinicId;
}

export async function autoOpenReadyRooms(options?: { clinicId?: string | null }) {
  const sql = getSql();
  const clinicId = await resolveClinicId(options?.clinicId);
  await sql`
    update clinic_rooms
    set state = 'open',
      current_arrival_id = null,
      auto_open_at = null,
      state_changed_at = now(),
      updated_at = now()
    where clinic_id = ${clinicId}
      and state = 'cleaning'
      and auto_open_at is not null
      and auto_open_at <= now()
  `;
}

export async function assignOpenRoom(clinicId: string, arrivalId: string) {
  const sql = getSql();
  const rows = await sql<RoomRow[]>`
    with candidate as (
      select id
      from clinic_rooms
      where clinic_id = ${clinicId}
        and state = 'open'
      order by sort_order asc, name asc
      limit 1
    )
    update clinic_rooms room
    set state = 'occupied',
      current_arrival_id = ${arrivalId},
      auto_open_at = null,
      state_changed_at = now(),
      updated_at = now()
    where room.id in (select id from candidate)
    returning id, clinic_id, name, sort_order, state, current_arrival_id, state_changed_at, auto_open_at, created_at, updated_at
  `;
  return rows[0] ? normalizeRoom(rows[0]) : null;
}

export async function updateClinicRoom(input: {
  clinicId?: string | null;
  roomId: string;
  state: RoomState;
}) {
  const sql = getSql();
  const clinicId = await resolveClinicId(input.clinicId);
  const rows = await sql<RoomRow[]>`
    update clinic_rooms
    set state = ${input.state},
      current_arrival_id = case when ${input.state} = 'occupied' then current_arrival_id else null end,
      auto_open_at = case when ${input.state} = 'cleaning' then now() + interval '10 minutes' else null end,
      state_changed_at = now(),
      updated_at = now()
    where clinic_id = ${clinicId}
      and id = ${input.roomId}
    returning id, clinic_id, name, sort_order, state, current_arrival_id, state_changed_at, auto_open_at, created_at, updated_at
  `;
  return rows[0] ? normalizeRoom(rows[0]) : null;
}

export async function checkoutArrivalRoom(input: {
  clinicId?: string | null;
  arrivalId: string;
}) {
  const sql = getSql();
  const clinicId = await resolveClinicId(input.clinicId);
  const rows = await sql<RoomRow[]>`
    update clinic_rooms
    set state = 'cleaning',
      current_arrival_id = null,
      auto_open_at = now() + interval '10 minutes',
      state_changed_at = now(),
      updated_at = now()
    where clinic_id = ${clinicId}
      and current_arrival_id = ${input.arrivalId}
    returning id, clinic_id, name, sort_order, state, current_arrival_id, state_changed_at, auto_open_at, created_at, updated_at
  `;
  return rows[0] ? normalizeRoom(rows[0]) : null;
}
