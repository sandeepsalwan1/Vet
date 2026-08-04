create table if not exists pims_connections (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  provider text not null,
  provider_practice_id text not null,
  provider_site_ids text[] not null default '{}',
  status text not null default 'pending',
  metadata jsonb not null default '{}',
  last_webhook_at timestamptz,
  last_initial_sync_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pims_connections_status_check
    check (status in ('pending', 'active', 'disabled', 'error')),
  constraint pims_connections_provider_practice_unique
    unique (provider, provider_practice_id)
);

create table if not exists pims_webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  provider text not null,
  provider_practice_ids text[] not null,
  provider_timestamp timestamptz not null,
  provider_version text not null,
  record_count integer not null default 0,
  successful_record_count integer not null default 0,
  failed_record_count integer not null default 0,
  status text not null default 'processing',
  failure_summary text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  constraint pims_webhook_deliveries_status_check
    check (status in ('processing', 'processed', 'partial', 'failed'))
);

create table if not exists pims_records (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  provider text not null,
  provider_practice_id text not null,
  entity_type text not null,
  integration_id text not null,
  pims_id text,
  site_id text,
  is_active boolean,
  is_deleted boolean not null default false,
  deleted_at timestamptz,
  provider_updated_at timestamptz,
  payload jsonb not null,
  first_received_at timestamptz not null default now(),
  last_received_at timestamptz not null default now(),
  constraint pims_records_identity_unique
    unique (
      clinic_id,
      provider,
      provider_practice_id,
      entity_type,
      integration_id
    )
);

create index if not exists idx_pims_connections_clinic_provider
  on pims_connections(clinic_id, provider, status);

create index if not exists idx_pims_webhook_deliveries_clinic_received
  on pims_webhook_deliveries(clinic_id, received_at desc);

create index if not exists idx_pims_records_clinic_entity_active
  on pims_records(clinic_id, entity_type, is_deleted, is_active);

create index if not exists idx_pims_records_pims_id
  on pims_records(clinic_id, provider, entity_type, pims_id)
  where pims_id is not null;

create index if not exists idx_pims_records_site
  on pims_records(clinic_id, provider, site_id, entity_type)
  where site_id is not null;

revoke all on table pims_connections from anon, authenticated;
revoke all on table pims_webhook_deliveries from anon, authenticated;
revoke all on table pims_records from anon, authenticated;
