"use client";

import { useCallback, type Dispatch, type SetStateAction } from "react";
import type { RecipientProfile, Task, TaskEvent } from "@central-vet/db";
import { doctorName } from "../lib/veterinarianProfile";
import { writeStoredTaskBoardSession } from "./taskBoardBrowserState";
import { updateTaskBoardProfileName } from "./taskBoardSettingsClient";
import {
  renameEventActorNames,
  renameTaskActorNames
} from "./taskBoardState";
import type { TaskBoardSession, TaskBoardToast } from "./taskBoardTypes";

type TaskBoardSyncType = "tasks_changed" | "settings_changed";

type UseTaskBoardProfileNameArgs = {
  session: TaskBoardSession | null;
  recipientProfiles: RecipientProfile[];
  currentProfileId: string | null;
  markActive(): void;
  publishSync(type?: TaskBoardSyncType): void;
  setSession: Dispatch<SetStateAction<TaskBoardSession | null>>;
  setTasks: Dispatch<SetStateAction<Task[]>>;
  setEvents: Dispatch<SetStateAction<TaskEvent[]>>;
  setRecipientProfiles(profiles: RecipientProfile[]): void;
  setCurrentProfileId(profileId: string | null): void;
  setError: Dispatch<SetStateAction<string>>;
  setToast: Dispatch<SetStateAction<TaskBoardToast | null>>;
};

export function useTaskBoardProfileName({
  session,
  recipientProfiles,
  currentProfileId,
  markActive,
  publishSync,
  setSession,
  setTasks,
  setEvents,
  setRecipientProfiles,
  setCurrentProfileId,
  setError,
  setToast
}: UseTaskBoardProfileNameArgs) {
  const updateSessionName = useCallback(async (nextName: string) => {
    if (!session) return false;
    const cleanName = nextName.trim();
    if (!cleanName) return false;

    const name = session.role === "veterinarian" ? doctorName(cleanName) : cleanName;
    const previousSession = session;
    const nextSession = { ...session, name };
    markActive();
    setSession(nextSession);
    writeStoredTaskBoardSession(nextSession);
    try {
      const data = await updateTaskBoardProfileName(previousSession, name);
      const savedSession = {
        ...nextSession,
        name: data.actor?.name ?? name,
        profileId: data.actor?.profileId ?? nextSession.profileId
      };
      setSession(savedSession);
      writeStoredTaskBoardSession(savedSession);
      const oldName = data.previousName ?? previousSession.name;
      if (oldName && oldName !== savedSession.name) {
        setTasks((current) =>
          current.map((task) => renameTaskActorNames(task, previousSession.role, oldName, savedSession.name))
        );
        setEvents((current) =>
          current.map((event) => renameEventActorNames(event, previousSession.role, oldName, savedSession.name))
        );
      }
      if (previousSession.role === "veterinarian" && previousSession.profileId) {
        setRecipientProfiles(data.recipientProfiles ?? recipientProfiles);
        setCurrentProfileId(data.currentProfileId ?? currentProfileId);
      }
      publishSync("settings_changed");
    } catch (profileError) {
      setSession(previousSession);
      writeStoredTaskBoardSession(previousSession);
      setError(profileError instanceof Error ? profileError.message : "Profile name failed.");
      return false;
    }
    setToast({ text: session.role === "veterinarian" ? "Profile name updated." : "Name updated." });
    return true;
  }, [
    currentProfileId,
    markActive,
    publishSync,
    recipientProfiles,
    session,
    setCurrentProfileId,
    setError,
    setEvents,
    setRecipientProfiles,
    setSession,
    setTasks,
    setToast
  ]);

  return { updateSessionName };
}
