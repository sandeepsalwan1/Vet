"use client";

import { Pencil, Plus } from "lucide-react";
import type { AppRole, Task, TaskPriority, TaskRequestType, TaskStatus } from "@central-vet/db";
import type { FormEvent, InputHTMLAttributes } from "react";
import { formatPhoneInput } from "../lib/phoneText";
import { requestTypes } from "./taskBoardDisplay";

export type TaskFormState = {
  status: TaskStatus;
  requestType: TaskRequestType;
  clientName: string;
  clarityId: string;
  clientPhone: string;
  clientDateOfBirth: string;
  petName: string;
  petWeight: string;
  lastVisit: string;
  request: string;
  notes: string;
  assignedTo: string;
  priority: TaskPriority;
  dueDate: string;
  dueTime: string;
};

type TaskFormProps = {
  form: TaskFormState;
  setForm: (next: TaskFormState) => void;
  editing: Task | null;
  role: AppRole;
  saving: boolean;
  onClose: () => void;
  onSubmit: (event: FormEvent) => void;
};

function requiredLabel(text: string) {
  return (
    <span className="labelText">
      {text} <span className="requiredStar">*</span>
    </span>
  );
}

function TaskTextField({
  label,
  value,
  onChange,
  required = false,
  inputMode,
  type
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  inputMode?: InputHTMLAttributes<HTMLInputElement>["inputMode"];
  type?: InputHTMLAttributes<HTMLInputElement>["type"];
}) {
  return (
    <label>
      {required ? requiredLabel(label) : label}
      <input
        type={type}
        required={required}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        inputMode={inputMode}
      />
    </label>
  );
}

export function TaskForm({
  form,
  setForm,
  editing,
  role,
  saving,
  onClose,
  onSubmit
}: TaskFormProps) {
  const update = (key: keyof TaskFormState, value: string) =>
    setForm({ ...form, [key]: value });

  return (
    <div className="modalBackdrop">
      <form className="modal wideModal" onSubmit={onSubmit}>
        <h2>{editing ? "Edit Task" : role === "staff" ? "Add Task" : "New Task"}</h2>
        <fieldset className="requestTypePicker">
          <legend>{requiredLabel("Request Type")}</legend>
          {requestTypes.map((item) => (
            <button
              key={item.value}
              type="button"
              className={form.requestType === item.value ? "selected" : ""}
              onClick={() => update("requestType", item.value)}
            >
              {item.label}
            </button>
          ))}
        </fieldset>
        <div className="formGrid">
          <TaskTextField label="Client Name" required value={form.clientName} onChange={(value) => update("clientName", value)} />
          <TaskTextField label="Phone" required value={form.clientPhone} onChange={(value) => update("clientPhone", formatPhoneInput(value))} inputMode="tel" />
          <TaskTextField label="Pet's name" required value={form.petName} onChange={(value) => update("petName", value)} />
          <label>
            {requiredLabel("Priority")}
            <select required value={form.priority} onChange={(event) => update("priority", event.target.value)}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </label>
        </div>
        <label>
          {requiredLabel("Request")}
          <textarea
            value={form.request}
            onChange={(event) => update("request", event.target.value)}
            rows={5}
            required
            minLength={10}
          />
        </label>
        <div className="formGrid optionalGrid">
          <TaskTextField label="Due date" type="date" value={form.dueDate} onChange={(value) => update("dueDate", value)} />
          <TaskTextField label="Due time" type="time" value={form.dueTime} onChange={(value) => update("dueTime", value)} />
          <TaskTextField label="Pet's date of birth" type="date" value={form.clientDateOfBirth} onChange={(value) => update("clientDateOfBirth", value)} />
          <TaskTextField label="Client ID" value={form.clarityId} onChange={(value) => update("clarityId", value)} />
          <TaskTextField label="Pet's weight" value={form.petWeight} onChange={(value) => update("petWeight", value)} />
          <TaskTextField label="Assigned to" value={form.assignedTo} onChange={(value) => update("assignedTo", value)} />
          {role !== "staff" ? (
            <label>
              Status
              <select value={form.status} onChange={(event) => update("status", event.target.value)}>
                <option value="due">Due</option>
                <option value="pending">Pending</option>
                <option value="pending_review">Pending Review</option>
              </select>
            </label>
          ) : null}
        </div>
        <div className="modalActions">
          <button type="button" className="plainButton" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" className="primaryButton" disabled={saving}>
            {editing ? <Pencil size={17} /> : <Plus size={17} />}
            {saving ? "Saving" : editing ? "Save" : role === "staff" ? "Add Task" : "Create"}
          </button>
        </div>
        <p className="requiredNote"><span className="requiredStar">*</span> Required</p>
      </form>
    </div>
  );
}
