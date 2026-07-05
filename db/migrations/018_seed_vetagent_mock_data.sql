insert into mock_clients (id, full_name, phone, email, notes)
values
  ('client-parker', 'Maya Parker', '(415) 555-0134', 'maya.parker@example.com', 'Prefers text updates.'),
  ('client-rivera', 'Luis Rivera', '(415) 555-0199', 'luis.rivera@example.com', 'Usually needs appointments after 3 PM.'),
  ('client-kim', 'Hannah Kim', '(415) 555-0172', 'hannah.kim@example.com', 'Recently moved records from another hospital.'),
  ('client-johnson', 'Avery Johnson', '(415) 555-0108', 'avery.johnson@example.com', 'Asked about invoice details last visit.')
on conflict (id) do update set
  full_name = excluded.full_name,
  phone = excluded.phone,
  email = excluded.email,
  notes = excluded.notes,
  updated_at = now();

insert into mock_pets (id, client_id, name, species, breed, age_years, weight, alerts)
values
  ('pet-biscuit', 'client-parker', 'Biscuit', 'Dog', 'Corgi mix', 5, '26 lb', null),
  ('pet-luna', 'client-rivera', 'Luna', 'Cat', 'Domestic shorthair', 8, '11 lb', 'Needs quiet handling.'),
  ('pet-maple', 'client-kim', 'Maple', 'Dog', 'Golden retriever', 3, '63 lb', null),
  ('pet-otis', 'client-johnson', 'Otis', 'Dog', 'French bulldog', 6, '24 lb', 'Breathing concerns noted historically.')
on conflict (id) do update set
  client_id = excluded.client_id,
  name = excluded.name,
  species = excluded.species,
  breed = excluded.breed,
  age_years = excluded.age_years,
  weight = excluded.weight,
  alerts = excluded.alerts,
  updated_at = now();

insert into mock_appointments (
  id,
  client_id,
  pet_id,
  appointment_date,
  appointment_time,
  appointment_type,
  doctor,
  status,
  wait_minutes,
  room_status,
  notes
)
values
  ('appt-biscuit-today', 'client-parker', 'pet-biscuit', current_date, '09:30', 'Wellness exam', 'Dr. Singh', 'scheduled', 18, 'waiting', 'Vaccines due.'),
  ('appt-luna-today', 'client-rivera', 'pet-luna', current_date, '15:30', 'Recheck', 'Dr. Patel', 'scheduled', 24, 'waiting', 'Skin recheck.'),
  ('appt-maple-tomorrow', 'client-kim', 'pet-maple', current_date + interval '1 day', '10:15', 'Vaccines', 'Dr. Singh', 'scheduled', 12, 'waiting', 'Annual vaccines.'),
  ('appt-otis-today', 'client-johnson', 'pet-otis', current_date, '16:10', 'Sick visit', 'Dr. Lee', 'scheduled', 35, 'triage review', 'Monitor for breathing red flags.')
on conflict (id) do update set
  client_id = excluded.client_id,
  pet_id = excluded.pet_id,
  appointment_date = excluded.appointment_date,
  appointment_time = excluded.appointment_time,
  appointment_type = excluded.appointment_type,
  doctor = excluded.doctor,
  status = excluded.status,
  wait_minutes = excluded.wait_minutes,
  room_status = excluded.room_status,
  arrived_at = null,
  notes = excluded.notes,
  updated_at = now();

insert into mock_slots (id, slot_date, slot_time, doctor, appointment_type, available)
values
  ('slot-vax-1', current_date + interval '1 day', '15:15', 'Dr. Singh', 'Vaccines', true),
  ('slot-vax-2', current_date + interval '2 days', '16:00', 'Dr. Patel', 'Vaccines', true),
  ('slot-wellness-1', current_date + interval '3 days', '10:30', 'Dr. Lee', 'Wellness exam', true),
  ('slot-recheck-1', current_date + interval '1 day', '17:00', 'Dr. Patel', 'Recheck', true),
  ('slot-sick-1', current_date, '14:40', 'Dr. Lee', 'Sick visit', false)
on conflict (id) do update set
  slot_date = excluded.slot_date,
  slot_time = excluded.slot_time,
  doctor = excluded.doctor,
  appointment_type = excluded.appointment_type,
  available = excluded.available;

insert into mock_wait_statuses (id, label, wait_minutes, message)
values
  ('normal', 'Normal', 18, 'The team has you checked in. Current wait is about 18 minutes.'),
  ('busy', 'Busy', 32, 'The team is running behind. Current wait is about 30 minutes.'),
  ('ready', 'Ready', 0, 'Your pet is ready for pickup. Please come to the front desk.')
on conflict (id) do update set
  label = excluded.label,
  wait_minutes = excluded.wait_minutes,
  message = excluded.message,
  updated_at = now();

