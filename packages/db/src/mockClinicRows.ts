import type { LabCatalogRow, LabOrderRow, LabResultRow } from "./mockClinicLabRows";
import type { PricingObservationRow, ServiceRow } from "./mockClinicPricingRows";

type MockClient = {
  id: string;
  fullName: string;
  phone: string;
  email: string | null;
  notes: string | null;
};

type MockPet = {
  id: string;
  clientId: string;
  name: string;
  species: string;
  breed: string | null;
  ageYears: number | null;
  weight: string | null;
  alerts: string | null;
};

export type MockAppointment = {
  id: string;
  clientId: string;
  petId: string;
  appointmentDate: string;
  appointmentTime: string;
  appointmentType: string;
  doctor: string;
  status: string;
  waitMinutes: number;
  roomStatus: string;
  arrivedAt: string | null;
  notes: string | null;
};

type MockSlot = {
  id: string;
  slotDate: string;
  slotTime: string;
  doctor: string;
  appointmentType: string;
  available: boolean;
};

type MockFollowup = {
  id: string;
  clientId: string;
  petId: string;
  followupType: string;
  dueDate: string;
  recommendedAction: string;
  status: string;
};

type MockInvoice = {
  id: string;
  clientId: string;
  petId: string;
  invoiceNumber: string;
  invoiceDate: string;
  totalCents: number;
  status: string;
  lineItems: Record<string, unknown>[];
  flags: Record<string, unknown>[];
};

type MockMessage = {
  id: string;
  clientId: string | null;
  channel: string;
  direction: string;
  subject: string | null;
  body: string;
  intentHint: string | null;
  urgency: string;
  createdAt: string;
};

type MockCallTranscript = {
  id: string;
  callerName: string;
  callerPhone: string;
  transcript: string;
  intentHint: string | null;
  createdAt: string;
};

type ClientRow = {
  id: string;
  full_name: string;
  phone: string;
  email: string | null;
  notes: string | null;
};

type PetRow = {
  id: string;
  client_id: string;
  name: string;
  species: string;
  breed: string | null;
  age_years: number | null;
  weight: string | null;
  alerts: string | null;
};

export type AppointmentRow = {
  id: string;
  client_id: string;
  pet_id: string;
  appointment_date: string | Date;
  appointment_time: string;
  appointment_type: string;
  doctor: string;
  status: string;
  wait_minutes: number;
  room_status: string;
  arrived_at: string | null;
  notes: string | null;
};

type SlotRow = {
  id: string;
  slot_date: string | Date;
  slot_time: string;
  doctor: string;
  appointment_type: string;
  available: boolean;
};

export type FollowupRow = {
  id: string;
  client_id: string;
  pet_id: string;
  followup_type: string;
  due_date: string | Date;
  recommended_action: string;
  status: string;
};

type InvoiceRow = {
  id: string;
  client_id: string;
  pet_id: string;
  invoice_number: string;
  invoice_date: string | Date;
  total_cents: number;
  status: string;
  line_items: Record<string, unknown>[];
  flags: Record<string, unknown>[];
};

type MessageRow = {
  id: string;
  client_id: string | null;
  channel: string;
  direction: string;
  subject: string | null;
  body: string;
  intent_hint: string | null;
  urgency: string;
  created_at: string;
};

type CallRow = {
  id: string;
  caller_name: string;
  caller_phone: string;
  transcript: string;
  intent_hint: string | null;
  created_at: string;
};

export type MockClinicRow = {
  clients: ClientRow[];
  pets: PetRow[];
  appointments: AppointmentRow[];
  slots: SlotRow[];
  followups: FollowupRow[];
  invoices: InvoiceRow[];
  messages: MessageRow[];
  call_transcripts: CallRow[];
  services: ServiceRow[];
  pricing_observations: PricingObservationRow[];
  lab_catalog: LabCatalogRow[];
  lab_orders: LabOrderRow[];
  lab_results: LabResultRow[];
};

function dateText(value: string | Date) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value.split("T")[0] || value;
}

export function normalizeClient(row: ClientRow): MockClient {
  return {
    id: row.id,
    fullName: row.full_name,
    phone: row.phone,
    email: row.email,
    notes: row.notes
  };
}

export function normalizePet(row: PetRow): MockPet {
  return {
    id: row.id,
    clientId: row.client_id,
    name: row.name,
    species: row.species,
    breed: row.breed,
    ageYears: row.age_years,
    weight: row.weight,
    alerts: row.alerts
  };
}

export function normalizeAppointment(row: AppointmentRow): MockAppointment {
  return {
    id: row.id,
    clientId: row.client_id,
    petId: row.pet_id,
    appointmentDate: dateText(row.appointment_date),
    appointmentTime: row.appointment_time,
    appointmentType: row.appointment_type,
    doctor: row.doctor,
    status: row.status,
    waitMinutes: row.wait_minutes,
    roomStatus: row.room_status,
    arrivedAt: row.arrived_at,
    notes: row.notes
  };
}

export function normalizeSlot(row: SlotRow): MockSlot {
  return {
    id: row.id,
    slotDate: dateText(row.slot_date),
    slotTime: row.slot_time,
    doctor: row.doctor,
    appointmentType: row.appointment_type,
    available: row.available
  };
}

export function normalizeFollowup(row: FollowupRow): MockFollowup {
  return {
    id: row.id,
    clientId: row.client_id,
    petId: row.pet_id,
    followupType: row.followup_type,
    dueDate: dateText(row.due_date),
    recommendedAction: row.recommended_action,
    status: row.status
  };
}

export function normalizeInvoice(row: InvoiceRow): MockInvoice {
  return {
    id: row.id,
    clientId: row.client_id,
    petId: row.pet_id,
    invoiceNumber: row.invoice_number,
    invoiceDate: dateText(row.invoice_date),
    totalCents: row.total_cents,
    status: row.status,
    lineItems: row.line_items ?? [],
    flags: row.flags ?? []
  };
}

export function normalizeMessage(row: MessageRow): MockMessage {
  return {
    id: row.id,
    clientId: row.client_id,
    channel: row.channel,
    direction: row.direction,
    subject: row.subject,
    body: row.body,
    intentHint: row.intent_hint,
    urgency: row.urgency,
    createdAt: row.created_at
  };
}

export function normalizeCall(row: CallRow): MockCallTranscript {
  return {
    id: row.id,
    callerName: row.caller_name,
    callerPhone: row.caller_phone,
    transcript: row.transcript,
    intentHint: row.intent_hint,
    createdAt: row.created_at
  };
}
