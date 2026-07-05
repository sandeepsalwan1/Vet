import type { AppRole, Task, TaskEvent, TaskStatus } from "./types";

export type TaskRow = {
  id: string;
  clinic_id: string;
  hospital_name: string;
  status: TaskStatus;
  source: Task["source"];
  client_name: string | null;
  clarity_id: string | null;
  client_phone: string | null;
  client_date_of_birth: string | null;
  pet_name: string | null;
  pet_weight: string | null;
  last_visit: string | null;
  request: string;
  request_type: Task["requestType"];
  notes: string | null;
  assigned_to: string | null;
  assigned_by_role: AppRole | null;
  priority: Task["priority"];
  due_date: string;
  due_time: string;
  created_by_name: string | null;
  created_by_role: AppRole | null;
  updated_by_name: string | null;
  completed_by_name: string | null;
  completed_by_role: AppRole | null;
  completed_at: string | null;
  invalid_reason: string | null;
  archived_at: string | null;
  archived_by_name: string | null;
  archived_by_role: AppRole | null;
  escalated_at: string | null;
  escalated_by_name: string | null;
  escalated_by_role: AppRole | null;
  created_at: string;
  updated_at: string;
};

export type EventRow = {
  id: string;
  clinic_id: string;
  task_id: string;
  actor_name: string | null;
  actor_role: AppRole | null;
  event_type: string;
  previous_status: TaskStatus | null;
  next_status: TaskStatus | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

export const taskColumns = `
  id,
  clinic_id,
  hospital_name,
  status,
  source,
  client_name,
  clarity_id,
  client_phone,
  client_date_of_birth,
  pet_name,
  pet_weight,
  last_visit,
  request,
  request_type,
  notes,
  assigned_to,
  assigned_by_role,
  priority,
  due_date,
  due_time,
  created_by_name,
  created_by_role,
  updated_by_name,
  completed_by_name,
  completed_by_role,
  completed_at,
  invalid_reason,
  archived_at,
  archived_by_name,
  archived_by_role,
  escalated_at,
  escalated_by_name,
  escalated_by_role,
  created_at,
  updated_at
`;

export const eventColumns = `
  id,
  clinic_id,
  task_id,
  actor_name,
  actor_role,
  event_type,
  previous_status,
  next_status,
  metadata,
  created_at
`;

export function metadataText(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value : null;
}

export function metadataRole(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  return value === "staff" ||
    value === "va" ||
    value === "task_adder" ||
    value === "veterinarian" ||
    value === "admin"
    ? value
    : null;
}

export function normalizeTask(row: TaskRow): Task {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    hospitalName: row.hospital_name,
    status: row.status,
    source: row.source,
    clientName: row.client_name,
    clarityId: row.clarity_id,
    clientPhone: row.client_phone,
    clientDateOfBirth: row.client_date_of_birth,
    petName: row.pet_name,
    petWeight: row.pet_weight,
    lastVisit: row.last_visit,
    request: row.request,
    requestType: row.request_type,
    notes: row.notes,
    assignedTo: row.assigned_to,
    assignedByRole: row.assigned_by_role,
    priority: row.priority,
    dueDate: row.due_date,
    dueTime: row.due_time,
    createdByName: row.created_by_name,
    createdByRole: row.created_by_role,
    updatedByName: row.updated_by_name,
    completedByName: row.completed_by_name,
    completedByRole: row.completed_by_role,
    completedAt: row.completed_at,
    invalidReason: row.invalid_reason,
    archivedAt: row.archived_at,
    archivedByName: row.archived_by_name,
    archivedByRole: row.archived_by_role,
    escalatedAt: row.escalated_at,
    escalatedByName: row.escalated_by_name,
    escalatedByRole: row.escalated_by_role,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function normalizeEvent(row: EventRow): TaskEvent {
  return {
    id: row.id,
    taskId: row.task_id,
    actorName: row.actor_name,
    actorRole: row.actor_role,
    eventType: row.event_type,
    previousStatus: row.previous_status,
    nextStatus: row.next_status,
    metadata: row.metadata ?? {},
    createdAt: row.created_at
  };
}
