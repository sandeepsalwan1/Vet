"use client";

import { Undo2, XCircle } from "lucide-react";
import type { TaskBoardToast } from "./taskBoardTypes";

export function InvalidTaskModal({
  reason,
  onReasonChange,
  onCancel,
  onConfirm
}: {
  reason: string;
  onReasonChange: (reason: string) => void;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  return (
    <div className="modalBackdrop">
      <form
        className="modal"
        onSubmit={(event) => {
          event.preventDefault();
          onConfirm(reason);
        }}
      >
        <h2>Mark Invalid</h2>
        <label>
          Reason
          <textarea
            value={reason}
            onChange={(event) => onReasonChange(event.target.value)}
            placeholder="Not a real issue, already handled, missing info..."
            rows={4}
          />
        </label>
        <div className="modalActions">
          <button type="button" className="plainButton" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="dangerButton">
            <XCircle size={17} />
            Mark Invalid
          </button>
        </div>
      </form>
    </div>
  );
}

export function TaskBoardToastBanner({
  toast,
  onUndo,
  onDismiss
}: {
  toast: TaskBoardToast;
  onUndo: (taskId: string) => void;
  onDismiss: () => void;
}) {
  const taskId = toast.taskId;

  return (
    <div className="toast">
      <span>{toast.text}</span>
      {taskId ? (
        <button type="button" onClick={() => onUndo(taskId)}>
          <Undo2 size={16} />
          Undo
        </button>
      ) : null}
      <button type="button" onClick={onDismiss}>×</button>
    </div>
  );
}