insert into mock_followups (id, client_id, pet_id, followup_type, due_date, recommended_action, status)
values
  ('followup-biscuit-vax', 'client-parker', 'pet-biscuit', 'vaccine_due', current_date + interval '7 days', 'Book vaccine booster appointment.', 'open'),
  ('followup-luna-recheck', 'client-rivera', 'pet-luna', 'recheck_due', current_date + interval '3 days', 'Schedule skin recheck.', 'open'),
  ('followup-maple-refill', 'client-kim', 'pet-maple', 'refill_due', current_date + interval '5 days', 'Confirm refill pickup or delivery.', 'open')
on conflict (id) do update set
  due_date = excluded.due_date,
  recommended_action = excluded.recommended_action,
  status = excluded.status;

insert into mock_invoices (
  client_id,
  pet_id,
  invoice_number,
  invoice_date,
  total_cents,
  status,
  line_items,
  flags
)
select *
from (
values
  (
    'client-johnson',
    'pet-otis',
    'CVH-1007',
    current_date - interval '2 days',
    28450,
    'review',
	    '[{"service":"Sick exam","amountCents":8900},{"service":"Medication","amountCents":6550},{"service":"Radiology review","amountCents":13000}]'::jsonb,
	    '[{"severity":"medium","message":"Radiology review was added manually; confirm charge before client reply."}]'::jsonb
  ),
  (
    'client-rivera',
    'pet-luna',
    'CVH-1008',
    current_date - interval '1 day',
    14900,
    'paid',
	    '[{"service":"Recheck exam","amountCents":7900},{"service":"Skin cytology","amountCents":7000}]'::jsonb,
	    '[]'::jsonb
  )
) as seed(client_id, pet_id, invoice_number, invoice_date, total_cents, status, line_items, flags)
where not exists (
  select 1
  from mock_invoices existing
  where existing.invoice_number = seed.invoice_number
);

insert into mock_messages (id, client_id, channel, direction, subject, body, intent_hint, urgency)
values
  ('msg-sick-otis', 'client-johnson', 'email', 'inbound', 'Otis is coughing', 'Otis has been coughing and breathing harder than usual. Can someone help?', 'sick_pet', 'urgent'),
  ('msg-records-maple', 'client-kim', 'portal', 'inbound', 'Records request', 'Please send Maple''s vaccine records to Bayview Animal Clinic.', 'records', 'normal'),
  ('msg-pickup-luna', 'client-rivera', 'sms', 'inbound', null, 'Is Luna ready for pickup?', 'pickup', 'normal')
on conflict (id) do update set
  body = excluded.body,
  intent_hint = excluded.intent_hint,
  urgency = excluded.urgency;

insert into mock_call_transcripts (caller_name, caller_phone, transcript, intent_hint)
select *
from (
  values
    ('Maya Parker', '(415) 555-0134', 'Hi, this is Maya. I am outside for Biscuit''s appointment and wanted to check in.', 'arrival'),
    ('Luis Rivera', '(415) 555-0199', 'Can I book vaccines next week after 3 if anything is open?', 'booking'),
    ('Avery Johnson', '(415) 555-0108', 'My dog Otis seems sick and is breathing weird. I need help.', 'sick_pet')
) as seed(caller_name, caller_phone, transcript, intent_hint)
where not exists (
  select 1
  from mock_call_transcripts existing
  where existing.transcript = seed.transcript
);

insert into mock_service_catalog (id, service_name, category, current_price_cents, notes)
values
  ('svc-wellness-exam', 'Wellness exam', 'exam', 7900, 'Standard wellness visit.'),
  ('svc-sick-exam', 'Sick visit exam', 'exam', 8900, 'Same-day sick visit.'),
  ('svc-vaccine-core', 'Core vaccine package', 'vaccines', 11200, 'DA2PP, rabies, leptospirosis.'),
  ('svc-skin-cytology', 'Skin cytology', 'diagnostics', 7000, 'In-house cytology.'),
  ('svc-records-transfer', 'Records transfer', 'admin', 0, 'No charge.')
on conflict (id) do update set
  service_name = excluded.service_name,
  category = excluded.category,
  current_price_cents = excluded.current_price_cents,
  notes = excluded.notes,
  updated_at = now();

insert into pricing_observations (source, competitor_name, service_name, observed_price_cents, observed_text, url, raw)
select *
from (
  values
    ('sample', 'Bayview Animal Clinic', 'Wellness exam', 9200, '$92 wellness exam listed on services page', 'https://example.com/bayview', '{"sample":true}'::jsonb),
    ('sample', 'Mission Pet Care', 'Core vaccine package', 12800, '$128 vaccine bundle from public price page', 'https://example.com/mission', '{"sample":true}'::jsonb),
    ('sample', 'Noe Valley Vet', 'Skin cytology', 7600, '$76 skin cytology estimate', 'https://example.com/noe', '{"sample":true}'::jsonb)
) as seed(source, competitor_name, service_name, observed_price_cents, observed_text, url, raw)
where not exists (
  select 1
  from pricing_observations existing
  where existing.source = seed.source
    and existing.competitor_name = seed.competitor_name
    and existing.service_name = seed.service_name
);
