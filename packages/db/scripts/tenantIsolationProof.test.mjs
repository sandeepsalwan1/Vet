import assert from "node:assert/strict";
import test from "node:test";
import { assertTenantIsolation } from "./tenantIsolationProof.ts";

const task = (id, clinicId) => ({ id, clinicId });

test("tenant isolation accepts a write visible only to its clinic", () => {
  assert.doesNotThrow(() =>
    assertTenantIsolation({
      sourceClinicId: "clinic-a",
      otherClinicId: "clinic-b",
      writtenTask: task("task-a", "clinic-a"),
      sameTenantTask: task("task-a", "clinic-a"),
      otherTenantTask: null,
      sameTenantTasks: [task("task-a", "clinic-a")],
      otherTenantTasks: [task("task-b", "clinic-b")]
    })
  );
});

test("tenant isolation rejects a cross-clinic read", () => {
  assert.throws(
    () =>
      assertTenantIsolation({
        sourceClinicId: "clinic-a",
        otherClinicId: "clinic-b",
        writtenTask: task("task-a", "clinic-a"),
        sameTenantTask: task("task-a", "clinic-a"),
        otherTenantTask: task("task-a", "clinic-a"),
        sameTenantTasks: [task("task-a", "clinic-a")],
        otherTenantTasks: [task("task-a", "clinic-a")]
      }),
    assert.AssertionError
  );
});
