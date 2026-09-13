create table if not exists platform_usage_events (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  actor_key_hash text not null,
  actor_role app_role not null,
  activity_bucket timestamptz not null,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (clinic_id, actor_key_hash, activity_bucket)
);

create index if not exists idx_platform_usage_occurred
  on platform_usage_events(occurred_at desc);

create index if not exists idx_platform_usage_actor_occurred
  on platform_usage_events(actor_key_hash, occurred_at);

create table if not exists platform_operator_settings (
  settings_key text primary key check (settings_key = 'default'),
  usage_alerts_enabled boolean not null default false,
  return_rate_threshold numeric(5, 2) not null default 15
    check (return_rate_threshold > 0 and return_rate_threshold < 100),
  current_alert_state text not null default 'collecting'
    check (current_alert_state in ('collecting', 'healthy', 'below')),
  last_alerted_at timestamptz,
  updated_at timestamptz not null default now()
);

insert into platform_operator_settings (settings_key)
values ('default')
on conflict (settings_key) do nothing;

create table if not exists platform_operator_audit_events (
  id uuid primary key default gen_random_uuid(),
  action text not null check (
    action in (
      'login_succeeded',
      'login_failed',
      'dashboard_viewed',
      'settings_updated'
    )
  ),
  identity_hash text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_platform_operator_audit_identity_created
  on platform_operator_audit_events(identity_hash, created_at desc);

create table if not exists platform_operator_notification_events (
  id uuid primary key default gen_random_uuid(),
  notification_type text not null,
  recipient_hash text not null,
  status text not null check (status in ('pending', 'sent', 'skipped', 'failed')),
  idempotency_key text not null unique,
  provider_id text,
  error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

revoke all on table platform_usage_events from anon, authenticated;
revoke all on table platform_operator_settings from anon, authenticated;
revoke all on table platform_operator_audit_events from anon, authenticated;
revoke all on table platform_operator_notification_events from anon, authenticated;
