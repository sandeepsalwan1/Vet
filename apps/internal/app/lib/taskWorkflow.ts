import type { AppRole, Task, TaskSource, TaskStatus } from "@central-vet/db";

type TaskAction = "edit" | "status" | "archive" | "restore" | "escalate";

type WorkflowError = {
  error: string;
  status: 400 | 403;
};

const managerRoles = new Set<AppRole>(["va", "task_adder", "veterinarian", "admin"]);
const staffInvalidBlockedSources = new Set<TaskSource>([
  "task_adder",
  "va",
  "veterinarian",
  "admin"
]);
const staffStatuses: TaskStatus[] = ["due", "pending", "completed", "invalid"];
const taskAdderStatuses: TaskStatus[] = ["due", "pending", "completed", "invalid"];

export function canManage(role: AppRole) {
  return managerRoles.has(role);
}

export function canAdmin(role: AppRole) {
  return role === "admin";
}

export function canSeeEscalations(role: AppRole) {
  return managerRoles.has(role);
}

export function canUseNotificationSettings(role: AppRole) {
  return role === "veterinarian" || role === "admin";
}

function canStaffEditTask(role: AppRole, task: Task) {
  return role === "staff" &&
    task.source === "staff_request" &&
    task.createdByRole === "staff";
}

export function canEditTask(role: AppRole, task: Task) {
  return canManage(role) || canStaffEditTask(role, task);
}

export function canMarkInvalid(role: AppRole, task: Task) {
  return !(role === "staff" && staffInvalidBlockedSources.has(task.source));
}

export function sourceForActor(role: AppRole): TaskSource {
  if (role === "staff") return "staff_request";
  if (role === "veterinarian") return "veterinarian";
  if (role === "admin") return "admin";
  return "va";
}

export function createStatusForActor(args: {
  role: AppRole;
  requestedStatus: TaskStatus;
  assignedTo: string | null;
}) {
  if (args.role === "staff") {
    return args.assignedTo ? "pending" : "due";
  }
  if (args.requestedStatus === "completed" || args.requestedStatus === "invalid") {
    return "due";
  }
  return args.requestedStatus;
}

export function persistedStatusForRequest(nextStatus: TaskStatus) {
  return nextStatus === "invalid" ? "archived" : nextStatus;
}

export function validateTaskAction(args: {
  action: TaskAction;
  actorRole: AppRole;
  currentTask: Task;
  nextStatus?: TaskStatus;
}): WorkflowError | null {
  const { action, actorRole, currentTask, nextStatus } = args;

  if (action === "edit") {
    return canEditTask(actorRole, currentTask)
      ? null
      : { error: "Edit not allowed.", status: 403 };
  }

  if (action === "archive") {
    if (!canManage(actorRole)) return { error: "Archive requires admin.", status: 403 };
    if (currentTask.status === "pending_review") {
      return { error: "Pending review tasks can only move to Due.", status: 403 };
    }
    return null;
  }

  if (action === "restore") {
    return canManage(actorRole)
      ? null
      : { error: "Restore requires admin.", status: 403 };
  }

  if (action === "escalate") {
    return currentTask.status === "completed" || currentTask.status === "archived"
      ? { error: "Completed or archived tasks cannot be escalated.", status: 403 }
      : null;
  }

  if (!nextStatus) return { error: "Missing next status.", status: 400 };

  if (
    currentTask.status === "pending_review" &&
    nextStatus !== "due" &&
    nextStatus !== "invalid"
  ) {
    return { error: "Pending review tasks can only move to Due or Invalid.", status: 403 };
  }

  if (actorRole === "staff" && !staffStatuses.includes(nextStatus)) {
    return { error: "Status not allowed.", status: 403 };
  }

  if (actorRole === "staff" && nextStatus === "invalid" && !canMarkInvalid(actorRole, currentTask)) {
    return { error: "Staff cannot mark VA, Admin, or Veterinarian tasks invalid.", status: 403 };
  }

  if ((actorRole === "task_adder" || actorRole === "va") && !taskAdderStatuses.includes(nextStatus)) {
    return { error: "Status not allowed.", status: 403 };
  }

  return null;
}

export function taskBelongsInLane(args: {
  task: Task;
  lane: TaskStatus | "escalated";
  viewerRole: AppRole;
}) {
  const activeEscalation =
    Boolean(args.task.escalatedAt) &&
    args.task.status !== "completed" &&
    args.task.status !== "archived";

  if (args.lane === "escalated") return activeEscalation;
  if (canSeeEscalations(args.viewerRole) && activeEscalation) return false;
  if (args.lane === "pending_review") return args.task.status === "pending_review";
  return args.task.status === args.lane;
}

export function isOpenPriorityTask(task: Task) {
  return (task.priority === "medium" || task.priority === "high") &&
    task.status !== "completed" &&
    task.status !== "archived" &&
    task.status !== "invalid";
}
