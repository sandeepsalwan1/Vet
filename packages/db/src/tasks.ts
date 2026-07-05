import { getSql } from "./connection";
import { getClinicById, resolveClinicId } from "./clinics";
import { logTaskEvent } from "./taskAudit";
import type {
  Actor,
  AppRole,
  CreateTaskInput,
  UpdateTaskInput
} from "./types";
import {
  normalizeTask,
  taskColumns,
  type TaskRow
} from "./taskRows";
import {
  cleanTaskText,
  taskInsertRow,
  taskPatchRow
} from "./taskWriteRows";

function canManageRole(role: AppRole | undefined) {
  return role === "va" ||
    role === "task_adder" ||
    role === "veterinarian" ||
    role === "admin";
}

export async function listTasks(options?: {
  clinicId?: string | null;
  role?: AppRole;
  includeArchived?: boolean;
}) {
  const sql = getSql();
  const clinicId = await resolveClinicId(options?.clinicId);
  const includeArchived =
    options?.includeArchived && canManageRole(options.role);

  const rows = includeArchived
    ? await sql<TaskRow[]>`
        select ${sql.unsafe(taskColumns)} from tasks
        where clinic_id = ${clinicId}
        order by
          case when status = 'archived' then 1 else 0 end,
          due_date asc,
          case
            when source = 'task_adder' then 0
            when source = 'va' then 0
            when source = 'admin' then 1
            when source = 'veterinarian' then 2
            when source = 'staff_request' then 3
            else 3
          end,
          due_time asc,
          created_at asc
      `
    : options?.role === "staff"
      ? await sql<TaskRow[]>`
          select ${sql.unsafe(taskColumns)} from tasks
          where clinic_id = ${clinicId}
            and archived_at is null
            and status <> 'archived'
            and status <> 'pending_review'
            and status <> 'invalid'
          order by
            due_date asc,
            case
              when source = 'task_adder' then 0
              when source = 'va' then 0
              when source = 'admin' then 1
              when source = 'veterinarian' then 2
              when source = 'staff_request' then 3
              else 3
            end,
            due_time asc,
            created_at asc
        `
      : await sql<TaskRow[]>`
          select ${sql.unsafe(taskColumns)} from tasks
          where clinic_id = ${clinicId}
            and archived_at is null
            and status <> 'archived'
          order by
            due_date asc,
            case
              when source = 'task_adder' then 0
              when source = 'va' then 0
              when source = 'admin' then 1
              when source = 'veterinarian' then 2
              when source = 'staff_request' then 3
              else 3
            end,
            due_time asc,
            created_at asc
        `;

  return rows.map(normalizeTask);
}

export async function getTask(id: string, options?: { clinicId?: string | null }) {
  const sql = getSql();
  const clinicId = await resolveClinicId(options?.clinicId);
  const rows = await sql<TaskRow[]>`
    select ${sql.unsafe(taskColumns)}
    from tasks
    where id = ${id}
      and clinic_id = ${clinicId}
  `;
  return rows[0] ? normalizeTask(rows[0]) : null;
}

export async function createTask(input: CreateTaskInput, actor: Actor) {
  const sql = getSql();
  const clinicId = await resolveClinicId(input.clinicId);
  const clinic = input.hospitalName?.trim() ? null : await getClinicById(clinicId);
  const row = taskInsertRow(
    clinic ? { ...input, hospitalName: clinic.name } : input,
    actor,
    clinicId
  );
  const rows = await sql<TaskRow[]>`
    insert into tasks ${sql(row)}
    returning ${sql.unsafe(taskColumns)}
  `;
  const task = normalizeTask(rows[0]);
  await logTaskEvent({
    clinicId,
    taskId: task.id,
    actor,
    eventType:
      input.source === "client_form" ? "client_request_created" : "created",
    previousStatus: null,
    nextStatus: task.status,
    metadata: { source: input.source }
  });
  return task;
}

export async function editTask(
  id: string,
  input: UpdateTaskInput,
  actor: Actor,
  options?: { clinicId?: string | null }
) {
  const sql = getSql();
  const clinicId = await resolveClinicId(options?.clinicId);
  const patch = taskPatchRow(input, actor);
  const rows = await sql<TaskRow[]>`
    update tasks
    set ${sql(patch)}, updated_at = now()
    where id = ${id}
      and clinic_id = ${clinicId}
    returning ${sql.unsafe(taskColumns)}
  `;
  let task = rows[0] ? normalizeTask(rows[0]) : null;
  if (task && "assignedTo" in input) {
    const assignedRole = cleanTaskText(input.assignedTo) ? actor.role : null;
    const assignedRows = await sql<TaskRow[]>`
      update tasks
      set assigned_by_role = ${assignedRole}::app_role
      where id = ${id}
        and clinic_id = ${clinicId}
      returning ${sql.unsafe(taskColumns)}
    `;
    task = assignedRows[0] ? normalizeTask(assignedRows[0]) : task;
  }
  if (task) {
    await logTaskEvent({
      clinicId,
      taskId: id,
      actor,
      eventType: "edited",
      previousStatus: task.status,
      nextStatus: task.status,
      metadata: { fields: Object.keys(patch).filter((key) => key !== "updated_by_name") }
    });
  }
  return task;
}

