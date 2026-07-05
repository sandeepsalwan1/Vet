alter table agent_runs
  add column if not exists trace_id text,
  add column if not exists request_id text,
  add column if not exists model text,
  add column if not exists duration_ms int,
  add column if not exists input_hash text,
  add column if not exists input_summary text,
  add column if not exists output_summary text,
  add column if not exists error_kind text,
  add column if not exists token_input int,
  add column if not exists token_output int,
  add column if not exists tool_call_count int not null default 0;

create table if not exists agent_tool_calls (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references agent_runs(id) on delete cascade,
  trace_id text,
  sequence int not null,
  tool_name text not null,
  status text not null,
  args jsonb not null default '{}',
  result jsonb not null default '{}',
  error text,
  duration_ms int,
  created_at timestamptz not null default now()
);

create index if not exists idx_agent_runs_trace_id on agent_runs(trace_id);
create index if not exists idx_agent_runs_status_created on agent_runs(status, created_at desc);
create index if not exists idx_agent_tool_calls_run_sequence on agent_tool_calls(run_id, sequence);
create index if not exists idx_agent_tool_calls_tool_created on agent_tool_calls(tool_name, created_at desc);

create table if not exists mock_lab_catalog (
  id text primary key,
  lab_vendor text not null default 'antech_mock',
  test_code text not null,
  test_name text not null,
  specimen_type text not null,
  turnaround_hours int not null default 24,
  active boolean not null default true,
  raw jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists mock_lab_orders (
  id text primary key,
  lab_vendor text not null default 'antech_mock',
  external_order_id text not null unique,
  client_id text not null references mock_clients(id) on delete cascade,
  pet_id text not null references mock_pets(id) on delete cascade,
  patient_name text not null,
  ordered_by text not null,
  test_code text not null,
  test_name text not null,
  specimen_type text not null,
  ordered_at timestamptz not null default now(),
  status text not null,
  raw jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists mock_lab_results (
  id text primary key,
  lab_order_id text not null references mock_lab_orders(id) on delete cascade,
  lab_vendor text not null default 'antech_mock',
  external_order_id text not null,
  status text not null,
  result_summary text not null,
  abnormal_flags jsonb not null default '[]',
  report_url text,
  raw jsonb not null default '{}',
  resulted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_mock_lab_orders_status_ordered on mock_lab_orders(status, ordered_at desc);
create index if not exists idx_mock_lab_orders_client_pet on mock_lab_orders(client_id, pet_id);
create index if not exists idx_mock_lab_results_order_status on mock_lab_results(lab_order_id, status);

insert into mock_lab_catalog (
  id,
  lab_vendor,
  test_code,
  test_name,
  specimen_type,
  turnaround_hours,
  raw
)
values
  (
    'labcat-cbc',
    'antech_mock',
    'CBC',
    'Complete Blood Count',
    'whole_blood',
    24,
    '{"vendorShape":"antech_style","department":"hematology"}'::jsonb
  ),
  (
    'labcat-chem17',
    'antech_mock',
    'CHEM17',
    'Chemistry 17 Panel',
    'serum',
    24,
    '{"vendorShape":"antech_style","department":"chemistry"}'::jsonb
  ),
  (
    'labcat-ua',
    'antech_mock',
    'UA',
    'Urinalysis',
    'urine',
    24,
    '{"vendorShape":"antech_style","department":"urinalysis"}'::jsonb
  )
on conflict (id) do update set
  lab_vendor = excluded.lab_vendor,
  test_code = excluded.test_code,
  test_name = excluded.test_name,
  specimen_type = excluded.specimen_type,
  turnaround_hours = excluded.turnaround_hours,
  raw = excluded.raw,
  updated_at = now();

insert into mock_lab_orders (
  id,
  lab_vendor,
  external_order_id,
  client_id,
  pet_id,
  patient_name,
  ordered_by,
  test_code,
  test_name,
  specimen_type,
  ordered_at,
  status,
  raw
)
values
  (
    'laborder-otis-cbc',
    'antech_mock',
    'ANT-MOCK-20260531-001',
    'client-johnson',
    'pet-otis',
    'Otis',
    'Dr. Lee',
    'CBC',
    'Complete Blood Count',
    'whole_blood',
    now() - interval '3 hours',
    'final',
    '{"vendorShape":"antech_style","accessionId":"ANT-MOCK-20260531-001"}'::jsonb
  ),
  (
    'laborder-luna-ua',
    'antech_mock',
    'ANT-MOCK-20260531-002',
    'client-rivera',
    'pet-luna',
    'Luna',
    'Dr. Patel',
    'UA',
    'Urinalysis',
    'urine',
    now() - interval '1 hour',
    'in_progress',
    '{"vendorShape":"antech_style","accessionId":"ANT-MOCK-20260531-002"}'::jsonb
  )
on conflict (id) do update set
  lab_vendor = excluded.lab_vendor,
  external_order_id = excluded.external_order_id,
  client_id = excluded.client_id,
  pet_id = excluded.pet_id,
  patient_name = excluded.patient_name,
  ordered_by = excluded.ordered_by,
  test_code = excluded.test_code,
  test_name = excluded.test_name,
  specimen_type = excluded.specimen_type,
  status = excluded.status,
  raw = excluded.raw,
  updated_at = now();

insert into mock_lab_results (
  id,
  lab_order_id,
  lab_vendor,
  external_order_id,
  status,
  result_summary,
  abnormal_flags,
  report_url,
  raw,
  resulted_at
)
values
  (
    'labresult-otis-cbc',
    'laborder-otis-cbc',
    'antech_mock',
    'ANT-MOCK-20260531-001',
    'final',
    'Mock CBC finalized with elevated white blood cell count flag. Veterinarian review required before client disclosure.',
    '[{"analyte":"WBC","flag":"high","severity":"review"}]'::jsonb,
    'internal://mock-labs/ANT-MOCK-20260531-001/report',
    '{"vendorShape":"antech_style","panels":[{"name":"CBC","flags":["WBC high"]}]}'::jsonb,
    now() - interval '45 minutes'
  )
on conflict (id) do update set
  status = excluded.status,
  result_summary = excluded.result_summary,
  abnormal_flags = excluded.abnormal_flags,
  report_url = excluded.report_url,
  raw = excluded.raw,
  resulted_at = excluded.resulted_at,
  updated_at = now();
