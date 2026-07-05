export type RoomState = "open" | "occupied" | "closed" | "cleaning";
type ArrivalStatus = "checked_in" | "exception";

export type ArrivalQuestionnaire = {
  visitReasons: string[];
  sickSignsLabel: string;
  sickSigns: string[];
  specialConcernsLabel: string;
  vaccineFeelingLabel: string;
  surgeryAteLabel: string;
  surgeryFeelingLabel: string;
  dentalConcernLabel: string;
  routineConcernLabel: string;
};

export type ArrivalSettings = {
  roomAssignmentEnabled: boolean;
  questionnaire: ArrivalQuestionnaire;
};

export type ClinicRoom = {
  id: string;
  clinicId: string;
  name: string;
  sortOrder: number;
  state: RoomState;
  currentArrivalId: string | null;
  stateChangedAt: string;
  autoOpenAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ArrivalIntake = {
  id: string;
  clinicId: string;
  status: ArrivalStatus;
  appointmentId: string | null;
  clientId: string | null;
  petId: string | null;
  clientName: string | null;
  clientPhone: string | null;
  petName: string | null;
  visitReason: string | null;
  answers: Record<string, unknown>;
  roomId: string | null;
  roomName: string | null;
  pimsWriteStatus: string;
  pimsWriteSummary: string | null;
  exceptionReason: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ArrivalMatch = {
  appointmentId: string;
  clientId: string;
  petId: string;
  clientName: string;
  clientPhone: string;
  petName: string;
  appointmentDate: string;
  appointmentTime: string;
  appointmentType: string;
  doctor: string;
  status: string;
  waitMinutes: number;
};

export type ArrivalDeskSnapshot = {
  settings: ArrivalSettings;
  rooms: ClinicRoom[];
  arrivals: ArrivalIntake[];
};

export type SettingsRow = {
  room_assignment_enabled: boolean;
  questionnaire: ArrivalQuestionnaire | null;
};

export type RoomRow = {
  id: string;
  clinic_id: string;
  name: string;
  sort_order: number;
  state: RoomState;
  current_arrival_id: string | null;
  state_changed_at: string;
  auto_open_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ArrivalRow = {
  id: string;
  clinic_id: string;
  status: ArrivalStatus;
  appointment_id: string | null;
  client_id: string | null;
  pet_id: string | null;
  client_name: string | null;
  client_phone: string | null;
  pet_name: string | null;
  visit_reason: string | null;
  answers: Record<string, unknown> | null;
  room_id: string | null;
  room_name: string | null;
  pims_write_status: string;
  pims_write_summary: string | null;
  exception_reason: string | null;
  created_at: string;
  updated_at: string;
};

export type MatchRow = {
  appointment_id: string;
  client_id: string;
  pet_id: string;
  client_name: string;
  client_phone: string;
  pet_name: string;
  appointment_date: string | Date;
  appointment_time: string;
  appointment_type: string;
  doctor: string;
  status: string;
  wait_minutes: number;
};

const defaultQuestionnaire: ArrivalQuestionnaire = {
  visitReasons: ["Sick", "Vaccines", "Surgery", "Dental", "Routine"],
  sickSignsLabel: "What signs are you seeing?",
  sickSigns: ["Vomiting", "Diarrhea", "Coughing", "Other signs"],
  specialConcernsLabel: "Any special concerns?",
  vaccineFeelingLabel: "How is your pet feeling today?",
  surgeryAteLabel: "Did your pet eat today?",
  surgeryFeelingLabel: "How is your pet feeling today?",
  dentalConcernLabel: "Any dental concerns today?",
  routineConcernLabel: "Scratching, itching, routine vaccines, or anything else?"
};

function dateText(value: string | Date) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value.split("T")[0] || value;
}

export function normalizeSettings(row: SettingsRow | null | undefined): ArrivalSettings {
  return {
    roomAssignmentEnabled: row?.room_assignment_enabled ?? true,
    questionnaire: {
      ...defaultQuestionnaire,
      ...(row?.questionnaire ?? {})
    }
  };
}

export function normalizeRoom(row: RoomRow): ClinicRoom {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    name: row.name,
    sortOrder: row.sort_order,
    state: row.state,
    currentArrivalId: row.current_arrival_id,
    stateChangedAt: row.state_changed_at,
    autoOpenAt: row.auto_open_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function normalizeArrival(row: ArrivalRow): ArrivalIntake {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    status: row.status,
    appointmentId: row.appointment_id,
    clientId: row.client_id,
    petId: row.pet_id,
    clientName: row.client_name,
    clientPhone: row.client_phone,
    petName: row.pet_name,
    visitReason: row.visit_reason,
    answers: row.answers ?? {},
    roomId: row.room_id,
    roomName: row.room_name,
    pimsWriteStatus: row.pims_write_status,
    pimsWriteSummary: row.pims_write_summary,
    exceptionReason: row.exception_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function normalizeMatch(row: MatchRow): ArrivalMatch {
  return {
    appointmentId: row.appointment_id,
    clientId: row.client_id,
    petId: row.pet_id,
    clientName: row.client_name,
    clientPhone: row.client_phone,
    petName: row.pet_name,
    appointmentDate: dateText(row.appointment_date),
    appointmentTime: row.appointment_time,
    appointmentType: row.appointment_type,
    doctor: row.doctor,
    status: row.status,
    waitMinutes: row.wait_minutes
  };
}
