import type { AppRole, Task } from "@central-vet/db";

function staffSafeActorName(role: AppRole | null, name: string | null) {
  if (role === "va" || role === "task_adder") return "VA";
  if (role === "admin") return "Admin";
  return name;
}

export function sanitizeTaskForActor(task: Task, role: AppRole) {
  if (role !== "staff") return task;
  const adminOrVaSource =
    task.source === "admin" ||
    task.source === "va" ||
    task.source === "task_adder";
  const assignedTo =
    task.status === "pending"
      ? staffSafeActorName(task.assignedByRole, task.assignedTo)
      : adminOrVaSource
        ? null
        : task.assignedTo;

  return {
    ...task,
    assignedTo,
    updatedByName: null,
    createdByName: staffSafeActorName(task.createdByRole, task.createdByName),
    completedByName: staffSafeActorName(task.completedByRole, task.completedByName),
    archivedByName: staffSafeActorName(task.archivedByRole, task.archivedByName),
    escalatedByName: staffSafeActorName(task.escalatedByRole, task.escalatedByName)
  };
}
