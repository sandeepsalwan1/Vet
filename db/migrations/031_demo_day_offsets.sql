-- Demo tenants need a clinic day that stays current. Frozen `current_date`
-- seeds went stale the day after they were inserted, so arrival matching,
-- booking slots, and follow-ups all stopped resolving. Store the intended
-- day offset next to each demo row so the runtime can roll them forward.

alter table mock_appointments add column if not exists demo_day_offset integer;
alter table mock_slots add column if not exists demo_day_offset integer;
alter table mock_slots add column if not exists demo_available boolean;
alter table mock_followups add column if not exists demo_day_offset integer;

update mock_appointments
set demo_day_offset = case id
    when 'appt-biscuit-today' then 0
    when 'appt-luna-today' then 0
    when 'appt-otis-today' then 0
    when 'appt-maple-tomorrow' then 1
  end
where demo_day_offset is null
  and id in ('appt-biscuit-today', 'appt-luna-today', 'appt-otis-today', 'appt-maple-tomorrow');

update mock_slots
set demo_available = (id <> 'slot-sick-1')
where demo_available is null
  and id in ('slot-vax-1', 'slot-vax-2', 'slot-wellness-1', 'slot-recheck-1', 'slot-sick-1');

update mock_slots
set demo_day_offset = case id
    when 'slot-vax-1' then 1
    when 'slot-vax-2' then 2
    when 'slot-wellness-1' then 3
    when 'slot-recheck-1' then 1
    when 'slot-sick-1' then 0
  end
where demo_day_offset is null
  and id in ('slot-vax-1', 'slot-vax-2', 'slot-wellness-1', 'slot-recheck-1', 'slot-sick-1');

update mock_followups
set demo_day_offset = case id
    when 'followup-biscuit-vax' then 7
    when 'followup-luna-recheck' then 3
    when 'followup-maple-refill' then 5
  end
where demo_day_offset is null
  and id in ('followup-biscuit-vax', 'followup-luna-recheck', 'followup-maple-refill');

-- One arrival per questionnaire branch so every check-in path is demoable.
with demo_clinic as (
  select clinic_id
  from client_journey_settings
  where pims_provider = 'mock-clinic'
),
seed_client(id, full_name, phone, email, notes) as (
  values
    ('client-nguyen', 'Ellie Nguyen', '(415) 555-0121', 'ellie.nguyen@example.com', 'Books vaccine visits over lunch.'),
    ('client-alvarez', 'Tom Alvarez', '(415) 555-0146', 'tom.alvarez@example.com', 'Asks for written dental estimates.'),
    ('client-shah', 'Priya Shah', '(415) 555-0157', 'priya.shah@example.com', 'Drops off early on surgery days.'),
    ('client-brooks', 'Dana Brooks', '(415) 555-0163', 'dana.brooks@example.com', 'Prefers the last appointment of the day.')
)
insert into mock_clients (id, clinic_id, full_name, phone, email, notes)
select seed_client.id, demo_clinic.clinic_id, seed_client.full_name, seed_client.phone, seed_client.email, seed_client.notes
from seed_client
cross join demo_clinic
on conflict (id) do nothing;

with demo_clinic as (
  select clinic_id
  from client_journey_settings
  where pims_provider = 'mock-clinic'
),
seed_pet(id, client_id, name, species, breed, age_years, weight, alerts) as (
  values
    ('pet-mochi', 'client-nguyen', 'Mochi', 'Cat', 'Ragdoll', 2, '9 lb', null),
    ('pet-rocket', 'client-alvarez', 'Rocket', 'Dog', 'Beagle', 7, '31 lb', 'Tartar buildup on last dental chart.'),
    ('pet-waffles', 'client-shah', 'Waffles', 'Dog', 'Labrador', 4, '71 lb', 'Pre-surgical fast required.'),
    ('pet-pepper', 'client-brooks', 'Pepper', 'Cat', 'Tabby', 6, '12 lb', null)
)
insert into mock_pets (id, clinic_id, client_id, name, species, breed, age_years, weight, alerts)
select seed_pet.id, demo_clinic.clinic_id, seed_pet.client_id, seed_pet.name, seed_pet.species, seed_pet.breed, seed_pet.age_years, seed_pet.weight, seed_pet.alerts
from seed_pet
cross join demo_clinic
on conflict (id) do nothing;

with demo_clinic as (
  select clinic_id
  from client_journey_settings
  where pims_provider = 'mock-clinic'
),
seed_appointment(id, client_id, pet_id, appointment_time, appointment_type, doctor, wait_minutes, notes) as (
  values
    ('appt-waffles-today', 'client-shah', 'pet-waffles', time '07:45', 'Surgery', 'Dr. Singh', 10, 'Dental extraction, fasted since 8 PM.'),
    ('appt-mochi-today', 'client-nguyen', 'pet-mochi', time '11:00', 'Vaccines', 'Dr. Patel', 14, 'Annual boosters.'),
    ('appt-rocket-today', 'client-alvarez', 'pet-rocket', time '13:20', 'Dental', 'Dr. Lee', 20, 'Dental cleaning estimate review.'),
    ('appt-pepper-today', 'client-brooks', 'pet-pepper', time '16:45', 'Routine', 'Dr. Patel', 16, 'Itching and routine vaccines.')
)
insert into mock_appointments (
  id,
  clinic_id,
  client_id,
  pet_id,
  appointment_date,
  appointment_time,
  appointment_type,
  doctor,
  status,
  wait_minutes,
  room_status,
  notes,
  demo_day_offset
)
select
  seed_appointment.id,
  demo_clinic.clinic_id,
  seed_appointment.client_id,
  seed_appointment.pet_id,
  current_date,
  seed_appointment.appointment_time,
  seed_appointment.appointment_type,
  seed_appointment.doctor,
  'scheduled',
  seed_appointment.wait_minutes,
  'waiting',
  seed_appointment.notes,
  0
from seed_appointment
cross join demo_clinic
on conflict (id) do nothing;

-- Bookable slots across the coming week so the booking flow is never empty.
with demo_clinic as (
  select clinic_id
  from client_journey_settings
  where pims_provider = 'mock-clinic'
),
seed_slot(id, day_offset, slot_time, doctor, appointment_type) as (
  values
    ('slot-vax-3', 2, time '09:00', 'Dr. Singh', 'Vaccines'),
    ('slot-wellness-2', 1, time '11:45', 'Dr. Patel', 'Wellness exam'),
    ('slot-wellness-3', 4, time '14:15', 'Dr. Singh', 'Wellness exam'),
    ('slot-dental-1', 3, time '08:30', 'Dr. Lee', 'Dental'),
    ('slot-sick-2', 0, time '17:20', 'Dr. Lee', 'Sick visit'),
    ('slot-recheck-2', 5, time '10:00', 'Dr. Patel', 'Recheck')
)
insert into mock_slots (id, clinic_id, slot_date, slot_time, doctor, appointment_type, available, demo_day_offset, demo_available)
select
  seed_slot.id,
  demo_clinic.clinic_id,
  current_date + seed_slot.day_offset,
  seed_slot.slot_time,
  seed_slot.doctor,
  seed_slot.appointment_type,
  true,
  seed_slot.day_offset,
  true
from seed_slot
cross join demo_clinic
on conflict (id) do nothing;

create index if not exists idx_mock_appointments_demo_day
  on mock_appointments(clinic_id, demo_day_offset)
  where demo_day_offset is not null;
