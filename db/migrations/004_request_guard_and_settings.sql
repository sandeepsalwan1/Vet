create table if not exists app_settings (
  key text primary key,
  value text not null,
  updated_by_name text,
  updated_at timestamptz not null default now()
);

insert into app_settings (key, value)
values ('priority_alerts_enabled', 'false')
on conflict (key) do nothing;

create table if not exists request_guard_events (
  id uuid primary key default gen_random_uuid(),
  client_key_hash text not null,
  content_hash text not null,
  status text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_request_guard_client_created
  on request_guard_events (client_key_hash, created_at desc);

create index if not exists idx_request_guard_content_created
  on request_guard_events (content_hash, created_at desc);
