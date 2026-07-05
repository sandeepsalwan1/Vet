create table if not exists agent_runs (
  id uuid primary key default gen_random_uuid(),
  agent text not null,
  intent text not null,
  mode text not null default 'mock',
  status text not null default 'completed',
  input jsonb not null default '{}',
  output jsonb not null default '{}',
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists workflow_events (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references agent_runs(id) on delete set null,
  workflow_type text not null,
  event_type text not null,
  title text not null,
  detail text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

alter table workflow_events
  add column if not exists workflow_type text,
  add column if not exists title text,
  add column if not exists detail text,
  add column if not exists metadata jsonb not null default '{}';

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'workflow_events'
      and column_name = 'tool_name'
  ) and exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'workflow_events'
      and column_name = 'payload'
  ) then
    update workflow_events
    set
      workflow_type = coalesce(workflow_type, tool_name, event_type, 'workflow'),
      title = coalesce(title, event_type, 'Workflow event'),
      metadata = coalesce(metadata, payload, '{}'::jsonb)
    where workflow_type is null
      or title is null
      or metadata is null;
  else
    update workflow_events
    set
      workflow_type = coalesce(workflow_type, event_type, 'workflow'),
      title = coalesce(title, event_type, 'Workflow event'),
      metadata = coalesce(metadata, '{}'::jsonb)
    where workflow_type is null
      or title is null
      or metadata is null;
  end if;
end $$;

alter table workflow_events
  drop constraint if exists workflow_events_run_id_fkey;

alter table workflow_events
  alter column run_id drop not null;

update workflow_events
set run_id = null
where run_id is not null
  and run_id not in (select id from agent_runs);

alter table workflow_events
  add constraint workflow_events_run_id_fkey
    foreign key (run_id) references agent_runs(id) on delete set null;

create table if not exists approvals (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references agent_runs(id) on delete set null,
  task_id uuid references tasks(id) on delete set null,
  approval_type text not null,
  status text not null default 'pending',
  title text not null,
  summary text not null,
  requested_action jsonb not null default '{}',
  decided_by_name text,
  decided_by_role app_role,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists agent_reports (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references agent_runs(id) on delete set null,
  task_id uuid references tasks(id) on delete set null,
  report_type text not null,
  title text not null,
  summary text not null,
  data jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists idx_agent_runs_agent_created on agent_runs(agent, created_at desc);
create index if not exists idx_workflow_events_run_created on workflow_events(run_id, created_at asc);
create index if not exists idx_workflow_events_type_created on workflow_events(workflow_type, created_at desc);
create index if not exists idx_approvals_status_created on approvals(status, created_at desc);
create index if not exists idx_agent_reports_type_created on agent_reports(report_type, created_at desc);
