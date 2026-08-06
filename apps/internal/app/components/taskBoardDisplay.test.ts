import assert from "node:assert/strict";
import test from "node:test";
import type { Task } from "@central-vet/db";
import { filterTaskBoardTasks, normalizeTaskSearch, taskLaneItems, taskSearchText } from "./taskBoardDisplay";

const baseTask = (overrides: Partial<Task> = {}): Task => ({
  id: "task-1",
  clinicId: "clinic-1",
  hospitalName: "Central Veterinary Hospital",
  status: "due",
  source: "staff_request",
  clientName: "Maya Parker",
  clarityId: "CL-1234",
  clientPhone: "5551234567",
  clientDateOfBirth: null,
  petName: "Biscuit",
  petWeight: null,
  lastVisit: null,
  request: "Need labs for Biscuit",
  requestType: "labs_xrays",
  notes: "Follow up with client",
  assignedTo: null,
  assignedByRole: null,
  priority: "medium",
  dueDate: "2026-08-05",
  dueTime: "19:00",
  createdByName: "Jordan",
  createdByRole: "staff",
  updatedByName: null,
  completedByName: null,
  completedByRole: null,
  completedAt: null,
  invalidReason: null,
  archivedAt: null,
  archivedByName: null,
  archivedByRole: null,
  escalatedAt: null,
  escalatedByName: null,
  escalatedByRole: null,
  createdAt: "2026-08-05T10:00:00.000Z",
  updatedAt: "2026-08-05T10:00:00.000Z",
  ...overrides
});

test("task board search normalizes whitespace and case", () => {
  assert.equal(normalizeTaskSearch("  BiScUiT  "), "biscuit");
  assert.match(taskSearchText(baseTask()), /maya parker/);
});

test("task board search matches task text and clears back to the original set", () => {
  const matchingTask = baseTask({ id: "task-1", petName: "Biscuit" });
  const nonMatchingTask = baseTask({
    id: "task-2",
    petName: "Mochi",
    request: "Schedule vaccines",
    requestType: "scheduling",
    notes: "Biscuit follow-up hidden in notes",
    createdAt: "2026-08-05T11:00:00.000Z",
    updatedAt: "2026-08-05T11:00:00.000Z"
  });
  const tasks = [matchingTask, nonMatchingTask];

  assert.deepEqual(filterTaskBoardTasks(tasks, " biscuit "), [matchingTask]);
  assert.deepEqual(filterTaskBoardTasks(tasks, "  no match  "), []);
  assert.deepEqual(filterTaskBoardTasks(tasks, "follow-up"), []);
  assert.deepEqual(filterTaskBoardTasks(tasks, "labs"), [matchingTask]);
  assert.deepEqual(filterTaskBoardTasks(tasks, ""), tasks);
});

test("task board search leaves lane ordering unchanged after filtering", () => {
  const firstDueTask = baseTask({
    id: "task-1",
    request: "Need labs for Biscuit",
    createdAt: "2026-08-05T10:00:00.000Z",
    updatedAt: "2026-08-05T10:00:00.000Z"
  });
  const secondDueTask = baseTask({
    id: "task-2",
    petName: "Mochi",
    request: "Schedule vaccines",
    createdAt: "2026-08-05T11:00:00.000Z",
    updatedAt: "2026-08-05T11:00:00.000Z"
  });
  const tasks = [firstDueTask, secondDueTask];
  const originalLaneOrder = taskLaneItems(tasks, "due", "staff").map((task) => task.id);

  assert.deepEqual(filterTaskBoardTasks(tasks, " biscuit "), [firstDueTask]);
  assert.deepEqual(taskLaneItems(tasks, "due", "staff").map((task) => task.id), originalLaneOrder);
});
