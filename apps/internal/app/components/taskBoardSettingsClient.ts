import type { RecipientProfile } from "@central-vet/db";
import { readJson } from "../lib/apiClient";
import { sessionReadHeaders } from "./taskBoardClient";
import type { TaskBoardSession } from "./taskBoardTypes";

type TaskBoardSettingsPayload = {
  endOfDayAlertsEnabled: boolean;
  recipientProfiles: RecipientProfile[];
  canEditAllProfiles: boolean;
  currentProfileId: string | null;
};

type TaskBoardSettingsResponse = Partial<TaskBoardSettingsPayload>;

type ProfileNameResponse = {
  actor?: {
    name?: string;
    profileId?: string | null;
  };
  previousName?: string | null;
  recipientProfiles?: RecipientProfile[];
  currentProfileId?: string | null;
};

function taskBoardSettingsPayload(data: TaskBoardSettingsResponse): TaskBoardSettingsPayload {
  return {
    endOfDayAlertsEnabled: Boolean(data.endOfDayAlertsEnabled),
    recipientProfiles: data.recipientProfiles ?? [],
    canEditAllProfiles: Boolean(data.canEditAllProfiles),
    currentProfileId: data.currentProfileId ?? null
  };
}

export async function readTaskBoardSettings(
  currentSession: TaskBoardSession,
  actorQuery: string
): Promise<TaskBoardSettingsPayload> {
  const data = await readJson<TaskBoardSettingsResponse>(
    await fetch(`/api/settings?${actorQuery}`, {
      cache: "no-store",
      headers: sessionReadHeaders(currentSession)
    })
  );
  return taskBoardSettingsPayload(data);
}

export async function updateTaskBoardProfileName(currentSession: TaskBoardSession, name: string) {
  return readJson<ProfileNameResponse>(
    await fetch("/api/profile-name", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        actor: currentSession,
        name
      })
    })
  );
}

export async function setTaskBoardEndOfDayAlerts(
  currentSession: TaskBoardSession,
  endOfDayAlertsEnabled: boolean
): Promise<TaskBoardSettingsPayload> {
  const data = await readJson<TaskBoardSettingsResponse>(
    await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        actor: currentSession,
        endOfDayAlertsEnabled
      })
    })
  );
  return taskBoardSettingsPayload(data);
}

export async function saveTaskBoardRecipientProfile(
  currentSession: TaskBoardSession,
  recipientProfile: RecipientProfile
): Promise<TaskBoardSettingsPayload> {
  const data = await readJson<TaskBoardSettingsResponse>(
    await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        actor: currentSession,
        recipientProfile
      })
    })
  );
  return taskBoardSettingsPayload(data);
}

export async function deactivateTaskBoardRecipientProfile(
  currentSession: TaskBoardSession,
  deactivateProfileId: string
): Promise<TaskBoardSettingsPayload> {
  const data = await readJson<TaskBoardSettingsResponse>(
    await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        actor: currentSession,
        deactivateProfileId
      })
    })
  );
  return taskBoardSettingsPayload(data);
}
