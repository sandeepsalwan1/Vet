import assert from "node:assert/strict";
import test from "node:test";
import { claimThrottleIdentity, requestSchema } from "./route";

test("phone claims reject email-shaped verification destinations", () => {
  assert.equal(requestSchema.safeParse({
    action: "request",
    contactKind: "phone",
    contactValue: "5551234567@attacker.example",
    petName: "Biscuit"
  }).success, false);
});

test("claim contacts accept valid email and formatted phone values", () => {
  assert.equal(requestSchema.safeParse({
    action: "request",
    contactKind: "email",
    contactValue: "maya@example.com",
    petName: "Biscuit"
  }).success, true);
  assert.equal(requestSchema.safeParse({
    action: "request",
    contactKind: "phone",
    contactValue: "+1 (555) 123-4567",
    petName: "Biscuit"
  }).success, true);
});

test("phone formatting cannot create a new claim throttle identity", () => {
  assert.equal(
    claimThrottleIdentity("phone", "(555) 123-4567", "Biscuit"),
    claimThrottleIdentity("phone", "+1 555-123-4567", " biscuit ")
  );
});
