import type {
  Task,
  TaskEvent,
  TaskStatus
} from "@central-vet/db";
import { readJson } from "../lib/apiClient";
import { browserActorReadHeaders, browserActorReadQuery } from "../lib/browserActor";
import { canManage } from "../lib/taskWorkflow";
import type { TaskFormState } from "./TaskForm";
import type { TaskBoardSession } from "./taskBoardTypes";

type TaskBoardReadSession = Pick<TaskBoardSession, "name" | "role" | "passcode">;

export function sessionReadHeaders(currentSession: Pick<TaskBoardSession, "passcode">) {
  return browserActorReadHeaders(currentSession);
}

export function taskBoardActorQuery(currentSession: Pick<TaskBoardSession, "name" | "role">, includeArchived = canManage(currentSession.role)) {
  return browserActorReadQuery(currentSession, { includeArchived });
}

export async function readTaskBoardTasks(currentSession: TaskBoardReadSession, actorQuery = taskBoardActorQuery(currentSession)) {
  const data = await readJson<{ tasks: Task[] }>(
    await fetch(`/api/tasks?${actorQuery}`, {
      cache: "no-store",
      headers: sessionReadHeaders(currentSession)
    })
  );
  return data.tasks;
}

export async function readTaskBoardSnapshot(currentSession: TaskBoardReadSession, actorQuery = taskBoardActorQuery(currentSession)) {
  const fetchOptions: RequestInit = {
    cache: "no-store",
    headers: sessionReadHeaders(currentSession)
  };
  const taskRequest = readTaskBoardTasks(currentSession, actorQuery);
  const eventRequest = canManage(currentSession.role)
    ? fetch(`/api/events?${actorQuery}`, fetchOptions).then((response) => readJson<{ events: TaskEvent[] }>(response))
    : Promise.resolve({ events: [] });
  const [taskData, eventData] = await Promise.all([
    taskRequest,
    eventRequest
  ]);
  return {
    tasks: taskData,
    events: eventData.events
  };
}

export async function saveTaskBoardForm(args: {
  currentSession: TaskBoardSession;
  form: TaskFormState;
  editingTaskId?: string | null;
}) {
  const body = args.editingTaskId
    ? {
        actor: args.currentSession,
        action: "edit",
        task: args.form
      }
    : {
        actor: args.currentSession,
        task: args.form
      };
  return readJson(
    await fetch(args.editingTaskId ? `/api/tasks/${args.editingTaskId}` : "/api/tasks", {
      method: args.editingTaskId ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    })
  );
}

export async function updateTaskBoardStatus(args: {
  currentSession: TaskBoardSession;
  taskId: string;
  nextStatus: TaskStatus;
  invalidReason?: string;
}) {
  return readJson(
    await fetch(`/api/tasks/${args.taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        actor: args.currentSession,
        action: "status",
        nextStatus: args.nextStatus,
        invalidReason: args.invalidReason
      })
    })
  );
}

export async function setTaskBoardArchiveState(args: {
  currentSession: TaskBoardSession;
  taskId: string;
  action: "archive" | "restore";
}) {
  return readJson(
    await fetch(`/api/tasks/${args.taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        actor: args.currentSession,
        action: args.action
      })
    })
  );
}

export async function escalateTaskBoardTask(currentSession: TaskBoardSession, taskId: string) {
  return readJson(
    await fetch(`/api/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        actor: currentSession,
        action: "escalate"
      })
    })
  );
}

export async function undoTaskBoardStatus(currentSession: TaskBoardSession, taskId: string) {
  return readJson(
    await fetch(`/api/tasks/${taskId}/undo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actor: currentSession })
    })
  );
}
