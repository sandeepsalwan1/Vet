export type AppRole = "staff" | "va" | "veterinarian" | "admin" | "task_adder";

export type TaskStatus =
  | "pending_review"
  | "due"
  | "pending"
  | "completed"
  | "invalid"
  | "archived";

export type TaskSource =
  | "client_form"
  | "va"
  | "task_adder"
  | "staff_request"
  | "veterinarian"
  | "admin";

export type TaskPriority = "low" | "medium" | "high";
export type TaskRequestType =
  | "prescription"
  | "labs_xrays"
  | "records_request"
  | "scheduling"
  | "patient_update";

export type Actor = {
  name: string;
  role: AppRole;
  profileId?: string | null;
};

export type Task = {
  id: string;
  clinicId: string;
  hospitalName: string;
  status: TaskStatus;
  source: TaskSource;
  clientName: string | null;
  clarityId: string | null;
  clientPhone: string | null;
  clientDateOfBirth: string | null;
  petName: string | null;
  petWeight: string | null;
  lastVisit: string | null;
  request: string;
  requestType: TaskRequestType;
  notes: string | null;
  assignedTo: string | null;
  assignedByRole: AppRole | null;
  priority: TaskPriority;
  dueDate: string;
  dueTime: string;
  createdByName: string | null;
  createdByRole: AppRole | null;
  updatedByName: string | null;
  completedByName: string | null;
  completedByRole: AppRole | null;
  completedAt: string | null;
  invalidReason: string | null;
  archivedAt: string | null;
  archivedByName: string | null;
  archivedByRole: AppRole | null;
  escalatedAt: string | null;
  escalatedByName: string | null;
  escalatedByRole: AppRole | null;
  createdAt: string;
  updatedAt: string;
};

export type TaskEvent = {
  id: string;
  taskId: string;
  actorName: string | null;
  actorRole: AppRole | null;
  eventType: string;
  previousStatus: TaskStatus | null;
  nextStatus: TaskStatus | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type CreateTaskInput = {
  clinicId?: string | null;
  status: TaskStatus;
  source: TaskSource;
  clientName?: string | null;
  clarityId?: string | null;
  clientPhone?: string | null;
  clientDateOfBirth?: string | null;
  petName?: string | null;
  petWeight?: string | null;
  lastVisit?: string | null;
  request: string;
  requestType?: TaskRequestType | null;
  notes?: string | null;
  assignedTo?: string | null;
  priority?: TaskPriority | null;
  dueDate?: string | null;
  dueTime?: string | null;
  hospitalName?: string | null;
};

export type UpdateTaskInput = Partial<
  Pick<
    CreateTaskInput,
    | "clientName"
    | "clientPhone"
    | "clarityId"
    | "clientDateOfBirth"
    | "petName"
    | "petWeight"
    | "lastVisit"
    | "request"
    | "requestType"
    | "notes"
    | "assignedTo"
    | "priority"
    | "dueDate"
    | "dueTime"
  >
>;
