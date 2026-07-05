import type {
  Actor,
  CreateTaskInput,
  UpdateTaskInput
} from "./types";

export function cleanTaskText(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function dateOrNull(value: unknown) {
  const text = cleanTaskText(value);
  return text || null;
}

function priorityOrDefault(value: unknown) {
  return value === "low" || value === "medium" || value === "high"
    ? value
    : "medium";
}

function requestTypeOrDefault(value: unknown) {
  return value === "prescription" ||
    value === "labs_xrays" ||
    value === "records_request" ||
    value === "scheduling" ||
    value === "patient_update"
    ? value
    : "labs_xrays";
}

function timeOrDefault(value: unknown) {
  const text = cleanTaskText(value);
  if (!text) return "19:00";
  const match = text.match(/^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/);
  return match ? `${match[1]}:${match[2]}` : "19:00";
}

export function taskInsertRow(input: CreateTaskInput, actor: Actor, clinicId: string) {
  return {
    clinic_id: clinicId,
    hospital_name:
      input.hospitalName?.trim() ||
      process.env.HOSPITAL_NAME ||
      "Central Veterinary Hospital",
    status: input.status,
    source: input.source,
    client_name: cleanTaskText(input.clientName),
    clarity_id: cleanTaskText(input.clarityId),
    client_phone: cleanTaskText(input.clientPhone),
    client_date_of_birth: dateOrNull(input.clientDateOfBirth),
    pet_name: cleanTaskText(input.petName),
    pet_weight: cleanTaskText(input.petWeight),
    last_visit: dateOrNull(input.lastVisit),
    request: input.request.trim(),
    request_type: requestTypeOrDefault(input.requestType),
    notes: cleanTaskText(input.notes),
    assigned_to: cleanTaskText(input.assignedTo),
    assigned_by_role: cleanTaskText(input.assignedTo) ? actor.role : null,
    priority: priorityOrDefault(input.priority),
    due_date: input.dueDate || new Date().toISOString().slice(0, 10),
    due_time: timeOrDefault(input.dueTime),
    created_by_name: actor.name,
    created_by_role: actor.role,
    updated_by_name: actor.name
  };
}

export function taskPatchRow(input: UpdateTaskInput, actor: Actor) {
  const patch: Record<string, string | null> = {
    updated_by_name: actor.name
  };
  if ("clientName" in input) patch.client_name = cleanTaskText(input.clientName);
  if ("clarityId" in input) patch.clarity_id = cleanTaskText(input.clarityId);
  if ("clientPhone" in input) patch.client_phone = cleanTaskText(input.clientPhone);
  if ("clientDateOfBirth" in input) {
    patch.client_date_of_birth = dateOrNull(input.clientDateOfBirth);
  }
  if ("petName" in input) patch.pet_name = cleanTaskText(input.petName);
  if ("petWeight" in input) patch.pet_weight = cleanTaskText(input.petWeight);
  if ("lastVisit" in input) patch.last_visit = dateOrNull(input.lastVisit);
  if ("request" in input && input.request) patch.request = input.request.trim();
  if ("requestType" in input) patch.request_type = requestTypeOrDefault(input.requestType);
  if ("notes" in input) patch.notes = cleanTaskText(input.notes);
  if ("assignedTo" in input) {
    patch.assigned_to = cleanTaskText(input.assignedTo);
  }
  if ("priority" in input) patch.priority = priorityOrDefault(input.priority);
  if ("dueDate" in input && input.dueDate) patch.due_date = input.dueDate;
  if ("dueTime" in input) patch.due_time = timeOrDefault(input.dueTime);
  return patch;
}
