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

create index if not exists idx_workflow_events_type_created
  on workflow_events(workflow_type, created_at desc);

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
