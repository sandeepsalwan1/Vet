import { undoLastStatusChange } from "@central-vet/db";
import { NextResponse } from "next/server";
import { z } from "zod";
import { canManage } from "../../../../lib/taskWorkflow";
import { logInfo, logWarn } from "../../../_apiResponse";
import {
  authenticateActor,
  actorSchema,
  resolveClinicFromRequest
} from "../../../_shared";
import { sanitizeTaskForActor } from "../../_taskVisibility";

const bodySchema = z.object({
  actor: actorSchema
});

export async function taskUndoResponse(args: {
  request: Request;
  id: string;
}) {
  const body = bodySchema.safeParse(await args.request.json());
  if (!body.success) {
    logWarn("task_undo_rejected", { reason: "invalid_payload" });
    return NextResponse.json({ error: "Invalid undo request." }, { status: 400 });
  }

  const clinic = await resolveClinicFromRequest(args.request);
  const auth = await authenticateActor(body.data.actor, args.request, clinic);
  if ("response" in auth) {
    logWarn("task_undo_rejected", {
      taskId: args.id,
      reason: "unauthorized",
      actorRole: body.data.actor.role
    });
    return auth.response;
  }
  if (!canManage(auth.actor.role)) {
    logWarn("task_undo_rejected", {
      taskId: args.id,
      reason: "unauthorized",
      actorRole: body.data.actor.role
    });
    return NextResponse.json({ error: "Undo not allowed." }, { status: 403 });
  }

  const actor = auth.actor;
  const task = await undoLastStatusChange(args.id, actor, { clinicId: clinic.clinicId });
  if (task) {
    logInfo("task_updated", {
      taskId: args.id,
      action: "undo",
      actorRole: actor.role,
      status: task.status
    });
  }
  return NextResponse.json({ task: task ? sanitizeTaskForActor(task, actor.role) : task });
}