export async function renameActorReferences(args: {
  actor: Actor;
  oldName: string;
  newName: string;
  clinicId?: string | null;
}) {
  const oldName = cleanTaskText(args.oldName);
  const newName = cleanTaskText(args.newName);
  if (!oldName || !newName || oldName === newName) {
    return { tasksUpdated: 0, eventsUpdated: 0 };
  }

  const sql = getSql();
  const clinicId = await resolveClinicId(args.clinicId);
  const role = args.actor.role;
  const taskRows = await sql<{ id: string }[]>`
    update tasks
    set
      assigned_to = case
        when assigned_by_role = ${role}::app_role and assigned_to = ${oldName} then ${newName}
        else assigned_to
      end,
      created_by_name = case
        when created_by_role = ${role}::app_role and created_by_name = ${oldName} then ${newName}
        else created_by_name
      end,
      completed_by_name = case
        when completed_by_role = ${role}::app_role and completed_by_name = ${oldName} then ${newName}
        else completed_by_name
      end,
      archived_by_name = case
        when archived_by_role = ${role}::app_role and archived_by_name = ${oldName} then ${newName}
        else archived_by_name
      end,
      escalated_by_name = case
        when escalated_by_role = ${role}::app_role and escalated_by_name = ${oldName} then ${newName}
        else escalated_by_name
      end,
      updated_at = now()
    where clinic_id = ${clinicId}
      and ((assigned_by_role = ${role}::app_role and assigned_to = ${oldName})
      or (created_by_role = ${role}::app_role and created_by_name = ${oldName})
      or (completed_by_role = ${role}::app_role and completed_by_name = ${oldName})
      or (archived_by_role = ${role}::app_role and archived_by_name = ${oldName})
      or (escalated_by_role = ${role}::app_role and escalated_by_name = ${oldName}))
    returning id
  `;

  const eventRows = await sql<{ id: string }[]>`
    update task_events
    set
      actor_name = case
        when actor_role = ${role}::app_role and actor_name = ${oldName} then ${newName}
        else actor_name
      end,
      metadata = case
        when metadata->>'previousAssignedByRole' = ${role}::text
          and metadata->>'previousAssignedTo' = ${oldName}
          and metadata->>'assignedByRole' = ${role}::text
          and metadata->>'assignedTo' = ${oldName}
          then metadata || jsonb_build_object('previousAssignedTo', ${newName}::text, 'assignedTo', ${newName}::text)
        when metadata->>'previousAssignedByRole' = ${role}::text
          and metadata->>'previousAssignedTo' = ${oldName}
          then metadata || jsonb_build_object('previousAssignedTo', ${newName}::text)
        when metadata->>'assignedByRole' = ${role}::text
          and metadata->>'assignedTo' = ${oldName}
          then metadata || jsonb_build_object('assignedTo', ${newName}::text)
        else metadata
      end
    where clinic_id = ${clinicId}
      and ((actor_role = ${role}::app_role and actor_name = ${oldName})
      or (metadata->>'previousAssignedByRole' = ${role}::text and metadata->>'previousAssignedTo' = ${oldName})
      or (metadata->>'assignedByRole' = ${role}::text and metadata->>'assignedTo' = ${oldName}))
    returning id
  `;

  return {
    tasksUpdated: taskRows.length,
    eventsUpdated: eventRows.length
  };
}

export async function listIncompletePriorityTasks(
  localDate: string,
  options?: { clinicId?: string | null }
) {
  const sql = getSql();
  const clinicId = await resolveClinicId(options?.clinicId);
  const rows = await sql<TaskRow[]>`
    select ${sql.unsafe(taskColumns)} from tasks
    where archived_at is null
      and clinic_id = ${clinicId}
      and status in ('pending_review', 'due', 'pending')
      and priority in ('medium', 'high')
      and due_date <= ${localDate}
    order by
      case when priority = 'high' then 0 else 1 end,
      due_date asc,
      due_time asc,
      created_at asc
  `;
  return rows.map(normalizeTask);
}
