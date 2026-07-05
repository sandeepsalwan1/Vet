create extension if not exists pgcrypto;

do $$
begin
  create type app_role as enum ('staff', 'task_adder', 'veterinarian');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type task_status as enum ('pending_review', 'due', 'pending', 'completed', 'invalid', 'archived');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type task_source as enum ('client_form', 'task_adder', 'staff_request', 'veterinarian');
exception
  when duplicate_object then null;
end $$;

create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  hospital_name text not null default 'Central Veterinary Hospital',
  status task_status not null default 'pending_review',
  source task_source not null,
  client_name text,
  client_phone text,
  client_date_of_birth date,
  pet_name text,
  pet_weight text,
  last_visit date,
  request text not null,
  notes text,
  assigned_to text,
  due_date date not null default current_date,
  created_by_name text,
  created_by_role app_role,
  updated_by_name text,
  completed_by_name text,
  completed_at timestamptz,
  invalid_reason text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists task_events (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id) on delete cascade,
  actor_name text,
  actor_role app_role,
  event_type text not null,
  previous_status task_status,
  next_status task_status,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists notification_events (
  id uuid primary key default gen_random_uuid(),
  task_id uuid references tasks(id) on delete set null,
  notification_type text not null,
  recipient text not null,
  status text not null default 'pending',
  resend_id text,
  error text,
  idempotency_key text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create index if not exists idx_tasks_status_due_date on tasks(status, due_date);
create index if not exists idx_tasks_archived_at on tasks(archived_at);
create index if not exists idx_task_events_task_created on task_events(task_id, created_at desc);
