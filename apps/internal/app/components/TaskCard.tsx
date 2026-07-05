"use client";

import {
  AlertTriangle,
  Archive,
  BellRing,
  CheckCircle2,
  Clock3,
  Pencil,
  RotateCcw,
  XCircle
} from "lucide-react";
import type { AppRole, Task, TaskStatus } from "@central-vet/db";
import { canEditTask, canManage, canMarkInvalid } from "../lib/taskWorkflow";
import {
  actorDisplay,
  formatDate,
  formatDateTime,
  formatDue,
  formatPhone,
  isOverdue,
  priorityLabel,
  requestTypeLabel,
  sourceDisplay,
  statusLabel
} from "./taskBoardDisplay";

type TaskCardProps = {
  task: Task;
  role: AppRole;
  onEdit: (task: Task) => void;
  onStatus: (task: Task, status: TaskStatus) => void;
  onInvalid: (task: Task) => void;
  onArchive: (task: Task, action: "archive" | "restore") => void;
  onEscalate: (task: Task) => void;
  onUndo: (taskId: string) => void;
};

export function TaskCard({
  task,
  role,
  onEdit,
  onStatus,
  onInvalid,
  onArchive,
  onEscalate,
  onUndo
}: TaskCardProps) {
  const overdue = isOverdue(task);
  const manageable = canManage(role);
  const editable = canEditTask(role, task);
  const archiveAccess = canManage(role);
  const archived = task.status === "archived";
  const pendingReview = task.status === "pending_review";
  const finished = task.status === "completed" || task.status === "invalid";
  const invalidArchived = archived && Boolean(task.invalidReason);
  const showAssignment = Boolean(task.assignedTo) && !finished && !archived;
  const invalidAllowed = canMarkInvalid(role, task);

  return (
    <article className={`taskCard status-${task.status} ${overdue ? "isOverdue" : ""} ${task.escalatedAt ? "isEscalated" : ""}`}>
      <div className="cardTop">
        <span className={`sourceBadge source-${task.source}`}>{sourceDisplay(task, role)}</span>
        <span className={`statusBadge badge-${invalidArchived ? "invalid" : task.status}`}>
          {overdue ? "Overdue" : invalidArchived ? "Invalid" : statusLabel(task.status)}
        </span>
      </div>
      {task.escalatedAt ? (
        <div className="escalatedBanner">
          <BellRing size={15} />
          Escalated by {actorDisplay(task.escalatedByName, task.escalatedByRole, role)} {formatDateTime(task.escalatedAt)}
        </div>
      ) : null}
      {(task.priority === "medium" || task.priority === "high") && !finished && !archived ? (
        <div className="priorityBanner">
          <AlertTriangle size={15} />
          {priorityLabel(task.priority)} priority
        </div>
      ) : null}
      <h3 className={task.status === "completed" ? "doneTitle" : ""}>
        {task.petName || "No pet listed"}
      </h3>
      <p className={task.status === "invalid" || invalidArchived ? "invalidText" : ""}>
        {task.request}
      </p>
      <dl className="taskMeta">
        <div>
          <dt>Request Type</dt>
          <dd>{requestTypeLabel(task.requestType)}</dd>
        </div>
        <div>
          <dt>Client Name</dt>
          <dd>{task.clientName || "Not listed"}</dd>
        </div>
        {task.clarityId ? (
          <div>
            <dt>Client ID</dt>
            <dd>{task.clarityId}</dd>
          </div>
        ) : null}
        <div>
          <dt>Priority</dt>
          <dd>{priorityLabel(task.priority)}</dd>
        </div>
        <div>
          <dt>Phone</dt>
          <dd>{formatPhone(task.clientPhone)}</dd>
        </div>
        {task.clientDateOfBirth ? (
          <div>
            <dt>Pet DOB</dt>
            <dd>{formatDate(task.clientDateOfBirth)}</dd>
          </div>
        ) : null}
        <div>
          <dt>Due</dt>
          <dd>{formatDue(task)}</dd>
        </div>
        <div>
          <dt>Created by</dt>
          <dd>{actorDisplay(task.createdByName, task.createdByRole, role)}</dd>
        </div>
        <div>
          <dt>Created at</dt>
          <dd>{formatDateTime(task.createdAt)}</dd>
        </div>
        {showAssignment ? (
          <div>
            <dt>{task.status === "pending" ? "Pending by" : "Assigned"}</dt>
            <dd>{task.assignedTo}</dd>
          </div>
        ) : null}
        {task.completedByName ? (
          <div>
            <dt>Completed by</dt>
            <dd>{actorDisplay(task.completedByName, task.completedByRole, role)}</dd>
          </div>
        ) : null}
        {task.completedAt ? (
          <div>
            <dt>Completed at</dt>
            <dd>{formatDateTime(task.completedAt)}</dd>
          </div>
        ) : null}
        {task.archivedByName ? (
          <div>
            <dt>Archived by</dt>
            <dd>{actorDisplay(task.archivedByName, task.archivedByRole, role)}</dd>
          </div>
        ) : null}
        {task.escalatedByName ? (
          <div>
            <dt>Escalated by</dt>
            <dd>{actorDisplay(task.escalatedByName, task.escalatedByRole, role)}</dd>
          </div>
        ) : null}
      </dl>
      {task.invalidReason ? <div className="invalidReason">{task.invalidReason}</div> : null}
      <div className="cardActions">
        {pendingReview && manageable ? (
          <>
            <button onClick={() => onStatus(task, "due")} className="plainButton compact">
              <Clock3 size={16} />
              Move to Due
            </button>
            <button onClick={() => onInvalid(task)} className="plainButton compact">
              <XCircle size={16} />
              Invalid
            </button>
          </>
        ) : null}
        {!archived && !pendingReview && !finished ? (
          <button onClick={() => onStatus(task, "completed")} className="completeButton">
            <CheckCircle2 size={16} />
            Complete
          </button>
        ) : null}
        {!archived && !pendingReview && invalidAllowed && task.status !== "invalid" && task.status !== "completed" ? (
          <button onClick={() => onInvalid(task)} className="plainButton compact">
            <XCircle size={16} />
            Invalid
          </button>
        ) : null}
        {role === "staff" && !archived && !pendingReview && task.status !== "invalid" ? (
          <>
            {task.status !== "due" ? (
              <button onClick={() => onStatus(task, "due")} className="plainButton compact">
                Due
              </button>
            ) : null}
            {task.status !== "pending" ? (
              <button onClick={() => onStatus(task, "pending")} className="plainButton compact">
                Pending
              </button>
            ) : null}
          </>
        ) : null}
        {manageable && !archived && !pendingReview ? (
          <>
            {task.status !== "due" ? (
              <button onClick={() => onStatus(task, "due")} className="plainButton compact">
                Due
              </button>
            ) : null}
            {task.status !== "pending" && task.status !== "invalid" ? (
              <button onClick={() => onStatus(task, "pending")} className="plainButton compact">
                Pending
              </button>
            ) : null}
            {task.status !== "invalid" ? (
              <button onClick={() => onEdit(task)} className="plainButton compact">
                <Pencil size={16} />
                Edit
              </button>
            ) : null}
            <button onClick={() => onUndo(task.id)} className="plainButton compact">
              <RotateCcw size={16} />
              Undo
            </button>
          </>
        ) : null}
        {archiveAccess ? (
          archived ? (
            <button onClick={() => onArchive(task, "restore")} className="plainButton compact">
              <RotateCcw size={16} />
              {invalidArchived ? "Restore to Due" : "Restore"}
            </button>
          ) : !pendingReview ? (
            <button onClick={() => onArchive(task, "archive")} className="plainButton compact">
              <Archive size={16} />
              Archive
            </button>
          ) : null
        ) : null}
        {!manageable && editable && !archived && !pendingReview && task.status !== "invalid" ? (
          <button onClick={() => onEdit(task)} className="plainButton compact">
            <Pencil size={16} />
            Edit
          </button>
        ) : null}
        {!archived && !finished && !task.escalatedAt ? (
          <button onClick={() => onEscalate(task)} className="escalateButton">
            <BellRing size={16} />
            Escalate
          </button>
        ) : null}
      </div>
    </article>
  );
}
