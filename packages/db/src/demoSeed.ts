import { resolveClinicId } from "./clinics";
import { getSql } from "./connection";

// Demo tenants (pims_provider = 'mock-clinic') carry a seeded clinic day so the
// public flows always have something to match. The seed rows store the day they
// are meant to land on (`demo_day_offset`), and this module rolls them onto the
// real calendar. Without it the demo silently dies the day after a deploy.
const refreshIntervalMs = 5 * 60 * 1000;
const historyDays = 28;
const visitsPerDay = 3;
const lastRefreshedAt = new Map<string, number>();

async function isDemoClinic(clinicId: string) {
  const sql = getSql();
  const rows = await sql<{ clinic_id: string }[]>`
    select clinic_id
    from client_journey_settings
    where clinic_id = ${clinicId}
      and pims_provider = 'mock-clinic'
    limit 1
  `;
  return rows.length > 0;
}

async function rollDemoDay(clinicId: string) {
  const sql = getSql();
  await sql`
    update mock_appointments
    set appointment_date = current_date + demo_day_offset,
      status = 'scheduled',
      room_status = 'waiting',
      arrived_at = null,
      updated_at = now()
    where clinic_id = ${clinicId}
      and demo_day_offset is not null
      and appointment_date <> current_date + demo_day_offset
  `;
  await sql`
    delete from mock_appointments
    where clinic_id = ${clinicId}
      and demo_day_offset is null
      and id like 'appointment-slot-%'
      and appointment_date < current_date
  `;
  await sql`
    update mock_slots
    set slot_date = current_date + demo_day_offset,
      available = coalesce(demo_available, available)
    where clinic_id = ${clinicId}
      and demo_day_offset is not null
      and slot_date <> current_date + demo_day_offset
  `;
  await sql`
    update mock_followups
    set due_date = current_date + demo_day_offset,
      status = 'open'
    where clinic_id = ${clinicId}
      and demo_day_offset is not null
      and due_date <> current_date + demo_day_offset
  `;
  // A room held by an arrival from an earlier clinic day never frees itself.
  await sql`
    update clinic_rooms
    set state = 'open',
      current_arrival_id = null,
      auto_open_at = null,
      state_changed_at = now(),
      updated_at = now()
    where clinic_id = ${clinicId}
      and current_arrival_id is not null
      and current_arrival_id in (
        select id
        from arrival_intakes
        where clinic_id = ${clinicId}
          and created_at < current_date
      )
  `;
}

// One history top-up per clinic per day, claimed in the database so concurrent
// instances do not repeat the backfill scan.
async function claimDailyHistoryTopUp(clinicId: string) {
  const sql = getSql();
  const rows = await sql<{ key: string }[]>`
    insert into app_settings (key, value, updated_at)
    select ${`clinic:${clinicId}:demo_history_day`}, current_date::text, now()
    on conflict (key) do update
      set value = excluded.value,
        updated_at = now()
      where app_settings.value is distinct from excluded.value
    returning key
  `;
  return rows.length > 0;
}

// A trailing month of completed visits so wait-time, retention, and follow-up
// analytics have something real to chart during a demo.
async function seedVisitHistory(clinicId: string) {
  const sql = getSql();
  await sql`
    with demo_pet as (
      select
        pet.client_id,
        pet.id as pet_id,
        row_number() over (order by pet.id) - 1 as position,
        count(*) over () as total
      from mock_pets pet
      where pet.clinic_id = ${clinicId}
    ),
    visit_day as (
      select (current_date - day_offset)::date as day
      from generate_series(1, ${historyDays}) as day_offset
      where extract(isodow from (current_date - day_offset)) < 6
    ),
    visit as (
      select
        demo_pet.client_id,
        demo_pet.pet_id,
        'demo-visit-' || to_char(visit_day.day, 'YYYYMMDD') || '-' || slot.slot_index as appointment_id,
        (visit_day.day
          + interval '8 hours 30 minutes'
          + (slot.slot_index * interval '2 hours 40 minutes')
          + ((abs(hashtext(visit_day.day::text || slot.slot_index)::bigint) % 35)::int * interval '1 minute')
        )::timestamptz as checked_in_at,
        abs(hashtext(visit_day.day::text || slot.slot_index || 'stage')::bigint) as noise
      from visit_day
      cross join generate_series(0, ${visitsPerDay - 1}) as slot(slot_index)
      join demo_pet
        on demo_pet.position = (
          (extract(doy from visit_day.day)::int * ${visitsPerDay} + slot.slot_index) % demo_pet.total
        )
    ),
    timed_visit as (
      select
        client_id,
        pet_id,
        appointment_id,
        checked_in_at,
        (5 + noise % 16)::int as room_wait,
        (3 + (noise / 7) % 9)::int as care_wait,
        (14 + (noise / 11) % 21)::int as care_length,
        (4 + (noise / 13) % 11)::int as checkout_wait
      from visit
    )
    insert into client_visit_stage_events (
      clinic_id,
      client_id,
      pet_id,
      appointment_id,
      stage,
      source,
      occurred_at
    )
    select
      ${clinicId},
      timed_visit.client_id,
      timed_visit.pet_id,
      timed_visit.appointment_id,
      stage_event.stage_name,
      'demo_history',
      stage_event.occurred
    from timed_visit
    cross join lateral (
      values
        ('checked_in', timed_visit.checked_in_at),
        ('roomed', timed_visit.checked_in_at + timed_visit.room_wait * interval '1 minute'),
        (
          'care_started',
          timed_visit.checked_in_at + (timed_visit.room_wait + timed_visit.care_wait) * interval '1 minute'
        ),
        (
          'care_complete',
          timed_visit.checked_in_at
            + (timed_visit.room_wait + timed_visit.care_wait + timed_visit.care_length) * interval '1 minute'
        ),
        (
          'checkout_complete',
          timed_visit.checked_in_at
            + (timed_visit.room_wait + timed_visit.care_wait + timed_visit.care_length + timed_visit.checkout_wait)
              * interval '1 minute'
        )
    ) as stage_event(stage_name, occurred)
    on conflict (clinic_id, appointment_id, stage) do nothing
  `;
}

