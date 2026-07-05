create table if not exists clinics (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  time_zone text not null default 'America/Los_Angeles',
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists clinic_domains (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  hostname text not null unique,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into clinics (slug, name, time_zone)
values (
  'central-vet',
  coalesce(nullif(current_setting('app.hospital_name', true), ''), 'Central Veterinary Hospital'),
  'America/Los_Angeles'
)
on conflict (slug) do update set
  name = excluded.name,
  updated_at = now();

with central as (
  select id from clinics where slug = 'central-vet'
)
insert into clinic_domains (clinic_id, hostname, is_primary)
select id, hostname, is_primary
from central
cross join (
  values
    ('vetagent-internal.onrender.com', true),
    ('central-vet.eepish.com', true),
    ('central-vet.vet.eepish.com', true),
    ('localhost', false),
    ('127.0.0.1', false)
) as domains(hostname, is_primary)
on conflict (hostname) do update set
  clinic_id = excluded.clinic_id,
  is_primary = excluded.is_primary,
  updated_at = now();

alter table tasks add column if not exists clinic_id uuid;
alter table task_events add column if not exists clinic_id uuid;
alter table notification_events add column if not exists clinic_id uuid;
alter table request_guard_events add column if not exists clinic_id uuid;
alter table auth_attempt_events add column if not exists clinic_id uuid;
alter table agent_runs add column if not exists clinic_id uuid;
alter table workflow_events add column if not exists clinic_id uuid;
alter table approvals add column if not exists clinic_id uuid;
alter table agent_reports add column if not exists clinic_id uuid;
alter table agent_tool_calls add column if not exists clinic_id uuid;
alter table mock_clients add column if not exists clinic_id uuid;
alter table mock_pets add column if not exists clinic_id uuid;
alter table mock_appointments add column if not exists clinic_id uuid;
alter table mock_slots add column if not exists clinic_id uuid;
alter table mock_wait_statuses add column if not exists clinic_id uuid;
alter table mock_followups add column if not exists clinic_id uuid;
alter table mock_invoices add column if not exists clinic_id uuid;
alter table mock_messages add column if not exists clinic_id uuid;
alter table mock_call_transcripts add column if not exists clinic_id uuid;
alter table mock_service_catalog add column if not exists clinic_id uuid;
alter table pricing_observations add column if not exists clinic_id uuid;
alter table mock_lab_catalog add column if not exists clinic_id uuid;
alter table mock_lab_orders add column if not exists clinic_id uuid;
alter table mock_lab_results add column if not exists clinic_id uuid;

do $$
declare
  central_id uuid;
begin
  select id into central_id from clinics where slug = 'central-vet';

  update tasks set clinic_id = central_id where clinic_id is null;
  update task_events set clinic_id = central_id where clinic_id is null;
  update notification_events set clinic_id = central_id where clinic_id is null;
  update request_guard_events set clinic_id = central_id where clinic_id is null;
  update auth_attempt_events set clinic_id = central_id where clinic_id is null;
  update agent_runs set clinic_id = central_id where clinic_id is null;
  update workflow_events set clinic_id = central_id where clinic_id is null;
  update approvals set clinic_id = central_id where clinic_id is null;
  update agent_reports set clinic_id = central_id where clinic_id is null;
  update agent_tool_calls set clinic_id = central_id where clinic_id is null;
  update mock_clients set clinic_id = central_id where clinic_id is null;
  update mock_pets set clinic_id = central_id where clinic_id is null;
  update mock_appointments set clinic_id = central_id where clinic_id is null;
  update mock_slots set clinic_id = central_id where clinic_id is null;
  update mock_wait_statuses set clinic_id = central_id where clinic_id is null;
  update mock_followups set clinic_id = central_id where clinic_id is null;
  update mock_invoices set clinic_id = central_id where clinic_id is null;
  update mock_messages set clinic_id = central_id where clinic_id is null;
  update mock_call_transcripts set clinic_id = central_id where clinic_id is null;
  update mock_service_catalog set clinic_id = central_id where clinic_id is null;
  update pricing_observations set clinic_id = central_id where clinic_id is null;
  update mock_lab_catalog set clinic_id = central_id where clinic_id is null;
  update mock_lab_orders set clinic_id = central_id where clinic_id is null;
  update mock_lab_results set clinic_id = central_id where clinic_id is null;
end $$;

create or replace function default_clinic_id()
returns uuid
language sql
stable
as $$
  select id from clinics where slug = 'central-vet' limit 1;
$$;

alter table tasks alter column clinic_id set default default_clinic_id();
alter table task_events alter column clinic_id set default default_clinic_id();
alter table notification_events alter column clinic_id set default default_clinic_id();
alter table request_guard_events alter column clinic_id set default default_clinic_id();
alter table auth_attempt_events alter column clinic_id set default default_clinic_id();
alter table agent_runs alter column clinic_id set default default_clinic_id();
alter table workflow_events alter column clinic_id set default default_clinic_id();
alter table approvals alter column clinic_id set default default_clinic_id();
alter table agent_reports alter column clinic_id set default default_clinic_id();
alter table agent_tool_calls alter column clinic_id set default default_clinic_id();
alter table mock_clients alter column clinic_id set default default_clinic_id();
alter table mock_pets alter column clinic_id set default default_clinic_id();
alter table mock_appointments alter column clinic_id set default default_clinic_id();
alter table mock_slots alter column clinic_id set default default_clinic_id();
alter table mock_wait_statuses alter column clinic_id set default default_clinic_id();
alter table mock_followups alter column clinic_id set default default_clinic_id();
alter table mock_invoices alter column clinic_id set default default_clinic_id();
alter table mock_messages alter column clinic_id set default default_clinic_id();
alter table mock_call_transcripts alter column clinic_id set default default_clinic_id();
alter table mock_service_catalog alter column clinic_id set default default_clinic_id();
alter table pricing_observations alter column clinic_id set default default_clinic_id();
alter table mock_lab_catalog alter column clinic_id set default default_clinic_id();
alter table mock_lab_orders alter column clinic_id set default default_clinic_id();
alter table mock_lab_results alter column clinic_id set default default_clinic_id();

alter table tasks alter column clinic_id set not null;
alter table task_events alter column clinic_id set not null;
alter table notification_events alter column clinic_id set not null;
alter table request_guard_events alter column clinic_id set not null;
alter table auth_attempt_events alter column clinic_id set not null;
alter table agent_runs alter column clinic_id set not null;
alter table workflow_events alter column clinic_id set not null;
alter table approvals alter column clinic_id set not null;
alter table agent_reports alter column clinic_id set not null;
alter table agent_tool_calls alter column clinic_id set not null;
alter table mock_clients alter column clinic_id set not null;
alter table mock_pets alter column clinic_id set not null;
alter table mock_appointments alter column clinic_id set not null;
alter table mock_slots alter column clinic_id set not null;
alter table mock_wait_statuses alter column clinic_id set not null;
alter table mock_followups alter column clinic_id set not null;
alter table mock_invoices alter column clinic_id set not null;
alter table mock_messages alter column clinic_id set not null;
alter table mock_call_transcripts alter column clinic_id set not null;
alter table mock_service_catalog alter column clinic_id set not null;
alter table pricing_observations alter column clinic_id set not null;
alter table mock_lab_catalog alter column clinic_id set not null;
alter table mock_lab_orders alter column clinic_id set not null;
alter table mock_lab_results alter column clinic_id set not null;

drop index if exists idx_notification_events_idempotency_key;
create unique index if not exists idx_notification_events_clinic_idempotency_key
  on notification_events(clinic_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists idx_tasks_clinic_status_due_date on tasks(clinic_id, status, due_date);
create index if not exists idx_task_events_clinic_created on task_events(clinic_id, created_at desc);
create index if not exists idx_request_guard_clinic_client_created on request_guard_events(clinic_id, client_key_hash, created_at desc);
create index if not exists idx_request_guard_clinic_content_created on request_guard_events(clinic_id, content_hash, created_at desc);
create index if not exists idx_auth_attempt_clinic_identity_created on auth_attempt_events(clinic_id, identity_hash, created_at desc);
create index if not exists idx_agent_runs_clinic_created on agent_runs(clinic_id, created_at desc);
create index if not exists idx_workflow_events_clinic_created on workflow_events(clinic_id, created_at desc);
create index if not exists idx_approvals_clinic_status_created on approvals(clinic_id, status, created_at desc);
create index if not exists idx_agent_reports_clinic_type_created on agent_reports(clinic_id, report_type, created_at desc);
create index if not exists idx_agent_tool_calls_clinic_run_sequence on agent_tool_calls(clinic_id, run_id, sequence);
create index if not exists idx_mock_clients_clinic_name on mock_clients(clinic_id, full_name);
create index if not exists idx_mock_pets_clinic_client on mock_pets(clinic_id, client_id);
create index if not exists idx_mock_appointments_clinic_date on mock_appointments(clinic_id, appointment_date, appointment_time);
create index if not exists idx_mock_slots_clinic_available on mock_slots(clinic_id, available, slot_date, slot_time);
create index if not exists idx_pricing_observations_clinic_created on pricing_observations(clinic_id, created_at desc);
