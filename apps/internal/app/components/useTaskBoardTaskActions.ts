"use client";

import { useCallback, type Dispatch, type SetStateAction } from "react";
import type { Task, TaskStatus } from "@central-vet/db";
import { canManage } from "../lib/taskWorkflow";
import {
  escalateTaskBoardTask,
  setTaskBoardArchiveState,
  undoTaskBoardStatus,
  updateTaskBoardStatus
} from "./taskBoardClient";
import type { TaskBoardSession, TaskBoardToast } from "./taskBoardTypes";

type UseTaskBoardTaskActionsArgs = {
  session: TaskBoardSession | null;
  load(options?: { silent?: boolean }): Promise<void>;
  publishSync(): void;
  setError: Dispatch<SetStateAction<string>>;
  setToast: Dispatch<SetStateAction<TaskBoardToast | null>>;
  setConfetti: Dispatch<SetStateAction<boolean>>;
  clearInvalidTask(): void;
};

export function useTaskBoardTaskActions({
  session,
  load,
  publishSync,
  setError,
  setToast,
  setConfetti,
  clearInvalidTask
}: UseTaskBoardTaskActionsArgs) {
  const refreshAfterMutation = useCallback(async () => {
    publishSync();
    await load({ silent: true });
  }, [load, publishSync]);

  const updateStatus = useCallback(async (
    task: Task,
    nextStatus: TaskStatus,
    invalidReasonText?: string
  ) => {
    if (!session) return;
    try {
      await updateTaskBoardStatus({
        currentSession: session,
        taskId: task.id,
        nextStatus,
        invalidReason: invalidReasonText
      });
      setToast({
        text:
          nextStatus === "completed"
            ? "Completed."
            : nextStatus === "invalid"
              ? "Marked invalid."
              : "Moved.",
        taskId: canManage(session.role) ? task.id : undefined
      });
      if (nextStatus === "completed") {
        setConfetti(true);
        window.setTimeout(() => setConfetti(false), 900);
      }
      clearInvalidTask();
      await refreshAfterMutation();
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : "Update failed.");
    }
  }, [clearInvalidTask, refreshAfterMutation, session, setConfetti, setError, setToast]);

  const archiveAction = useCallback(async (task: Task, action: "archive" | "restore") => {
    if (!session) return;
    try {
      await setTaskBoardArchiveState({
        currentSession: session,
        taskId: task.id,
        action
      });
      setToast({ text: action === "archive" ? "Archived." : "Restored.", taskId: task.id });
      await refreshAfterMutation();
    } catch (archiveError) {
      setError(archiveError instanceof Error ? archiveError.message : "Archive failed.");
    }
  }, [refreshAfterMutation, session, setError, setToast]);

  const escalate = useCallback(async (task: Task) => {
    if (!session) return;
    try {
      await escalateTaskBoardTask(session, task.id);
      setToast({ text: "Escalated for veterinarians.", taskId: canManage(session.role) ? task.id : undefined });
      await refreshAfterMutation();
    } catch (escalateError) {
      setError(escalateError instanceof Error ? escalateError.message : "Escalation failed.");
    }
  }, [refreshAfterMutation, session, setError, setToast]);

  const undo = useCallback(async (taskId: string) => {
    if (!session) return;
    try {
      await undoTaskBoardStatus(session, taskId);
      setToast({ text: "Undone." });
      await refreshAfterMutation();
    } catch (undoError) {
      setError(undoError instanceof Error ? undoError.message : "Undo failed.");
    }
  }, [refreshAfterMutation, session, setError, setToast]);

  return {
    updateStatus,
    archiveAction,
    escalate,
    undo
  };
}
