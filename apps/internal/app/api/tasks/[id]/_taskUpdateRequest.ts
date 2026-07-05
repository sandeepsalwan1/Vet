import {
  editTask,
  escalateTask,
  getTask,
  transitionTask,
  type Actor,
  type Task,
  type TaskStatus,
  type UpdateTaskInput
} from "@central-vet/db";
import { sendEscalationAlert } from "@central-vet/notifications";
import { NextResponse } from "next/server";
import { z } from "zod";
import { persistedStatusForRequest, validateTaskAction } from "../../../lib/taskWorkflow";
import { logError, logInfo, logWarn } from "../../_apiResponse";
import {
  authenticateActor,
  actorSchema,
  resolveClinicFromRequest
} from "../../_shared";
import { sanitizeTaskForActor } from "../_taskVisibility";

const editableSchema = z.object({
  clientName: z.string().trim().min(1).max(120).optional(),
  clarityId: z.string().trim().max(120).optional().nullable(),
  clientPhone: z.string().trim().min(7).max(80).optional().nullable(),
  clientDateOfBirth: z.string().trim().optional().nullable(),
  petName: z.string().trim().min(1).max(120).optional(),
  petWeight: z.string().trim().max(80).optional().nullable(),
  lastVisit: z.string().optional().nullable(),
  request: z.string().trim().min(10).max(4000).optional(),
  requestType: z
    .enum(["prescription", "labs_xrays", "records_request", "scheduling", "patient_update"])
    .optional()
    .nullable(),
  notes: z.string().trim().max(4000).optional().nullable(),
  assignedTo: z.string().trim().max(120).optional().nullable(),
  priority: z.enum(["low", "medium", "high"]).optional().nullable(),
  dueDate: z.string().optional().nullable(),
  dueTime: z.string().optional().nullable()
});

const taskUpdateBodySchema = z.object({
  action: z.enum(["edit", "status", "archive", "restore", "escalate"]),
  task: editableSchema.optional(),
  nextStatus: z
    .enum(["pending_review", "due", "pending", "completed", "invalid", "archived"])
    .optional(),
  invalidReason: z.string().trim().max(500).optional().nullable()
});

type TaskUpdateBody = z.infer<typeof taskUpdateBodySchema>;

type TaskUpdateError = {
  error: string;
  status: 400 | 403 | 404;
};

type TaskUpdateSuccess = {
  task: Task | null;
  action: TaskUpdateBody["action"];
  nextStatus?: TaskStatus;
};

async function applyTaskUpdateAction(args: {
  id: string;
  clinicId: string;
  actor: Actor;
  body: TaskUpdateBody;
  onEscalationAlertError?: (error: unknown, taskId: string) => void;
}): Promise<TaskUpdateError | TaskUpdateSuccess> {
  if (args.body.action === "status" && !args.body.nextStatus) {
    return { error: "Missing next status.", status: 400 };
  }

  const currentTask = await getTask(args.id, { clinicId: args.clinicId });
  if (!currentTask) {
    return { error: "Task not found.", status: 404 };
  }

  const workflowError = validateTaskAction({
    action: args.body.action,
    actorRole: args.actor.role,
    currentTask,
    nextStatus: args.body.nextStatus
  });
  if (workflowError) return workflowError;

  if (args.body.action === "edit") {
    const task = await editTask(
      args.id,
      (args.body.task ?? {}) as UpdateTaskInput,
      args.actor,
      { clinicId: args.clinicId }
    );
    return { task, action: "edit" };
  }

  if (args.body.action === "archive") {
    const task = await transitionTask({
      id: args.id,
      nextStatus: "archived",
      actor: args.actor,
      clinicId: args.clinicId
    });
    return { task, action: "archive" };
  }

  if (args.body.action === "restore") {
    const task = await transitionTask({
      id: args.id,
      nextStatus: "due",
      actor: args.actor,
      clinicId: args.clinicId
    });
    return { task, action: "restore" };
  }

  if (args.body.action === "escalate") {
    const task = await escalateTask(args.id, args.actor, { clinicId: args.clinicId });
    if (task) {
      await sendEscalationAlert(task).catch((error) => {
        args.onEscalationAlertError?.(error, task.id);
      });
    }
    return { task, action: "escalate" };
  }

  const nextStatus = args.body.nextStatus;
  if (!nextStatus) {
    return { error: "Missing next status.", status: 400 };
  }
  const task = await transitionTask({
    id: args.id,
    nextStatus: persistedStatusForRequest(nextStatus),
    actor: args.actor,
    invalidReason: args.body.invalidReason,
    clinicId: args.clinicId
  });
  return { task, action: "status", nextStatus };
}

export async function taskUpdateResponse(args: {
  request: Request;
  id: string;
}) {
  const rawBody = await args.request.json();
  const actorResult = actorSchema.safeParse(rawBody.actor);
  const bodyResult = taskUpdateBodySchema.safeParse(rawBody);
  if (!actorResult.success || !bodyResult.success) {
    logWarn("task_update_rejected", { reason: "invalid_payload" });
    return NextResponse.json({ error: "Invalid task update." }, { status: 400 });
  }

  const clinic = await resolveClinicFromRequest(args.request);
  const auth = await authenticateActor(actorResult.data, args.request, clinic);
  if ("response" in auth) {
    logWarn("task_update_rejected", {
      taskId: args.id,
      reason: "invalid_passcode",
      actorRole: actorResult.data.role
    });
    return auth.response;
  }

  const actor = auth.actor;
  const result = await applyTaskUpdateAction({
    id: args.id,
    clinicId: clinic.clinicId,
    actor,
    body: bodyResult.data,
    onEscalationAlertError: (error, taskId) => {
      logError("escalation_notification_failed", error, { taskId });
    }
  });
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  if (result.task) {
    logInfo("task_updated", {
      taskId: args.id,
      action: result.action,
      actorRole: actor.role,
      nextStatus: result.nextStatus,
      status: result.task.status
    });
  }
  return NextResponse.json({
    task: result.task ? sanitizeTaskForActor(result.task, actor.role) : result.task
  });
}
