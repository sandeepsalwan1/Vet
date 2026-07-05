import { getSql } from "./connection";
import { resolveClinicId } from "./clinics";
import {
  assignOpenRoom,
  autoOpenReadyRooms,
  ensureArrivalSetup
} from "./arrivalRooms";
import {
  normalizeArrival,
  normalizeMatch,
  normalizeRoom,
  normalizeSettings,
  type ArrivalDeskSnapshot,
  type ArrivalMatch,
  type ArrivalQuestionnaire,
  type ArrivalRow,
  type MatchRow,
  type RoomRow,
  type SettingsRow
} from "./arrivalIntakeRows";

export {
  checkoutArrivalRoom,
  updateClinicRoom
} from "./arrivalRooms";

export type {
  ArrivalDeskSnapshot,
  ArrivalIntake,
  ArrivalMatch,
  ArrivalQuestionnaire,
  ArrivalSettings,
  ClinicRoom,
  RoomState
} from "./arrivalIntakeRows";

function jsonInput(value: Record<string, unknown>) {
  return value as never;
}

function cleanText(value: string | null | undefined) {
  return value?.toLowerCase().replace(/[^a-z0-9]/g, "") ?? "";
}

function lastName(value: string | null | undefined) {
  const parts = value?.trim().split(/\s+/).filter(Boolean) ?? [];
  return parts.at(-1) ?? "";
}

function phoneDigits(value: string | null | undefined) {
  const digits = value?.replace(/\D/g, "") ?? "";
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
}

export async function getArrivalSettings(options?: { clinicId?: string | null }) {
  const sql = getSql();
  const clinicId = await ensureArrivalSetup({ clinicId: options?.clinicId });
  const rows = await sql<SettingsRow[]>`
    select room_assignment_enabled, questionnaire
    from arrival_settings
    where clinic_id = ${clinicId}
    limit 1
  `;
  return normalizeSettings(rows[0]);
}

export async function listArrivalDesk(options?: { clinicId?: string | null }): Promise<ArrivalDeskSnapshot> {
  const sql = getSql();
  const clinicId = await ensureArrivalSetup({ clinicId: options?.clinicId });
  await autoOpenReadyRooms({ clinicId });
  const [settingRows, roomRows, arrivalRows] = await Promise.all([
    sql<SettingsRow[]>`
      select room_assignment_enabled, questionnaire
      from arrival_settings
      where clinic_id = ${clinicId}
      limit 1
    `,
    sql<RoomRow[]>`
      select id, clinic_id, name, sort_order, state, current_arrival_id, state_changed_at, auto_open_at, created_at, updated_at
      from clinic_rooms
      where clinic_id = ${clinicId}
      order by sort_order asc, name asc
    `,
    sql<ArrivalRow[]>`
      select id, clinic_id, status, appointment_id, client_id, pet_id, client_name, client_phone, pet_name, visit_reason, answers, room_id, room_name, pims_write_status, pims_write_summary, exception_reason, created_at, updated_at
      from arrival_intakes
      where clinic_id = ${clinicId}
        and created_at >= now() - interval '18 hours'
      order by created_at desc
      limit 80
    `
  ]);
  return {
    settings: normalizeSettings(settingRows[0]),
    rooms: roomRows.map(normalizeRoom),
    arrivals: arrivalRows.map(normalizeArrival)
  };
}

export async function matchArrivalIdentity(input: {
  clinicId?: string | null;
  lastName?: string | null;
  clientName?: string | null;
  clientPhone?: string | null;
  petName?: string | null;
}) {
  const sql = getSql();
  const clinicId = await resolveClinicId(input.clinicId);
  const expectedLastName = cleanText(input.lastName || lastName(input.clientName));
  const phone = phoneDigits(input.clientPhone);
  const pet = cleanText(input.petName);
  if (expectedLastName.length < 2 || phone.length !== 10 || pet.length < 2) return null;

  const rows = await sql<MatchRow[]>`
    select
      appointment.id as appointment_id,
      appointment.client_id,
      appointment.pet_id,
      client.full_name as client_name,
      client.phone as client_phone,
      pet.name as pet_name,
      appointment.appointment_date,
      appointment.appointment_time,
      appointment.appointment_type,
      appointment.doctor,
      appointment.status,
      appointment.wait_minutes
    from mock_appointments appointment
    join mock_clients client on client.id = appointment.client_id and client.clinic_id = appointment.clinic_id
    join mock_pets pet on pet.id = appointment.pet_id and pet.clinic_id = appointment.clinic_id
    where appointment.clinic_id = ${clinicId}
      and appointment.appointment_date = current_date
      and appointment.status in ('scheduled', 'arrived')
    order by appointment.appointment_time asc
  `;

  const matches = rows.filter((row) => {
    const recordPhone = phoneDigits(row.client_phone);
    const phoneMatch = recordPhone === phone;
    const lastNameMatch = cleanText(lastName(row.client_name)) === expectedLastName;
    const petMatch = cleanText(row.pet_name) === pet;
    return phoneMatch && lastNameMatch && petMatch;
  });
  return matches.length === 1 ? normalizeMatch(matches[0]) : null;
}

