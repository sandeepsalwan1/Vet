import type { AppRole, Task, TaskEvent } from "@central-vet/db";
import type { TaskFormState } from "./TaskForm";
import { defaultDueTime, today } from "./taskBoardDisplay";

export function blankTaskForm(): TaskFormState {
  return {
    status: "due",
    requestType: "labs_xrays",
    clientName: "",
    clarityId: "",
    clientPhone: "",
    clientDateOfBirth: "",
    petName: "",
    petWeight: "",
    lastVisit: "",
    request: "",
    notes: "",
    assignedTo: "",
    priority: "medium",
    dueDate: today(),
    dueTime: defaultDueTime
  };
}

export function taskFormFromTask(task: Task): TaskFormState {
  return {
    status: task.status === "archived" ? "pending_review" : task.status,
    requestType: task.requestType,
    clientName: task.clientName ?? "",
    clarityId: task.clarityId ?? "",
    clientPhone: task.clientPhone ?? "",
    clientDateOfBirth: task.clientDateOfBirth ?? "",
    petName: task.petName ?? "",
    petWeight: task.petWeight ?? "",
    lastVisit: task.lastVisit ?? "",
    request: task.request,
    notes: task.notes ?? "",
    assignedTo: task.assignedTo ?? "",
    priority: task.priority,
    dueDate: task.dueDate,
    dueTime: task.dueTime?.slice(0, 5) || defaultDueTime
  };
}

function renamedActorName(
  value: string | null,
  valueRole: AppRole | null,
  role: AppRole,
  oldName: string,
  nextName: string
) {
  return valueRole === role && value === oldName ? nextName : value;
}

export function renameTaskActorNames(task: Task, role: AppRole, oldName: string, nextName: string): Task {
  return {
    ...task,
    assignedTo: renamedActorName(task.assignedTo, task.assignedByRole, role, oldName, nextName),
    createdByName: renamedActorName(task.createdByName, task.createdByRole, role, oldName, nextName),
    completedByName: renamedActorName(task.completedByName, task.completedByRole, role, oldName, nextName),
    archivedByName: renamedActorName(task.archivedByName, task.archivedByRole, role, oldName, nextName),
    escalatedByName: renamedActorName(task.escalatedByName, task.escalatedByRole, role, oldName, nextName)
  };
}

export function renameEventActorNames(event: TaskEvent, role: AppRole, oldName: string, nextName: string): TaskEvent {
  const metadata = { ...event.metadata };
  if (metadata.previousAssignedByRole === role && metadata.previousAssignedTo === oldName) {
    metadata.previousAssignedTo = nextName;
  }
  if (metadata.assignedByRole === role && metadata.assignedTo === oldName) {
    metadata.assignedTo = nextName;
  }
  return {
    ...event,
    actorName: renamedActorName(event.actorName, event.actorRole, role, oldName, nextName),
    metadata
  };
}
