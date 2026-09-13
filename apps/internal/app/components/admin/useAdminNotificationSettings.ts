"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState
} from "react";
import { toast } from "sonner";
import type { AccountSession } from "../../lib/accountStore";
import {
  readStaffClientJourney,
  saveClientJourneySettings
} from "../staffJourneyClient";
import { taskBoardActorQuery } from "../taskBoardClient";
import type { TaskBoardSession } from "../taskBoardTypes";
import {
  editableNotificationSettings,
  notificationSettingsChanged,
  type EditableNotificationSettings
} from "./adminNotificationSettings";
import { useSaveCelebration } from "./SaveCelebration";

export type AdminNotificationSession = AccountSession & { role: "admin" };

type NotificationSnapshot = Awaited<ReturnType<typeof readStaffClientJourney>>;

type LoadedNotificationSettings = {
  sessionKey: string;
  snapshot: NotificationSnapshot;
  draft: EditableNotificationSettings;
};

function taskBoardSession(
  name: string,
  passcode: string | undefined
): TaskBoardSession {
  return {
    name,
    role: "admin",
    passcode
  };
}

async function readNotificationSnapshot(
  name: string,
  passcode: string | undefined
) {
  const actor = taskBoardSession(name, passcode);
  return readStaffClientJourney(actor, taskBoardActorQuery(actor));
}

export function useAdminNotificationSettings(
  session: AdminNotificationSession
) {
  const [loaded, setLoaded] = useState<LoadedNotificationSettings | null>(null);
  const [loadError, setLoadError] = useState<{
    sessionKey: string;
    message: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const loadSequence = useRef(0);
  const celebration = useSaveCelebration();
  const { name, passcode } = session;
  const sessionKey = `${name}\u0000${passcode ?? ""}`;
  const snapshot = loaded?.sessionKey === sessionKey ? loaded.snapshot : null;
  const draft = loaded?.sessionKey === sessionKey ? loaded.draft : null;
  const error = loadError?.sessionKey === sessionKey ? loadError.message : "";

  const acceptSnapshot = useCallback((
    requestId: number,
    requestedSessionKey: string,
    nextSnapshot: NotificationSnapshot
  ) => {
    if (requestId !== loadSequence.current) return;
    // Commit saved settings and their editable projection together.
    setLoaded({
      sessionKey: requestedSessionKey,
      snapshot: nextSnapshot,
      draft: editableNotificationSettings(nextSnapshot.settings)
    });
    setLoadError(null);
  }, []);

  const acceptError = useCallback((
    requestId: number,
    requestedSessionKey: string,
    errorValue: unknown
  ) => {
    if (requestId !== loadSequence.current) return;
    setLoadError({
      sessionKey: requestedSessionKey,
      message: errorValue instanceof Error
        ? errorValue.message
        : "Notifications are unavailable."
    });
  }, []);

  const load = useCallback(async () => {
    const requestId = loadSequence.current + 1;
    loadSequence.current = requestId;
    try {
      acceptSnapshot(
        requestId,
        sessionKey,
        await readNotificationSnapshot(name, passcode)
      );
    } catch (errorValue) {
      acceptError(requestId, sessionKey, errorValue);
    }
  }, [acceptError, acceptSnapshot, name, passcode, sessionKey]);

  useEffect(() => {
    const requestId = loadSequence.current + 1;
    loadSequence.current = requestId;
    void readNotificationSnapshot(name, passcode).then(
      (nextSnapshot) => acceptSnapshot(requestId, sessionKey, nextSnapshot),
      (errorValue: unknown) => acceptError(requestId, sessionKey, errorValue)
    );
    return () => {
      // Ignore a request that completes after the session changes or unmounts.
      loadSequence.current += 1;
    };
  }, [acceptError, acceptSnapshot, name, passcode, sessionKey]);

  const hasChanges = Boolean(
    snapshot && draft && notificationSettingsChanged(snapshot.settings, draft)
  );

  function updateDraft(patch: Partial<EditableNotificationSettings>) {
    setLoaded((current) => current?.sessionKey === sessionKey
      ? { ...current, draft: { ...current.draft, ...patch } }
      : current);
  }

  async function save() {
    if (!draft || !hasChanges) return;
    setSaving(true);
    try {
      const result = await saveClientJourneySettings(
        taskBoardSession(name, passcode),
        draft
      );
      setLoaded((current) => current?.sessionKey === sessionKey
        ? {
            ...current,
            snapshot: { ...current.snapshot, settings: result.settings },
            draft: editableNotificationSettings(result.settings)
          }
        : current);
      toast.success("Notification settings saved.");
      celebration.celebrate();
    } catch (saveError) {
      toast.error(
        saveError instanceof Error
          ? saveError.message
          : "Could not save notification settings."
      );
    } finally {
      setSaving(false);
    }
  }

  return {
    snapshot,
    draft,
    updateDraft,
    error,
    saving,
    hasChanges,
    load,
    save,
    celebration
  };
}
