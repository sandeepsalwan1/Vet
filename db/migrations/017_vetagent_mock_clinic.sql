create table if not exists mock_clients (
  id text primary key,
  full_name text not null,
  phone text not null,
  email text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists mock_pets (
  id text primary key,
  client_id text not null references mock_clients(id) on delete cascade,
  name text not null,
  species text not null,
  breed text,
  age_years int,
  weight text,
  alerts text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into mock_clients (id, full_name, phone, email, notes)
values ('client-johnson', 'Avery Johnson', '(415) 555-0108', null, 'Fallback client for mock invoice repairs.')
on conflict (id) do nothing;

insert into mock_pets (id, client_id, name, species, breed, age_years, weight, alerts)
values ('pet-otis', 'client-johnson', 'Otis', 'Dog', null, null, null, null)
on conflict (id) do nothing;

create table if not exists mock_appointments (
  id text primary key,
  client_id text not null references mock_clients(id) on delete cascade,
  pet_id text not null references mock_pets(id) on delete cascade,
  appointment_date date not null,
  appointment_time time not null,
  appointment_type text not null,
  doctor text not null,
  status text not null default 'scheduled',
  wait_minutes int not null default 18,
  room_status text not null default 'waiting',
  arrived_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists mock_slots (
  id text primary key,
  slot_date date not null,
  slot_time time not null,
  doctor text not null,
  appointment_type text not null,
  available boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists mock_wait_statuses (
  id text primary key,
  label text not null,
  wait_minutes int not null,
  message text not null,
  updated_at timestamptz not null default now()
);

create table if not exists mock_followups (
  id text primary key,
  client_id text not null references mock_clients(id) on delete cascade,
  pet_id text not null references mock_pets(id) on delete cascade,
  followup_type text not null,
  due_date date not null,
  recommended_action text not null,
  status text not null default 'open',
  created_at timestamptz not null default now()
);

create table if not exists mock_invoices (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references mock_clients(id) on delete cascade,
  pet_id text not null references mock_pets(id) on delete cascade,
  invoice_number text not null,
  invoice_date date not null,
  total_cents int not null,
  status text not null,
  line_items jsonb not null default '[]',
  flags jsonb not null default '[]',
  created_at timestamptz not null default now()
);

alter table mock_invoices
  add column if not exists pet_id text references mock_pets(id) on delete cascade,
  add column if not exists invoice_number text,
  add column if not exists invoice_date date,
  add column if not exists total_cents int,
  add column if not exists line_items jsonb not null default '[]',
  add column if not exists flags jsonb not null default '[]';

alter table mock_invoices
  drop constraint if exists mock_invoices_client_id_fkey;

alter table mock_invoices
  alter column client_id type text using client_id::text;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'mock_invoices'
      and column_name = 'total_amount'
  ) then
    alter table mock_invoices
      alter column total_amount drop not null;
  end if;
end $$;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'mock_invoices'
      and column_name = 'total_amount'
  ) then
    update mock_invoices
    set
      client_id = case
        when client_id in (select id from mock_clients) then client_id
        else 'client-johnson'
      end,
      pet_id = coalesce(pet_id, 'pet-otis'),
      invoice_number = coalesce(invoice_number, id::text),
      invoice_date = coalesce(invoice_date, current_date),
      total_cents = coalesce(total_cents, total_amount, 0)
    where client_id not in (select id from mock_clients)
      or pet_id is null
      or invoice_number is null
      or invoice_date is null
      or total_cents is null;
  else
    update mock_invoices
    set
      client_id = case
        when client_id in (select id from mock_clients) then client_id
        else 'client-johnson'
      end,
      pet_id = coalesce(pet_id, 'pet-otis'),
      invoice_number = coalesce(invoice_number, id::text),
      invoice_date = coalesce(invoice_date, current_date),
      total_cents = coalesce(total_cents, 0)
    where client_id not in (select id from mock_clients)
      or pet_id is null
      or invoice_number is null
      or invoice_date is null
      or total_cents is null;
  end if;
end $$;

alter table mock_invoices
  alter column client_id set not null,
  add constraint mock_invoices_client_id_fkey
    foreign key (client_id) references mock_clients(id) on delete cascade;

create table if not exists mock_messages (
  id text primary key,
  client_id text references mock_clients(id) on delete set null,
  channel text not null,
  direction text not null,
  subject text,
  body text not null,
  intent_hint text,
  urgency text not null default 'normal',
  created_at timestamptz not null default now()
);

create table if not exists mock_call_transcripts (
  id uuid primary key default gen_random_uuid(),
  caller_name text not null,
  caller_phone text not null,
  transcript text not null,
  intent_hint text,
  created_at timestamptz not null default now()
);

alter table mock_call_transcripts
  add column if not exists caller_name text,
  add column if not exists caller_phone text,
  add column if not exists intent_hint text,
  add column if not exists created_at timestamptz not null default now();

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'mock_call_transcripts'
      and column_name = 'received_at'
  ) then
    update mock_call_transcripts
    set
      caller_name = coalesce(caller_name, 'Unknown caller'),
      caller_phone = coalesce(caller_phone, ''),
      created_at = coalesce(created_at, received_at, now())
    where caller_name is null
      or caller_phone is null
      or created_at is null;
  else
    update mock_call_transcripts
    set
      caller_name = coalesce(caller_name, 'Unknown caller'),
      caller_phone = coalesce(caller_phone, ''),
      created_at = coalesce(created_at, now())
    where caller_name is null
      or caller_phone is null
      or created_at is null;
  end if;
end $$;

create table if not exists mock_service_catalog (
  id text primary key,
  service_name text not null,
  category text not null,
  current_price_cents int not null,
  notes text,
  updated_at timestamptz not null default now()
);

create table if not exists pricing_observations (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  competitor_name text not null,
  service_name text not null,
  observed_price_cents int,
  observed_text text,
  url text,
  raw jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists idx_mock_appointments_date_status on mock_appointments(appointment_date, status);
create index if not exists idx_mock_slots_date_available on mock_slots(slot_date, available);
create index if not exists idx_mock_followups_status_due on mock_followups(status, due_date);
create index if not exists idx_pricing_observations_created on pricing_observations(created_at desc);
