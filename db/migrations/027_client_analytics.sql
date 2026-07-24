alter table client_journey_settings
  add column if not exists followup_call_delay_hours integer not null default 48;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'client_journey_settings_followup_call_delay_check'
  ) then
    alter table client_journey_settings
      add constraint client_journey_settings_followup_call_delay_check
      check (followup_call_delay_hours between 4 and 336);
  end if;
end $$;

create table if not exists client_visit_stage_events (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  client_id text,
  pet_id text,
  appointment_id text not null,
  stage text not null check (
    stage in (
      'checked_in',
      'roomed',
      'care_started',
      'care_complete',
      'checkout_complete'
    )
  ),
  source text not null,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (clinic_id, appointment_id, stage)
);

create index if not exists idx_client_visit_stages_clinic_occurred
  on client_visit_stage_events(clinic_id, occurred_at desc);

create index if not exists idx_client_visit_stages_clinic_client
  on client_visit_stage_events(clinic_id, client_id, occurred_at desc);

insert into client_visit_stage_events (
  clinic_id,
  client_id,
  pet_id,
  appointment_id,
  stage,
  source,
  occurred_at
)
select distinct on (clinic_id, appointment_id)
  clinic_id,
  client_id,
  pet_id,
  appointment_id,
  'checked_in',
  'arrival_backfill',
  created_at
from arrival_intakes
where appointment_id is not null
  and status = 'checked_in'
order by clinic_id, appointment_id, created_at
on conflict (clinic_id, appointment_id, stage) do nothing;

insert into client_visit_stage_events (
  clinic_id,
  client_id,
  pet_id,
  appointment_id,
  stage,
  source,
  occurred_at
)
select distinct on (clinic_id, appointment_id)
  clinic_id,
  client_id,
  pet_id,
  appointment_id,
  'roomed',
  'arrival_backfill',
  updated_at
from arrival_intakes
where appointment_id is not null
  and status = 'checked_in'
  and room_id is not null
order by clinic_id, appointment_id, updated_at
on conflict (clinic_id, appointment_id, stage) do nothing;

insert into client_visit_stage_events (
  clinic_id,
  client_id,
  pet_id,
  appointment_id,
  stage,
  source,
  occurred_at
)
select distinct on (clinic_id, appointment_id, stage)
  clinic_id,
  client_id,
  pet_id,
  appointment_id,
  stage,
  'journey_backfill',
  occurred_at
from (
  select
    clinic_id,
    client_id,
    pet_id,
    appointment_id,
    case
      when event_type = 'hospitalized_update' then 'care_started'
      when event_type = 'ready_for_pickup' then 'care_complete'
      else 'checkout_complete'
    end as stage,
    occurred_at
  from client_journey_events
  where appointment_id is not null
    and event_type in ('hospitalized_update', 'ready_for_pickup', 'checkout')
) journey_stage
order by clinic_id, appointment_id, stage, occurred_at
on conflict (clinic_id, appointment_id, stage) do nothing;

revoke all on table client_visit_stage_events from anon, authenticated;
