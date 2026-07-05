import {
  archiveCompletedTasksBefore,
  listTasks,
  type Actor,
  type ClinicContext
} from "@central-vet/db";
import { NextResponse } from "next/server";
import { logWarn, noStoreHeaders } from "../_apiResponse";
import {
  authenticateActorFromQuery,
  resolveClinicFromRequest
} from "../_shared";
import { sanitizeTaskForActor } from "./_taskVisibility";

const systemActor = { name: "System", role: "admin" as const };

function localDateString(
  timeZone = process.env.APP_TIME_ZONE || process.env.TZ || "America/Los_Angeles"
) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

async function taskListPayload(args: {
  actor: Actor;
  clinic: ClinicContext;
  includeArchived: boolean;
}) {
  await archiveCompletedTasksBefore(
    localDateString(),
    systemActor,
    args.clinic.timeZone || process.env.APP_TIME_ZONE || process.env.TZ || "America/Los_Angeles",
    { clinicId: args.clinic.clinicId }
  );
  const tasks = await listTasks({
    clinicId: args.clinic.clinicId,
    role: args.actor.role,
    includeArchived: args.includeArchived
  });
  return {
    tasks: tasks.map((task) => sanitizeTaskForActor(task, args.actor.role))
  };
}

export async function taskListResponse(request: Request) {
  const url = new URL(request.url);
  const clinic = await resolveClinicFromRequest(request);
  const auth = await authenticateActorFromQuery(url, request, clinic);
  if ("response" in auth) {
    logWarn("tasks_list_rejected", { reason: "invalid_actor" });
    return auth.response;
  }

  const includeArchived = url.searchParams.get("includeArchived") === "true";
  return NextResponse.json(
    await taskListPayload({ actor: auth.actor, clinic, includeArchived }),
    { headers: noStoreHeaders }
  );
}