function intakeSummary(input: {
  match: ArrivalMatch;
  visitReason: string;
  answers: Record<string, unknown>;
  roomName?: string | null;
}) {
  const parts = [
    `${input.match.petName} checked in for ${input.visitReason}.`,
    `Appointment ${input.match.appointmentTime} with ${input.match.doctor}.`,
    input.roomName ? `Assigned ${input.roomName}.` : "No room assigned.",
    `Answers: ${JSON.stringify(input.answers)}`
  ];
  return parts.join(" ");
}

export async function createArrivalException(input: {
  clinicId?: string | null;
  clientName?: string | null;
  lastName?: string | null;
  clientPhone?: string | null;
  petName?: string | null;
  reason?: string | null;
}) {
  const sql = getSql();
  const clinicId = await resolveClinicId(input.clinicId);
  const rows = await sql<ArrivalRow[]>`
    insert into arrival_intakes (
      clinic_id,
      status,
      client_name,
      client_phone,
      pet_name,
      exception_reason,
      pims_write_status,
      pims_write_summary
    )
    values (
      ${clinicId},
      'exception',
      ${input.clientName ?? input.lastName ?? null},
      ${input.clientPhone ?? null},
      ${input.petName ?? null},
      ${input.reason ?? "No unique current appointment matched the submitted identity."},
      'not_written',
      'Front desk identity help needed before automated check-in.'
    )
    returning id, clinic_id, status, appointment_id, client_id, pet_id, client_name, client_phone, pet_name, visit_reason, answers, room_id, room_name, pims_write_status, pims_write_summary, exception_reason, created_at, updated_at
  `;
  return normalizeArrival(rows[0]);
}

export async function submitMatchedArrival(input: {
  clinicId?: string | null;
  match: ArrivalMatch;
  visitReason: string;
  answers: Record<string, unknown>;
}) {
  const sql = getSql();
  const clinicId = await ensureArrivalSetup({ clinicId: input.clinicId });
  const existing = await sql<ArrivalRow[]>`
    select id, clinic_id, status, appointment_id, client_id, pet_id, client_name, client_phone, pet_name, visit_reason, answers, room_id, room_name, pims_write_status, pims_write_summary, exception_reason, created_at, updated_at
    from arrival_intakes
    where clinic_id = ${clinicId}
      and appointment_id = ${input.match.appointmentId}
      and status = 'checked_in'
      and created_at >= current_date
    order by created_at desc
    limit 1
  `;
  if (existing[0]) return normalizeArrival(existing[0]);

  const setting = await getArrivalSettings({ clinicId });
  const rows = await sql<ArrivalRow[]>`
    insert into arrival_intakes (
      clinic_id,
      status,
      appointment_id,
      client_id,
      pet_id,
      client_name,
      client_phone,
      pet_name,
      visit_reason,
      answers,
      pims_write_status
    )
    values (
      ${clinicId},
      'checked_in',
      ${input.match.appointmentId},
      ${input.match.clientId},
      ${input.match.petId},
      ${input.match.clientName},
      ${input.match.clientPhone},
      ${input.match.petName},
      ${input.visitReason},
      ${sql.json(jsonInput(input.answers))},
      'mock_written'
    )
    returning id, clinic_id, status, appointment_id, client_id, pet_id, client_name, client_phone, pet_name, visit_reason, answers, room_id, room_name, pims_write_status, pims_write_summary, exception_reason, created_at, updated_at
  `;
  let arrival = normalizeArrival(rows[0]);
  const room = setting.roomAssignmentEnabled ? await assignOpenRoom(clinicId, arrival.id) : null;
  const summary = intakeSummary({
    match: input.match,
    visitReason: input.visitReason,
    answers: input.answers,
    roomName: room?.name ?? null
  });
  const updated = await sql<ArrivalRow[]>`
    update arrival_intakes
    set room_id = ${room?.id ?? null},
      room_name = ${room?.name ?? null},
      pims_write_summary = ${summary},
      updated_at = now()
    where id = ${arrival.id}
      and clinic_id = ${clinicId}
    returning id, clinic_id, status, appointment_id, client_id, pet_id, client_name, client_phone, pet_name, visit_reason, answers, room_id, room_name, pims_write_status, pims_write_summary, exception_reason, created_at, updated_at
  `;
  arrival = normalizeArrival(updated[0]);
  await sql`
    update mock_appointments
    set status = 'arrived',
      room_status = ${room?.name ?? "checked in"},
      arrived_at = coalesce(arrived_at, now()),
      updated_at = now()
    where clinic_id = ${clinicId}
      and id = ${input.match.appointmentId}
  `;
  return arrival;
}

export async function updateArrivalSettings(input: {
  clinicId?: string | null;
  roomAssignmentEnabled: boolean;
  questionnaire: ArrivalQuestionnaire;
}) {
  const sql = getSql();
  const clinicId = await ensureArrivalSetup({ clinicId: input.clinicId });
  const rows = await sql<SettingsRow[]>`
    insert into arrival_settings (
      clinic_id,
      room_assignment_enabled,
      questionnaire
    )
    values (
      ${clinicId},
      ${input.roomAssignmentEnabled},
      ${sql.json(jsonInput(input.questionnaire))}
    )
    on conflict (clinic_id) do update set
      room_assignment_enabled = excluded.room_assignment_enabled,
      questionnaire = excluded.questionnaire,
      updated_at = now()
    returning room_assignment_enabled, questionnaire
  `;
  return normalizeSettings(rows[0]);
}
