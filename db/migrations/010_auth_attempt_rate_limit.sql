create table if not exists auth_attempt_events (
  id uuid primary key default gen_random_uuid(),
  identity_hash text not null,
  actor_role text not null,
  success boolean not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_auth_attempt_events_identity_created
  on auth_attempt_events (identity_hash, created_at desc);

create index if not exists idx_auth_attempt_events_cleanup
  on auth_attempt_events (created_at);
