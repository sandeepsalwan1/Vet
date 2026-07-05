"use client";

import { useCallback, useState, type Dispatch, type SetStateAction } from "react";
import type { RecipientProfile } from "@central-vet/db";
import { isAuthError } from "../lib/apiClient";
import { canUseNotificationSettings } from "../lib/taskWorkflow";
import { doctorName } from "../lib/veterinarianProfile";
import { writeStoredTaskBoardSession } from "./taskBoardBrowserState";
import {
  deactivateTaskBoardRecipientProfile,
  readTaskBoardSettings,
  saveTaskBoardRecipientProfile,
  setTaskBoardEndOfDayAlerts
} from "./taskBoardSettingsClient";
import type { TaskBoardSession as Session, TaskBoardToast } from "./taskBoardTypes";

type TaskBoardSyncType = "tasks_changed" | "settings_changed";

type UseTaskBoardSettingsOptions = {
  session: Session | null;
  actorQuery: string;
  clearSession: () => void;
  setSession: Dispatch<SetStateAction<Session | null>>;
  setError: (message: string) => void;
  setToast: (toast: TaskBoardToast) => void;
  publishSync: (type?: TaskBoardSyncType) => void;
};

export function useTaskBoardSettings({
  session,
  actorQuery,
  clearSession,
  setSession,
  setError,
  setToast,
  publishSync
}: UseTaskBoardSettingsOptions) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [endOfDayAlertsEnabled, setEndOfDayAlertsEnabled] = useState(true);
  const [recipientProfiles, setRecipientProfiles] = useState<RecipientProfile[]>([]);
  const [canEditAllProfiles, setCanEditAllProfiles] = useState(false);
  const [currentProfileId, setCurrentProfileId] = useState<string | null>(null);
  const [addingProfile, setAddingProfile] = useState(false);

  const applySettings = useCallback((data: {
    endOfDayAlertsEnabled: boolean;
    recipientProfiles: RecipientProfile[];
    canEditAllProfiles: boolean;
    currentProfileId: string | null;
  }) => {
    setEndOfDayAlertsEnabled(data.endOfDayAlertsEnabled);
    setRecipientProfiles(data.recipientProfiles);
    setCanEditAllProfiles(data.canEditAllProfiles);
    setCurrentProfileId(data.currentProfileId);
  }, []);

  const resetSettings = useCallback(() => {
    setEndOfDayAlertsEnabled(false);
    setRecipientProfiles([]);
    setCanEditAllProfiles(false);
    setCurrentProfileId(null);
  }, []);

  const loadSettings = useCallback(async () => {
    if (!session || !canUseNotificationSettings(session.role)) return;
    try {
      applySettings(await readTaskBoardSettings(session, actorQuery));
    } catch (settingsError) {
      if (isAuthError(settingsError)) {
        clearSession();
        setError(settingsError instanceof Error ? settingsError.message : "Invalid passcode.");
        return;
      }
      resetSettings();
    }
  }, [actorQuery, applySettings, clearSession, resetSettings, session, setError]);

  const toggleEndOfDayAlerts = useCallback(async () => {
    if (!session || session.role !== "admin") return;
    const next = !endOfDayAlertsEnabled;
    setEndOfDayAlertsEnabled(next);
    setSettingsSaving(true);
    try {
      const data = await setTaskBoardEndOfDayAlerts(session, next);
      applySettings(data);
      setToast({ text: next ? "End-of-day alert on." : "End-of-day alert off." });
      publishSync("settings_changed");
    } catch (settingsError) {
      setEndOfDayAlertsEnabled(!next);
      setError(settingsError instanceof Error ? settingsError.message : "Settings failed.");
    } finally {
      setSettingsSaving(false);
    }
  }, [applySettings, endOfDayAlertsEnabled, publishSync, session, setError, setToast]);

  const saveRecipientProfile = useCallback(async (profile: RecipientProfile) => {
    if (!session || !canUseNotificationSettings(session.role)) return;
    const normalizedProfile = {
      ...profile,
      displayName: doctorName(profile.displayName)
    };
    setSettingsSaving(true);
    try {
      const data = await saveTaskBoardRecipientProfile(session, normalizedProfile);
      applySettings(data);
      if (session.role === "veterinarian" && currentProfileId === normalizedProfile.profileId) {
        const nextSession = { ...session, name: normalizedProfile.displayName };
        setSession(nextSession);
        writeStoredTaskBoardSession(nextSession);
      }
      setAddingProfile(false);
      setToast({ text: "Notification settings saved." });
      publishSync("settings_changed");
    } catch (settingsError) {
      setError(settingsError instanceof Error ? settingsError.message : "Settings failed.");
    } finally {
      setSettingsSaving(false);
    }
  }, [applySettings, currentProfileId, publishSync, session, setError, setSession, setToast]);

  const deactivateRecipientProfile = useCallback(async (profile: RecipientProfile) => {
    if (!session || !canEditAllProfiles) return;
    const typed = window.prompt(`Type ${profile.displayName} to deactivate this veterinarian profile.`);
    if (typed !== profile.displayName) return;
    setSettingsSaving(true);
    try {
      const data = await deactivateTaskBoardRecipientProfile(session, profile.profileId);
      applySettings(data);
      setToast({ text: "Veterinarian profile deactivated." });
      publishSync("settings_changed");
    } catch (settingsError) {
      setError(settingsError instanceof Error ? settingsError.message : "Settings failed.");
    } finally {
      setSettingsSaving(false);
    }
  }, [applySettings, canEditAllProfiles, publishSync, session, setError, setToast]);

  return {
    settingsOpen,
    settingsSaving,
    endOfDayAlertsEnabled,
    recipientProfiles,
    canEditAllProfiles,
    currentProfileId,
    addingProfile,
    loadSettings,
    toggleSettingsOpen: () => setSettingsOpen((open) => !open),
    toggleEndOfDayAlerts,
    saveRecipientProfile,
    deactivateRecipientProfile,
    startAddingProfile: () => setAddingProfile(true),
    setRecipientProfiles,
    setCurrentProfileId
  };
}
