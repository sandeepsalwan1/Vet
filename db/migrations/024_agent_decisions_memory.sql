create extension if not exists vector;

create table if not exists agent_decisions (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade default default_clinic_id(),
  run_id uuid references agent_runs(id) on delete set null,
  trace_id text,
  agent text not null,
  capability text not null,
  decision_kind text not null,
  status text not null,
  ttl text not null default 'long',
  actor_name text,
  actor_role text,
  actor_profile_id text,
  action text not null,
  input_summary text,
  result_summary text,
  metadata jsonb not null default '{}',
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint agent_decisions_status_check check (status in ('proposed', 'confirmed', 'completed', 'blocked', 'skipped', 'failed')),
  constraint agent_decisions_ttl_check check (ttl in ('short', 'long', 'permanent'))
);

create index if not exists idx_agent_decisions_clinic_created on agent_decisions(clinic_id, created_at desc);
create index if not exists idx_agent_decisions_clinic_kind_status on agent_decisions(clinic_id, decision_kind, status, created_at desc);
create index if not exists idx_agent_decisions_run on agent_decisions(run_id);

create table if not exists agent_memories (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade default default_clinic_id(),
  subject_type text not null,
  subject_id text,
  memory_type text not null default 'preference',
  fact text not null,
  confidence numeric(4, 3) not null default 0.700,
  source_run_id uuid references agent_runs(id) on delete set null,
  metadata jsonb not null default '{}',
  embedding vector(1536),
  search_vector tsvector generated always as (
    to_tsvector('english', coalesce(subject_type, '') || ' ' || coalesce(subject_id, '') || ' ' || coalesce(memory_type, '') || ' ' || coalesce(fact, ''))
  ) stored,
  deleted_at timestamptz,
  superseded_by_id uuid references agent_memories(id) on delete set null,
  correction_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint agent_memories_confidence_check check (confidence >= 0 and confidence <= 1)
);

create index if not exists idx_agent_memories_clinic_subject on agent_memories(clinic_id, subject_type, subject_id, created_at desc)
  where deleted_at is null;
create index if not exists idx_agent_memories_search on agent_memories using gin(search_vector)
  where deleted_at is null;
create index if not exists idx_agent_memories_embedding on agent_memories using ivfflat (embedding vector_cosine_ops)
  with (lists = 100)
  where embedding is not null and deleted_at is null;
