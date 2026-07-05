"use client";

import type { Task, TaskEvent } from "@central-vet/db";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  activeTaskSyncIntervalMs,
  activeTaskSyncWindowMs,
  clearStoredTaskBoardSession,
  clearStoredTaskCaches,
  createTaskBoardTabId,
  parseSavedTaskBoardSession,
  parseTaskSyncPayload,
  readStoredTaskBoardSession,
  taskBoardSessionKey,
  taskBoardSyncChannelName,
  taskBoardSyncStorageKey,
  writeStoredTaskBoardSession
} from "./taskBoardBrowserState";
import {
  taskBoardActorQuery,
  readTaskBoardSnapshot
} from "./taskBoardClient";
import { isAuthError } from "../lib/apiClient";
import type { TaskBoardSession as Session } from "./taskBoardTypes";

type LoadOptions = {
  silent?: boolean;
};

export function useTaskBoardDataSync() {
  const [booted, setBooted] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [events, setEvents] = useState<TaskEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [syncPaused, setSyncPaused] = useState(false);
  const [error, setError] = useState("");
  const [settingsRefreshToken, setSettingsRefreshToken] = useState(0);
  const tabIdRef = useRef(createTaskBoardTabId());
  const lastActivityRef = useRef(0);
  const actorQueryRef = useRef("");
  const loadInFlightRef = useRef(false);
  const loadSequenceRef = useRef(0);

  const actorQuery = useMemo(() => {
    if (!session) return "";
    return taskBoardActorQuery(session);
  }, [session]);

  const recordActivity = useCallback(() => {
    lastActivityRef.current = Date.now();
  }, []);

  const markActive = useCallback(() => {
    recordActivity();
    setSyncPaused(false);
  }, [recordActivity]);

  const requestSettingsRefresh = useCallback(() => {
    setSettingsRefreshToken((token) => token + 1);
  }, []);

  const clearSession = useCallback(() => {
    clearStoredTaskBoardSession();
    setSession(null);
    setTasks([]);
    setEvents([]);
    setLoading(false);
    setSyncPaused(false);
    setHasLoaded(false);
  }, []);

  const load = useCallback(async (options: LoadOptions = {}) => {
    if (!session || !actorQuery) return;
    if (loadInFlightRef.current) return;

    const requestActorQuery = actorQuery;
    const requestId = loadSequenceRef.current + 1;
    loadSequenceRef.current = requestId;
    loadInFlightRef.current = true;
    if (!options.silent) setLoading(true);
    setError("");
    try {
      const data = await readTaskBoardSnapshot(session, requestActorQuery);
      if (actorQueryRef.current !== requestActorQuery || loadSequenceRef.current !== requestId) return;
      setTasks(data.tasks);
      setEvents(data.events);
    } catch (loadError) {
      if (actorQueryRef.current === requestActorQuery) {
        if (isAuthError(loadError)) {
          clearSession();
          setError(loadError instanceof Error ? loadError.message : "Invalid passcode.");
          return;
        }
        setError(loadError instanceof Error ? loadError.message : "Load failed.");
      }
    } finally {
      const shouldFinish = actorQueryRef.current === requestActorQuery;
      if (shouldFinish) {
        setLoading(false);
        setHasLoaded(true);
      }
      loadInFlightRef.current = false;
    }
  }, [actorQuery, clearSession, session]);

  const publishSync = useCallback((type: "tasks_changed" | "settings_changed" = "tasks_changed") => {
    const payload = {
      type,
      source: tabIdRef.current,
      at: Date.now()
    };
    try {
      window.localStorage.setItem(taskBoardSyncStorageKey, JSON.stringify(payload));
    } catch {
      // Best-effort same-browser sync; polling still catches cross-browser changes.
    }
    try {
      const channel = new BroadcastChannel(taskBoardSyncChannelName);
      channel.postMessage(payload);
      channel.close();
    } catch {
      // Storage events cover browsers without BroadcastChannel.
    }
  }, []);

  const saveSession = useCallback((next: Session) => {
    markActive();
    setSession(next);
    setTasks([]);
    setEvents([]);
    setLoading(false);
    setHasLoaded(false);
    writeStoredTaskBoardSession(next);
  }, [markActive]);

  useEffect(() => {
    const id = window.setTimeout(() => {
      clearStoredTaskCaches();
      setSession(readStoredTaskBoardSession());
      setBooted(true);
    }, 0);
    return () => window.clearTimeout(id);
  }, []);

  useEffect(() => {
    actorQueryRef.current = actorQuery;
    loadInFlightRef.current = false;
  }, [actorQuery]);

  useEffect(() => {
    if (!session) return;
    recordActivity();
    const kickoff = window.setTimeout(() => {
      void load();
    }, 0);
    const id = window.setInterval(() => {
      if (document.hidden) return;
      if (Date.now() - lastActivityRef.current > activeTaskSyncWindowMs) {
        setSyncPaused(true);
        return;
      }
      setSyncPaused(false);
      void load({ silent: true });
    }, activeTaskSyncIntervalMs);
    return () => {
      window.clearTimeout(kickoff);
      window.clearInterval(id);
    };
  }, [load, recordActivity, session]);

  useEffect(() => {
    if (!session) return;
    const refresh = () => {
      markActive();
      void load({ silent: hasLoaded });
      requestSettingsRefresh();
    };
    const refreshWhenVisible = () => {
      if (!document.hidden) refresh();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    window.addEventListener("pointerdown", markActive, { passive: true });
    window.addEventListener("keydown", markActive);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.removeEventListener("pointerdown", markActive);
      window.removeEventListener("keydown", markActive);
    };
  }, [hasLoaded, load, markActive, requestSettingsRefresh, session]);

  useEffect(() => {
    if (!session) return;

    const refreshFromSync = (payload: ReturnType<typeof parseTaskSyncPayload>) => {
      if (!payload || payload.source === tabIdRef.current) return;
      markActive();
      if (document.hidden) return;
      void load({ silent: true });
      if (payload.type === "settings_changed") {
        requestSettingsRefresh();
      }
    };

    const onStorage = (event: StorageEvent) => {
      if (event.key !== taskBoardSyncStorageKey) return;
      refreshFromSync(parseTaskSyncPayload(event.newValue));
    };
    const onMessage = (event: MessageEvent) => {
      refreshFromSync(parseTaskSyncPayload(event.data));
    };
    const channel = "BroadcastChannel" in window
      ? new BroadcastChannel(taskBoardSyncChannelName)
      : null;

    window.addEventListener("storage", onStorage);
    channel?.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("storage", onStorage);
      channel?.removeEventListener("message", onMessage);
      channel?.close();
    };
  }, [load, markActive, requestSettingsRefresh, session]);

  useEffect(() => {
    function syncSession(event: StorageEvent) {
      if (event.key !== taskBoardSessionKey) return;
      const nextSession = parseSavedTaskBoardSession(event.newValue);
      setSession(nextSession);
      setTasks([]);
      setEvents([]);
      setHasLoaded(false);
    }
    window.addEventListener("storage", syncSession);
    return () => window.removeEventListener("storage", syncSession);
  }, []);

  return {
    booted,
    session,
    setSession,
    tasks,
    setTasks,
    events,
    setEvents,
    loading,
    hasLoaded,
    syncPaused,
    error,
    setError,
    settingsRefreshToken,
    actorQuery,
    load,
    publishSync,
    saveSession,
    clearSession,
    markActive
  };
}
