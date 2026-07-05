import { resolveClinicId } from "./clinics";
import { getSql } from "./connection";
import {
  logTaskEvent,
  type TaskEventMetadata
} from "./taskAudit";
import {
  cleanTaskText
} from "./taskWriteRows";
import type {
  Actor,
  TaskStatus
} from "./types";
import {
  eventColumns,
  metadataRole,
  metadataText,
  normalizeTask,
  taskColumns,
  type EventRow,
  type TaskRow
} from "./taskRows";

async function getTaskInClinic(id: string, clinicId: string) {
  const sql = getSql();
  const rows = await sql<TaskRow[]>`
    select ${sql.unsafe(taskColumns)}
    from tasks
    where id = ${id}
      and clinic_id = ${clinicId}
  `;
  return rows[0] ? normalizeTask(rows[0]) : null;
}

export async function transitionTask(args: {
  id: string;
  nextStatus: TaskStatus;
  actor: Actor;
  invalidReason?: string | null;
  clinicId?: string | null;
}) {
  const sql = getSql();
  const clinicId = await resolveClinicId(args.clinicId);
  const previous = await getTaskInClinic(args.id, clinicId);
  if (!previous) return null;

  const rows =
    args.nextStatus === "completed"
      ? await sql<TaskRow[]>`
          update tasks
          set status = ${args.nextStatus},
            updated_by_name = ${args.actor.name},
            assigned_to = null,
            assigned_by_role = null,
            completed_by_name = ${args.actor.name},
            completed_by_role = ${args.actor.role}::app_role,
            completed_at = now(),
            invalid_reason = null,
            archived_at = null,
            archived_by_name = null,
            archived_by_role = null,
            updated_at = now()
          where id = ${args.id}
            and clinic_id = ${clinicId}
          returning ${sql.unsafe(taskColumns)}
        `
      : args.nextStatus === "invalid"
        ? await sql<TaskRow[]>`
            update tasks
            set status = ${args.nextStatus},
              updated_by_name = ${args.actor.name},
              assigned_to = null,
              assigned_by_role = null,
              completed_by_name = null,
              completed_by_role = null,
              completed_at = null,
              invalid_reason = ${cleanTaskText(args.invalidReason) || "Marked invalid"},
              archived_at = null,
              archived_by_name = null,
              archived_by_role = null,
              updated_at = now()
            where id = ${args.id}
              and clinic_id = ${clinicId}
            returning ${sql.unsafe(taskColumns)}
          `
        : args.nextStatus === "archived"
          ? await sql<TaskRow[]>`
              update tasks
              set status = ${args.nextStatus},
                updated_by_name = ${args.actor.name},
                assigned_to = null,
                assigned_by_role = null,
                invalid_reason = ${cleanTaskText(args.invalidReason)},
                archived_at = now(),
                archived_by_name = ${args.actor.name},
                archived_by_role = ${args.actor.role}::app_role,
                updated_at = now()
              where id = ${args.id}
                and clinic_id = ${clinicId}
              returning ${sql.unsafe(taskColumns)}
            `
          : await sql<TaskRow[]>`
              update tasks
              set status = ${args.nextStatus},
                updated_by_name = ${args.actor.name},
                assigned_to = case when ${args.nextStatus} = 'pending' then ${args.actor.name} else null end,
                assigned_by_role = case when ${args.nextStatus} = 'pending' then ${args.actor.role}::app_role else null end,
                completed_by_name = null,
                completed_by_role = null,
                completed_at = null,
                invalid_reason = null,
                archived_at = null,
                archived_by_name = null,
                archived_by_role = null,
                updated_at = now()
              where id = ${args.id}
                and clinic_id = ${clinicId}
              returning ${sql.unsafe(taskColumns)}
            `;
  const task = rows[0] ? normalizeTask(rows[0]) : null;
  if (!task) return null;

  const eventType =
    args.nextStatus === "completed"
      ? "completed"
      : args.nextStatus === "invalid"
        ? "marked_invalid"
        : args.nextStatus === "archived"
          ? cleanTaskText(args.invalidReason)
            ? "marked_invalid"
            : "archived"
          : previous.status === "archived"
            ? "restored"
            : "status_changed";
  const metadata: TaskEventMetadata = {};
  const invalidReason = cleanTaskText(args.invalidReason);
  if (invalidReason) metadata.invalidReason = invalidReason;
  if (previous.status === "pending") {
    metadata.previousAssignedTo = previous.assignedTo;
    metadata.previousAssignedByRole = previous.assignedByRole;
  }
  if (args.nextStatus === "pending") {
    metadata.assignedTo = args.actor.name;
    metadata.assignedByRole = args.actor.role;
  }

  await logTaskEvent({
    clinicId,
    taskId: args.id,
    actor: args.actor,
    eventType,
    previousStatus: previous.status,
    nextStatus: args.nextStatus,
    metadata
  });
  return task;
}

