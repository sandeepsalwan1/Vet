import type { StaffClientJourneySnapshot } from "@central-vet/db";
import { readJson } from "../lib/apiClient";
import { sessionReadHeaders } from "./taskBoardClient";
import type { TaskBoardSession } from "./taskBoardTypes";

export async function readStaffClientJourney(session: TaskBoardSession, actorQuery: string) {
  return readJson<StaffClientJourneySnapshot>(await fetch(`/api/client-journey/staff?${actorQuery}`, {
    cache: "no-store",
    headers: sessionReadHeaders(session)
  }));
}

export async function sendStaffClientUpdate(session: TaskBoardSession, body: Record<string, unknown>) {
  return readJson<{ ok: true; planned: number }>(await fetch("/api/client-journey/staff", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ actor: session, ...body })
  }));
}
