import type { MockLabCatalogItem, MockLabOrder, MockLabResult } from "@central-vet/db";
import type { AgentIntent, TaskPriority, TaskRequestType } from "./agentVocabulary";

export type { MockLabCatalogItem, MockLabOrder, MockLabResult };

export type MockClient = {
  id: string;
  fullName: string;
  phone: string;
  email?: string;
  notes?: string;
};

export type MockPet = {
  id: string;
  clientId: string;
  name: string;
  species: string;
  breed?: string;
  alerts?: string;
};

export type MockAppointment = {
  id: string;
  clientId: string;
  petId: string;
  appointmentDate: string;
  appointmentTime: string;
  appointmentType: string;
  doctor: string;
  status: "scheduled" | "arrived" | "ready" | "completed";
  waitMinutes: number;
  roomStatus: "waiting" | "checked in" | "ready" | "complete";
  notes?: string;
};

export type MockSlot = {
  id: string;
  slotDate: string;
  slotTime: string;
  doctor: string;
  appointmentType: string;
  available: boolean;
};

export type MockFollowup = {
  id: string;
  clientId: string;
  petId: string;
  followupType: string;
  dueDate: string;
  recommendedAction: string;
  status: "open" | "contacted" | "closed";
};

export type MockInvoice = {
  id: string;
  clientId: string;
  petId: string;
  invoiceNumber: string;
  status: "paid" | "unpaid" | "review";
  totalCents: number;
  flags: { reason: string; severity: TaskPriority }[];
};

export type MockService = {
  id: string;
  serviceName: string;
  category: string;
  currentPriceCents: number;
};

export type PricingObservation = {
  id: string;
  source: "sample" | "apify";
  competitorName: string;
  serviceName: string;
  observedPriceCents: number | null;
  observedText?: string;
  url?: string;
};

export type PricingRecommendation = {
  serviceId: string;
  serviceName: string;
  currentPriceCents: number;
  competitorLowCents?: number | null;
  competitorMedianCents?: number | null;
  competitorHighCents?: number | null;
  proposedPriceCents?: number | null;
  confidence: "low" | "medium" | "high";
  reason: string;
  action: "keep" | "raise" | "lower" | "manual_review";
};

export type MockTask = {
  id: string;
  status: string;
  priority: TaskPriority;
  requestType?: TaskRequestType;
  clientName?: string | null;
  petName?: string | null;
  request: string;
  notes?: string | null;
  dueDate?: string | null;
  dueTime?: string | null;
};

export type MockApproval = {
  id: string;
  status: string;
  approvalType: string;
  title: string;
  summary: string;
  taskId?: string | null;
};

export type MockReport = {
  id: string;
  reportType: string;
  title: string;
  summary: string;
  taskId?: string | null;
};

type MockMessage = {
  id: string;
  clientId: string | null;
  body: string;
  intentHint?: AgentIntent;
  urgency: "normal" | "high";
};

type MockCallTranscript = {
  id: string;
  callerName: string;
  callerPhone: string;
  transcript: string;
  intentHint?: AgentIntent;
};

export type MockClinicData = {
  clients: MockClient[];
  pets: MockPet[];
  appointments: MockAppointment[];
  slots: MockSlot[];
  followups: MockFollowup[];
  invoices: MockInvoice[];
  services: MockService[];
  pricingObservations: PricingObservation[];
  messages: MockMessage[];
  calls: MockCallTranscript[];
  tasks?: MockTask[];
  approvals?: MockApproval[];
  reports?: MockReport[];
  labCatalog?: MockLabCatalogItem[];
  labOrders?: MockLabOrder[];
  labResults?: MockLabResult[];
};