// Journey emails and thumb responses drive the follow-up and sentiment cards.
async function seedJourneyHistory(clinicId: string) {
  const sql = getSql();
  await sql`
    with visit as (
      select
        client_id,
        pet_id,
        appointment_id,
        max(occurred_at) filter (where stage = 'checkout_complete') as checkout_at
      from client_visit_stage_events
      where clinic_id = ${clinicId}
        and source = 'demo_history'
      group by client_id, pet_id, appointment_id
      having max(occurred_at) filter (where stage = 'checkout_complete') is not null
    ),
    planned as (
      select
        visit.client_id,
        visit.pet_id,
        visit.appointment_id,
        note.message_type,
        note.subject,
        note.body,
        visit.checkout_at + note.send_delay as scheduled_for
      from visit
      cross join lateral (
        values
          (
            'visit_experience',
            'How was today''s visit?',
            'Thanks for bringing your pet in today. One tap tells us how the visit went.',
            interval '75 minutes'
          ),
          (
            'pet_health_check',
            'How is your pet doing?',
            'Checking in a day later: is your pet back to normal after the visit?',
            interval '24 hours'
          )
      ) as note(message_type, subject, body, send_delay)
      where visit.checkout_at + note.send_delay < now()
    )
    insert into client_journey_messages (
      clinic_id,
      client_id,
      pet_id,
      appointment_id,
      message_type,
      audience,
      channel,
      subject,
      body,
      scheduled_for,
      status,
      idempotency_key,
      sent_at
    )
    select
      ${clinicId},
      planned.client_id,
      planned.pet_id,
      planned.appointment_id,
      planned.message_type,
      'customer',
      'email',
      planned.subject,
      planned.body,
      planned.scheduled_for,
      'sent',
      'demo-history:' || planned.appointment_id || ':' || planned.message_type,
      planned.scheduled_for
    from planned
    on conflict (clinic_id, idempotency_key) do nothing
  `;
  await sql`
    insert into client_journey_responses (
      clinic_id,
      client_id,
      pet_id,
      appointment_id,
      response_type,
      sentiment,
      created_at
    )
    select
      ${clinicId},
      message.client_id,
      message.pet_id,
      message.appointment_id,
      case when message.message_type = 'visit_experience' then 'visit_experience' else 'pet_health' end,
      case when abs(hashtext(message.idempotency_key)::bigint) % 9 = 0 then 'down' else 'up' end,
      message.sent_at + ((20 + abs(hashtext(message.idempotency_key)::bigint) % 400)::int * interval '1 minute')
    from client_journey_messages message
    where message.clinic_id = ${clinicId}
      and message.idempotency_key like 'demo-history:%'
      and message.status = 'sent'
      -- Leave roughly a quarter unanswered so the follow-up call queue is real.
      and abs(hashtext(message.idempotency_key)::bigint) % 4 <> 0
      and message.sent_at + interval '7 hours' < now()
      and not exists (
        select 1
        from client_journey_responses existing
        where existing.clinic_id = message.clinic_id
          and existing.appointment_id = message.appointment_id
          and existing.response_type = (
            case when message.message_type = 'visit_experience' then 'visit_experience' else 'pet_health' end
          )
      )
  `;
}

async function refreshDemoClinic(clinicId: string) {
  if (!(await isDemoClinic(clinicId))) return;
  await rollDemoDay(clinicId);
  if (!(await claimDailyHistoryTopUp(clinicId))) return;
  await seedVisitHistory(clinicId);
  await seedJourneyHistory(clinicId);
}

// Called from demo-facing read paths. Never let seeding break a real request.
export async function ensureDemoDataFresh(options?: { clinicId?: string | null }) {
  const clinicId = await resolveClinicId(options?.clinicId);
  const lastRun = lastRefreshedAt.get(clinicId) ?? 0;
  if (Date.now() - lastRun < refreshIntervalMs) return clinicId;
  lastRefreshedAt.set(clinicId, Date.now());
  try {
    await refreshDemoClinic(clinicId);
  } catch {
    lastRefreshedAt.delete(clinicId);
  }
  return clinicId;
}
