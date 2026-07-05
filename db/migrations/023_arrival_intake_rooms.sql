create table if not exists arrival_settings (
  clinic_id uuid primary key references clinics(id) on delete cascade,
  room_assignment_enabled boolean not null default true,
  questionnaire jsonb not null default '{
    "visitReasons": ["Sick", "Vaccines", "Surgery", "Dental", "Routine"],
    "sickSignsLabel": "What signs are you seeing?",
    "sickSigns": ["Vomiting", "Diarrhea", "Coughing", "Other signs"],
    "specialConcernsLabel": "Any special concerns?",
    "vaccineFeelingLabel": "How is your pet feeling today?",
    "surgeryAteLabel": "Did your pet eat today?",
    "surgeryFeelingLabel": "How is your pet feeling today?",
    "dentalConcernLabel": "Any dental concerns today?",
    "routineConcernLabel": "Scratching, itching, routine vaccines, or anything else?"
  }',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists clinic_rooms (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  name text not null,
  sort_order int not null default 0,
  state text not null default 'open',
  current_arrival_id uuid,
  state_changed_at timestamptz not null default now(),
  auto_open_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint clinic_rooms_state_check check (state in ('open', 'occupied', 'closed', 'cleaning')),
  constraint clinic_rooms_clinic_name_unique unique (clinic_id, name)
);

create table if not exists arrival_intakes (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  status text not null,
  appointment_id text,
  client_id text,
  pet_id text,
  client_name text,
  client_phone text,
  pet_name text,
  visit_reason text,
  answers jsonb not null default '{}',
  room_id uuid references clinic_rooms(id) on delete set null,
  room_name text,
  pims_write_status text not null default 'mock_written',
  pims_write_summary text,
  exception_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint arrival_intakes_status_check check (status in ('checked_in', 'exception'))
);

alter table clinic_rooms
  drop constraint if exists clinic_rooms_current_arrival_id_fkey;

alter table clinic_rooms
  add constraint clinic_rooms_current_arrival_id_fkey
    foreign key (current_arrival_id) references arrival_intakes(id) on delete set null;

insert into arrival_settings (clinic_id)
select id
from clinics
on conflict (clinic_id) do nothing;

insert into clinic_rooms (clinic_id, name, sort_order)
select clinic.id, room.name, room.sort_order
from clinics clinic
cross join (
  values
    ('Exam Room 1', 1),
    ('Exam Room 2', 2),
    ('Exam Room 3', 3),
    ('Exam Room 4', 4),
    ('Exam Room 5', 5),
    ('Exam Room 6', 6)
) as room(name, sort_order)
where not exists (
  select 1
  from clinic_rooms existing
  where existing.clinic_id = clinic.id
)
on conflict (clinic_id, name) do nothing;

create index if not exists idx_clinic_rooms_clinic_state on clinic_rooms(clinic_id, state, sort_order);
create index if not exists idx_arrival_intakes_clinic_created on arrival_intakes(clinic_id, created_at desc);
create index if not exists idx_arrival_intakes_clinic_appointment on arrival_intakes(clinic_id, appointment_id, created_at desc);
