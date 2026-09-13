import assert from "node:assert/strict";
import test from "node:test";
import { createAuthenticatedUsageRecorder } from "./_shared";

const clinic = {
  clinicId: "clinic-1",
  name: "Test Veterinary Hospital",
  slug: "test",
  timeZone: "America/Los_Angeles",
  primaryDomain: "test.example",
  hostname: "test.example"
};

test("authenticated usage records a real clinic-team actor", async () => {
  const recorded: unknown[] = [];
  const record = createAuthenticatedUsageRecorder(
    async (input) => {
      recorded.push(input);
      return true;
    },
    () => true
  );

  await record(
    { name: "Real Clinic Admin", role: "admin" },
    clinic,
    false
  );

  assert.deepEqual(recorded, [{
    clinicId: "clinic-1",
    actor: { name: "Real Clinic Admin", role: "admin" }
  }]);
});

test("authenticated usage excludes demo credentials and automation actors", async () => {
  const recorded: unknown[] = [];
  const record = createAuthenticatedUsageRecorder(
    async (input) => {
      recorded.push(input);
      return true;
    },
    () => true
  );

  await record({ name: "Real Clinic Admin", role: "admin" }, clinic, true);
  await record({ name: "Scenario Runner", role: "admin" }, clinic, false);
  await record({ name: "Front Desk", role: "staff" }, clinic, false);

  assert.deepEqual(recorded, []);
});
