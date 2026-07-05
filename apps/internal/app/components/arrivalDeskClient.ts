import type {
  ArrivalDeskSnapshot,
  ArrivalQuestionnaire,
  RoomState
} from "@central-vet/db";
import { readJson } from "../lib/apiClient";
import { sessionReadHeaders } from "./taskBoardClient";
import type { TaskBoardSession } from "./taskBoardTypes";

export async function readArrivalDeskSnapshot(currentSession: TaskBoardSession, actorQuery: string): Promise<ArrivalDeskSnapshot> {
  return readJson<ArrivalDeskSnapshot>(
    await fetch(`/api/arrival-intake?${actorQuery}`, {
      cache: "no-store",
      headers: sessionReadHeaders(currentSession)
    })
  );
}

export async function updateArrivalRoomState(
  currentSession: TaskBoardSession,
  roomId: string,
  state: RoomState
) {
  return readJson(
    await fetch("/api/arrival-intake", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "room",
        actor: currentSession,
        roomId,
        state
      })
    })
  );
}

export async function checkoutArrivalRoomState(
  currentSession: TaskBoardSession,
  arrivalId: string
) {
  return readJson(
    await fetch("/api/arrival-intake", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "checkout",
        actor: currentSession,
        arrivalId
      })
    })
  );
}

export async function saveArrivalDeskSettings(
  currentSession: TaskBoardSession,
  roomAssignmentEnabled: boolean,
  questionnaire: ArrivalQuestionnaire
) {
  return readJson(
    await fetch("/api/arrival-intake", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "settings",
        actor: currentSession,
        roomAssignmentEnabled,
        questionnaire
      })
    })
  );
}
