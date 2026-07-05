import type {
  MockAppointment,
  MockClinicData,
  MockClient,
  MockFollowup,
  MockInvoice,
  MockLabCatalogItem,
  MockLabOrder,
  MockLabResult,
  MockPet,
  MockService,
  MockSlot,
  PricingObservation
} from "./contracts";

export type AdapterContext = {
  clinicId?: string;
  data: MockClinicData;
  now: Date;
};

type ClientLookupInput = {
  clientName?: string | null;
  phone?: string | null;
};

type PetLookupInput = {
  clientId: string;
  petName?: string | null;
};

type AppointmentLookupInput = {
  clientId?: string | null;
  petId?: string | null;
  status?: MockAppointment["status"] | null;
  date?: string | null;
};

type SlotLookupInput = {
  appointmentType?: string | null;
};

type BookAppointmentInput = {
  slotId: string;
  clientId: string;
  petId: string;
  reason?: string | null;
};

type BookAppointmentResult = {
  booked: boolean;
  action: "appointment_booked" | "booking_not_completed";
  confirmationId?: string;
  appointment: MockAppointment | null;
  slot: MockSlot | null;
  client: MockClient | null;
  pet: MockPet | null;
  task: null;
};

type ArrivalMatchInput = {
  clientName?: string | null;
  clientPhone?: string | null;
  petName?: string | null;
};

type ArrivalMatchResult = {
  client: MockClient | null;
  pet: MockPet | null;
  appointment: MockAppointment | null;
};

type WaitStatusInput = {
  appointmentId?: string | null;
  petId?: string | null;
};

type WaitStatusResult = {
  appointmentId: string;
  waitMinutes: number;
  queuePosition: number;
  roomStatus: MockAppointment["roomStatus"];
} | null;

type InvoiceLookupInput = {
  clientId?: string | null;
  petId?: string | null;
};

type InvoiceContext = {
  invoice: MockInvoice | null;
  client: MockClient | null;
  pet: MockPet | null;
};

type RecordsTransferInput = {
  clientName?: string | null;
  petName?: string | null;
  destination?: string | null;
  request?: string | null;
};

type RecordsAuditResult = {
  status: "passed" | "blocked";
  source: string;
  reason: string;
  checkedAt: string;
  requiresApproval: boolean;
  clientName: string | null;
  petName: string | null;
  destination: string | null;
};

type RecordsPacket = {
  clientName: string | null;
  petName: string | null;
  destination: string | null;
  requiresApproval: boolean;
  attachments: string[];
};

type RecordsTransferResult = {
  status: "sent" | "blocked";
  delivery: string;
  clientName: string | null;
  petName: string | null;
  destination: string | null;
  confirmationId: string;
  sentAt: string | null;
};

type LabOrderLookupInput = {
  clientId?: string | null;
  petId?: string | null;
  patientName?: string | null;
  status?: string | null;
};

type LabResultLookupInput = {
  labOrderId?: string | null;
  externalOrderId?: string | null;
};

type FollowupOutreachResult = {
  candidate: MockFollowup | null;
  client?: MockClient;
  pet?: MockPet;
  outreach?: {
    status: "sent";
    channel: string;
    sentAt: string;
    message: string;
  };
  task: null;
};

type ClientAdapter = {
  findClients(input: ClientLookupInput): Promise<MockClient[]>;
  getClient(clientId: string): Promise<MockClient | null>;
};

type PetAdapter = {
  findPets(input: PetLookupInput): Promise<MockPet[]>;
  getPet(petId: string): Promise<MockPet | null>;
};

type AppointmentAdapter = {
  findAppointments(input: AppointmentLookupInput): Promise<MockAppointment[]>;
  listSlots(input: SlotLookupInput): Promise<MockSlot[]>;
  bookAppointment(input: BookAppointmentInput): Promise<BookAppointmentResult>;
  matchArrival(input: ArrivalMatchInput): Promise<ArrivalMatchResult>;
  getWaitStatus(input: WaitStatusInput): Promise<WaitStatusResult>;
};

type PricingAdapter = {
  listServices(): Promise<MockService[]>;
  listObservations(input?: { source?: PricingObservation["source"] | null }): Promise<PricingObservation[]>;
  replaceObservations(observations: PricingObservation[]): Promise<PricingObservation[]>;
};

type InvoiceAdapter = {
  findInvoices(input: InvoiceLookupInput): Promise<MockInvoice[]>;
  getInvoiceContext(invoiceId: string): Promise<InvoiceContext>;
};

type RecordsAdapter = {
  auditTransfer(input: RecordsTransferInput): Promise<RecordsAuditResult>;
  preparePacket(input: RecordsTransferInput): Promise<RecordsPacket>;
  completeTransfer(input: RecordsTransferInput): Promise<RecordsTransferResult>;
};

type LabAdapter = {
  listCatalog(input?: { active?: boolean | null }): Promise<MockLabCatalogItem[]>;
  findOrders(input: LabOrderLookupInput): Promise<MockLabOrder[]>;
  getResult(input: LabResultLookupInput): Promise<{ order: MockLabOrder | null; result: MockLabResult | null }>;
};

type MessagingAdapter = {
  sendFollowupOutreach(candidateId: string): Promise<FollowupOutreachResult>;
};

export type VetAgentAdapters = {
  clients: ClientAdapter;
  pets: PetAdapter;
  appointments: AppointmentAdapter;
  pricing: PricingAdapter;
  invoices: InvoiceAdapter;
  records: RecordsAdapter;
  labs: LabAdapter;
  messaging: MessagingAdapter;
};

export { createMockClinicAdapters } from "./mockClinicAdapters";