export async function archiveCompletedTasksBefore(
  localDate: string,
  actor: Actor,
  timeZone = "America/Los_Angeles",
  options?: { clinicId?: string | null }
) {
  const sql = getSql();
  const clinicId = await resolveClinicId(options?.clinicId);
  const rows = await sql<TaskRow[]>`
    update tasks
    set status = 'archived',
      updated_by_name = ${actor.name},
      assigned_to = null,
      assigned_by_role = null,
      archived_at = now(),
      archived_by_name = ${actor.name},
      archived_by_role = ${actor.role}::app_role,
      updated_at = now()
    where archived_at is null
      and clinic_id = ${clinicId}
      and status = 'completed'
      and completed_at is not null
      and (completed_at at time zone ${timeZone})::date < ${localDate}::date
    returning ${sql.unsafe(taskColumns)}
  `;
  const tasks = rows.map(normalizeTask);
  for (const task of tasks) {
    await logTaskEvent({
      clinicId,
      taskId: task.id,
      actor,
      eventType: "auto_archived",
      previousStatus: "completed",
      nextStatus: "archived",
      metadata: {
        reason: "completed_before_today",
        localDate
      }
    });
  }
  return tasks;
}

export async function escalateTask(
  taskId: string,
  actor: Actor,
  options?: { clinicId?: string | null }
) {
  const sql = getSql();
  const clinicId = await resolveClinicId(options?.clinicId);
  const previous = await getTaskInClinic(taskId, clinicId);
  if (!previous) return null;

  const rows = await sql<TaskRow[]>`
    update tasks
    set escalated_at = coalesce(escalated_at, now()),
      escalated_by_name = coalesce(escalated_by_name, ${actor.name}),
      escalated_by_role = coalesce(escalated_by_role, ${actor.role}::app_role),
      updated_by_name = ${actor.name},
      updated_at = now()
    where id = ${taskId}
      and clinic_id = ${clinicId}
    returning ${sql.unsafe(taskColumns)}
  `;
  const task = rows[0] ? normalizeTask(rows[0]) : null;
  if (task) {
    await logTaskEvent({
      clinicId,
      taskId,
      actor,
      eventType: previous.escalatedAt ? "escalation_seen" : "escalated",
      previousStatus: previous.status,
      nextStatus: task.status,
      metadata: {
        requestType: task.requestType,
        alreadyEscalated: Boolean(previous.escalatedAt)
      }
    });
  }
  return task;
}

export async function undoLastStatusChange(
  taskId: string,
  actor: Actor,
  options?: { clinicId?: string | null }
) {
  const sql = getSql();
  const clinicId = await resolveClinicId(options?.clinicId);
  const events = await sql<EventRow[]>`
    select ${sql.unsafe(eventColumns)} from task_events
    where task_id = ${taskId}
      and clinic_id = ${clinicId}
      and previous_status is not null
      and next_status is not null
      and event_type <> 'undo'
    order by created_at desc
    limit 1
  `;
  const event = events[0];
  if (!event?.previous_status) return null;

  const restored = event.previous_status;
  const restoredAssignedTo = metadataText(event.metadata, "previousAssignedTo");
  const restoredAssignedByRole = metadataRole(event.metadata, "previousAssignedByRole");
  const rows = await sql<TaskRow[]>`
    update tasks
    set
      status = ${restored},
      updated_by_name = ${actor.name},
      assigned_to = case when ${restored} = 'pending' then ${restoredAssignedTo} else null end,
      assigned_by_role = case when ${restored} = 'pending' then ${restoredAssignedByRole}::app_role else null end,
      completed_by_name = case when ${restored} = 'completed' then completed_by_name else null end,
      completed_by_role = case when ${restored} = 'completed' then completed_by_role else null end,
      completed_at = case when ${restored} = 'completed' then completed_at else null end,
      invalid_reason = case when ${restored} = 'invalid' then invalid_reason else null end,
      archived_at = case when ${restored} = 'archived' then archived_at else null end,
      archived_by_name = case when ${restored} = 'archived' then archived_by_name else null end,
      archived_by_role = case when ${restored} = 'archived' then archived_by_role else null end,
      updated_at = now()
    where id = ${taskId}
      and clinic_id = ${clinicId}
    returning ${sql.unsafe(taskColumns)}
  `;
  const task = rows[0] ? normalizeTask(rows[0]) : null;
  if (task) {
    await logTaskEvent({
      clinicId,
      taskId,
      actor,
      eventType: "undo",
      previousStatus: event.next_status,
      nextStatus: restored,
      metadata: { undoneEventId: event.id }
    });
  }
  return task;
}
