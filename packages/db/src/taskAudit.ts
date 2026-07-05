import { resolveClinicId } from "./clinics";
import { getSql } from "./connection";
import type {
  Actor,
  TaskStatus
} from "./types";
import {
  eventColumns,
  normalizeEvent,
  type EventRow
} from "./taskRows";

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type TaskEventMetadata = { [key: string]: JsonValue };

export async function logTaskEvent(args: {
  clinicId: string;
  taskId: string;
  actor: Actor;
  eventType: string;
  previousStatus?: TaskStatus | null;
  nextStatus?: TaskStatus | null;
  metadata?: TaskEventMetadata;
}) {
  const sql = getSql();
  await sql`
    insert into task_events (
      task_id,
      clinic_id,
      actor_name,
      actor_role,
      event_type,
      previous_status,
      next_status,
      metadata
    )
    values (
      ${args.taskId},
      ${args.clinicId},
      ${args.actor.name},
      ${args.actor.role}::app_role,
      ${args.eventType},
      ${args.previousStatus ?? null},
      ${args.nextStatus ?? null},
      ${sql.json(args.metadata ?? {})}
    )
  `;
}

export async function listTaskEvents(limit = 60, options?: { clinicId?: string | null }) {
  const sql = getSql();
  const clinicId = await resolveClinicId(options?.clinicId);
  const rows = await sql<EventRow[]>`
    select ${sql.unsafe(eventColumns)} from task_events
    where clinic_id = ${clinicId}
    order by created_at desc
    limit ${limit}
  `;
  return rows.map(normalizeEvent);
}
