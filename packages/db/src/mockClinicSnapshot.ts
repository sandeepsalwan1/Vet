import { getSql } from "./connection";
import { resolveClinicId } from "./clinics";
import {
  normalizeAppointment,
  normalizeCall,
  normalizeClient,
  normalizeFollowup,
  normalizeInvoice,
  normalizeMessage,
  normalizePet,
  normalizeSlot,
  type MockClinicRow
} from "./mockClinicRows";
import {
  normalizePricingObservation,
  normalizeService
} from "./mockClinicPricingRows";
import {
  normalizeLabCatalogItem,
  normalizeLabOrder,
  normalizeLabResult
} from "./mockClinicLabRows";

export async function listMockClinic(options?: { clinicId?: string | null }) {
  const sql = getSql();
  const clinicId = await resolveClinicId(options?.clinicId);
  const [clinic] = await sql<MockClinicRow[]>`
    select
      coalesce((
        select jsonb_agg(row_to_json(item))
        from (
          select id, full_name, phone, email, notes
          from mock_clients
          where clinic_id = ${clinicId}
          order by full_name asc
        ) item
      ), '[]'::jsonb) as clients,
      coalesce((
        select jsonb_agg(row_to_json(item))
        from (
          select id, client_id, name, species, breed, age_years, weight, alerts
          from mock_pets
          where clinic_id = ${clinicId}
          order by name asc
        ) item
      ), '[]'::jsonb) as pets,
      coalesce((
        select jsonb_agg(row_to_json(item))
        from (
          select id, client_id, pet_id, appointment_date, appointment_time, appointment_type, doctor, status, wait_minutes, room_status, arrived_at, notes
          from mock_appointments
          where clinic_id = ${clinicId}
          order by appointment_date asc, appointment_time asc
        ) item
      ), '[]'::jsonb) as appointments,
      coalesce((
        select jsonb_agg(row_to_json(item))
        from (
          select id, slot_date, slot_time, doctor, appointment_type, available
          from mock_slots
          where clinic_id = ${clinicId}
          order by slot_date asc, slot_time asc
        ) item
      ), '[]'::jsonb) as slots,
      coalesce((
        select jsonb_agg(row_to_json(item))
        from (
          select id, client_id, pet_id, followup_type, due_date, recommended_action, status
          from mock_followups
          where clinic_id = ${clinicId}
          order by due_date asc
        ) item
      ), '[]'::jsonb) as followups,
      coalesce((
        select jsonb_agg(row_to_json(item))
        from (
          select id, client_id, pet_id, invoice_number, invoice_date, total_cents, status, line_items, flags
          from mock_invoices
          where clinic_id = ${clinicId}
          order by invoice_date desc
        ) item
      ), '[]'::jsonb) as invoices,
      coalesce((
        select jsonb_agg(row_to_json(item))
        from (
          select id, client_id, channel, direction, subject, body, intent_hint, urgency, created_at
          from mock_messages
          where clinic_id = ${clinicId}
          order by created_at desc
        ) item
      ), '[]'::jsonb) as messages,
      coalesce((
        select jsonb_agg(row_to_json(item))
        from (
          select id, caller_name, caller_phone, transcript, intent_hint, created_at
          from mock_call_transcripts
          where clinic_id = ${clinicId}
          order by created_at desc
        ) item
      ), '[]'::jsonb) as call_transcripts,
      coalesce((
        select jsonb_agg(row_to_json(item))
        from (
          select id, service_name, category, current_price_cents, notes
          from mock_service_catalog
          where clinic_id = ${clinicId}
          order by category asc, service_name asc
        ) item
      ), '[]'::jsonb) as services,
      coalesce((
        select jsonb_agg(row_to_json(item))
        from (
          select id, source, competitor_name, service_name, observed_price_cents, observed_text, url, raw, created_at
          from pricing_observations
          where clinic_id = ${clinicId}
          order by created_at desc
          limit 50
        ) item
      ), '[]'::jsonb) as pricing_observations,
      coalesce((
        select jsonb_agg(row_to_json(item))
        from (
          select id, lab_vendor, test_code, test_name, specimen_type, turnaround_hours, active, raw
          from mock_lab_catalog
          where clinic_id = ${clinicId}
          order by test_name asc
        ) item
      ), '[]'::jsonb) as lab_catalog,
      coalesce((
        select jsonb_agg(row_to_json(item))
        from (
          select id, lab_vendor, external_order_id, client_id, pet_id, patient_name, ordered_by, test_code, test_name, specimen_type, ordered_at, status, raw
          from mock_lab_orders
          where clinic_id = ${clinicId}
          order by ordered_at desc
        ) item
      ), '[]'::jsonb) as lab_orders,
      coalesce((
        select jsonb_agg(row_to_json(item))
        from (
          select id, lab_order_id, lab_vendor, external_order_id, status, result_summary, abnormal_flags, report_url, raw, resulted_at
          from mock_lab_results
          where clinic_id = ${clinicId}
          order by resulted_at desc nulls last, created_at desc
        ) item
      ), '[]'::jsonb) as lab_results
  `;

  return {
    clients: clinic.clients.map(normalizeClient),
    pets: clinic.pets.map(normalizePet),
    appointments: clinic.appointments.map(normalizeAppointment),
    slots: clinic.slots.map(normalizeSlot),
    followups: clinic.followups.map(normalizeFollowup),
    invoices: clinic.invoices.map(normalizeInvoice),
    messages: clinic.messages.map(normalizeMessage),
    callTranscripts: clinic.call_transcripts.map(normalizeCall),
    services: clinic.services.map(normalizeService),
    pricingObservations: clinic.pricing_observations.map(normalizePricingObservation),
    labCatalog: clinic.lab_catalog.map(normalizeLabCatalogItem),
    labOrders: clinic.lab_orders.map(normalizeLabOrder),
    labResults: clinic.lab_results.map(normalizeLabResult)
  };
}
