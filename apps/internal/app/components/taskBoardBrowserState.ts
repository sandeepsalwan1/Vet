"use client";

import type { TaskBoardSession } from "./taskBoardTypes";

export const taskBoardSessionKey = "central-vet-session";
export const taskBoardSyncStorageKey = `${taskBoardSessionKey}:task-sync`;
export const taskBoardSyncChannelName = "central-vet-task-sync";
export const activeTaskSyncIntervalMs = 8000;
export const activeTaskSyncWindowMs = 12 * 60 * 1000;

type TaskSyncPayload = {
  type: "tasks_changed" | "settings_changed";
  source: string;
  at: number;
};

const taskBoardRoles = new Set(["staff", "va", "task_adder", "veterinarian", "admin"]);

function isTaskBoardRole(role: unknown) {
  return typeof role === "string" && taskBoardRoles.has(role);
}

export function parseSavedTaskBoardSession(saved: string | null) {
  if (!saved) return null;
  try {
    const parsed = JSON.parse(saved) as TaskBoardSession;
    if (!isTaskBoardRole(parsed.role)) return null;
    if (parsed.role !== "staff" && !parsed.passcode) return null;
    return parsed;
  } catch {
    window.localStorage.removeItem(taskBoardSessionKey);
    return null;
  }
}

export function readStoredTaskBoardSession() {
  if (typeof window === "undefined") return null;
  return parseSavedTaskBoardSession(window.localStorage.getItem(taskBoardSessionKey));
}

export function writeStoredTaskBoardSession(session: TaskBoardSession) {
  window.localStorage.setItem(taskBoardSessionKey, JSON.stringify(session));
}

export function clearStoredTaskBoardSession() {
  window.localStorage.removeItem(taskBoardSessionKey);
}

export function clearStoredTaskCaches() {
  if (typeof window === "undefined") return;
  const prefix = `${taskBoardSessionKey}:tasks:`;
  for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
    const key = window.localStorage.key(index);
    if (key?.startsWith(prefix)) {
      window.localStorage.removeItem(key);
    }
  }
}

export function createTaskBoardTabId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function parseTaskSyncPayload(value: unknown) {
  if (!value) return null;
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    if (parsed?.type !== "tasks_changed" && parsed?.type !== "settings_changed") return null;
    return parsed as TaskSyncPayload;
  } catch {
    return null;
  }
}
