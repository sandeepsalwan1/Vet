"use client";

import { useState, type Dispatch, type SetStateAction } from "react";
import type { Task } from "@central-vet/db";
import { saveTaskBoardForm } from "./taskBoardClient";
import { blankTaskForm, taskFormFromTask } from "./taskBoardState";
import type { TaskFormState } from "./TaskForm";
import type { TaskBoardSession, TaskBoardToast } from "./taskBoardTypes";

type UseTaskBoardFormArgs = {
  session: TaskBoardSession | null;
  load(options?: { silent?: boolean }): Promise<void>;
  publishSync(): void;
  setError: Dispatch<SetStateAction<string>>;
  setToast: Dispatch<SetStateAction<TaskBoardToast | null>>;
};

export function useTaskBoardForm({
  session,
  load,
  publishSync,
  setError,
  setToast
}: UseTaskBoardFormArgs) {
  const [formOpen, setFormOpen] = useState(false);
  const [formSaving, setFormSaving] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);
  const [form, setForm] = useState<TaskFormState>(blankTaskForm);

  function openCreate() {
    setEditing(null);
    setForm(blankTaskForm());
    setFormOpen(true);
  }

  function openEdit(task: Task) {
    setEditing(task);
    setForm(taskFormFromTask(task));
    setFormOpen(true);
  }

  async function submitForm() {
    if (!session || formSaving) return;

    setFormSaving(true);
    try {
      await saveTaskBoardForm({
        currentSession: session,
        form,
        editingTaskId: editing?.id
      });
      setToast({
        text: editing
          ? "Task updated."
          : session.role === "staff"
            ? "Task added."
            : "Task created."
      });
      setFormOpen(false);
      publishSync();
      await load({ silent: true });
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Save failed.");
    } finally {
      setFormSaving(false);
    }
  }

  return {
    formOpen,
    formSaving,
    editing,
    form,
    setForm,
    openCreate,
    openEdit,
    closeForm: () => setFormOpen(false),
    submitForm
  };
}
