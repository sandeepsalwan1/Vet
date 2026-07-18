create table if not exists client_journey_settings (
  clinic_id uuid primary key references clinics(id) on delete cascade,
  public_name text not null,
  family_story text not null default '',
  primary_domain text,
  pims_provider text not null default 'unconfigured',
  pims_mode text not null default 'adapter',
  confirmation_email_enabled boolean not null default true,
  reminder_email_hours integer not null default 48 check (reminder_email_hours between 1 and 336),
  reminder_sms_hours integer not null default 24 check (reminder_sms_hours between 1 and 336),
  reminder_sms_enabled boolean not null default true,
  quiet_hours_start time not null default '20:00',
  quiet_hours_end time not null default '08:00',
  feedback_delay_minutes integer not null default 75 check (feedback_delay_minutes between 15 and 1440),
  pet_check_delay_hours integer not null default 24 check (pet_check_delay_hours between 4 and 168),
  room_pressure_numerator integer not null default 2 check (room_pressure_numerator > 0),
  room_pressure_denominator integer not null default 3 check (room_pressure_denominator > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists client_contact_preferences (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  client_id text not null,
  email text,
  phone text,
  email_enabled boolean not null default true,
  sms_consent boolean not null default false,
  sms_consented_at timestamptz,
  sms_consent_source text,
  preferred_channel text not null default 'email' check (preferred_channel in ('email', 'sms', 'both')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (clinic_id, client_id)
);

create table if not exists client_account_claims (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  requester_hash text not null,
  matched_client_id text,
  matched_pet_id text,
  delivery_channel text,
  destination_hint text,
  code_hash text,
  code_salt text,
  status text not null default 'pending' check (status in ('pending', 'verified', 'pending_staff_review', 'expired', 'locked')),
  attempts integer not null default 0,
  expires_at timestamptz,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists client_portal_access_grants (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  client_id text not null,
  pet_id text,
  token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists client_journey_events (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  client_id text,
  pet_id text,
  appointment_id text,
  event_type text not null,
  audience text not null default 'customer' check (audience in ('customer', 'employee', 'both')),
  source text not null default 'staff',
  summary text not null,
  metadata jsonb not null default '{}',
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists client_journey_messages (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  client_id text,
  pet_id text,
  appointment_id text,
  event_id uuid references client_journey_events(id) on delete set null,
  message_type text not null,
  audience text not null default 'customer' check (audience in ('customer', 'employee')),
  channel text not null check (channel in ('email', 'sms', 'portal')),
  subject text,
  body text not null,
  scheduled_for timestamptz not null,
  status text not null default 'planned' check (status in ('planned', 'sent', 'skipped', 'cancelled', 'failed')),
  idempotency_key text not null,
  cancellation_reason text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (clinic_id, idempotency_key)
);

create table if not exists client_journey_responses (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  client_id text not null,
  pet_id text,
  appointment_id text,
  response_type text not null check (response_type in ('visit_experience', 'pet_health')),
  sentiment text not null check (sentiment in ('up', 'down')),
  comment text,
  followup_task_id uuid references tasks(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists client_record_releases (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  client_id text not null,
  pet_id text,
  recipient_name text not null,
  recipient_destination text not null,
  record_scope text not null,
  confirmed_at timestamptz not null,
  status text not null default 'requested' check (status in ('requested', 'processing', 'sent', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table client_contact_preferences alter column client_id type text using client_id::text;
alter table client_account_claims alter column matched_client_id type text using matched_client_id::text;
alter table client_account_claims alter column matched_pet_id type text using matched_pet_id::text;
alter table client_portal_access_grants alter column client_id type text using client_id::text;
alter table client_portal_access_grants alter column pet_id type text using pet_id::text;
alter table client_journey_events alter column client_id type text using client_id::text;
alter table client_journey_events alter column pet_id type text using pet_id::text;
alter table client_journey_events alter column appointment_id type text using appointment_id::text;
alter table client_journey_messages alter column client_id type text using client_id::text;
alter table client_journey_messages alter column pet_id type text using pet_id::text;
alter table client_journey_messages alter column appointment_id type text using appointment_id::text;
alter table client_journey_responses alter column client_id type text using client_id::text;
alter table client_journey_responses alter column pet_id type text using pet_id::text;
alter table client_journey_responses alter column appointment_id type text using appointment_id::text;
alter table client_record_releases alter column client_id type text using client_id::text;
alter table client_record_releases alter column pet_id type text using pet_id::text;

create index if not exists idx_client_claims_clinic_requester_created
  on client_account_claims(clinic_id, requester_hash, created_at desc);
create index if not exists idx_client_grants_clinic_client
  on client_portal_access_grants(clinic_id, client_id, expires_at desc);
create index if not exists idx_client_journey_events_client_occurred
  on client_journey_events(clinic_id, client_id, occurred_at desc);
create index if not exists idx_client_journey_messages_due
  on client_journey_messages(clinic_id, status, scheduled_for);
create index if not exists idx_client_journey_responses_client_created
  on client_journey_responses(clinic_id, client_id, created_at desc);
create unique index if not exists idx_client_journey_responses_once
  on client_journey_responses(clinic_id, client_id, pet_id, appointment_id, response_type) nulls not distinct;

alter table tasks add column if not exists idempotency_key text;
create unique index if not exists idx_tasks_clinic_idempotency_key
  on tasks(clinic_id, idempotency_key)
  where idempotency_key is not null;

revoke all on table client_journey_settings from anon, authenticated;
revoke all on table client_contact_preferences from anon, authenticated;
revoke all on table client_account_claims from anon, authenticated;
revoke all on table client_portal_access_grants from anon, authenticated;
revoke all on table client_journey_events from anon, authenticated;
revoke all on table client_journey_messages from anon, authenticated;
revoke all on table client_journey_responses from anon, authenticated;
revoke all on table client_record_releases from anon, authenticated;

with central as (
  select id from clinics where slug = 'central-vet'
)
insert into client_journey_settings (
  clinic_id,
  public_name,
  family_story,
  primary_domain,
  pims_provider,
  pims_mode
)
select
  id,
  'Tri-City Veterinary Hospital',
  'Family-run since 1986, with three generations serving local pets and their people.',
  'tricityvet.eepish.com',
  'mock-clinic',
  'adapter'
from central
on conflict (clinic_id) do nothing;

with central as (
  select id from clinics where slug = 'central-vet'
)
insert into clinic_domains (clinic_id, hostname, is_primary)
select id, 'tricityvet.eepish.com', true
from central
on conflict (hostname) do update set
  clinic_id = excluded.clinic_id,
  is_primary = excluded.is_primary,
  updated_at = now();

with central as (
  select id from clinics where slug = 'central-vet'
)
insert into client_contact_preferences (clinic_id, client_id, email, phone, sms_consent, sms_consented_at, sms_consent_source, preferred_channel)
select client.clinic_id, client.id, client.email, client.phone, false, null, null, 'email'
from mock_clients client
join central on central.id = client.clinic_id
where lower(client.full_name) = 'maya parker'
on conflict (clinic_id, client_id) do nothing;
