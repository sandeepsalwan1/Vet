import assert from "node:assert/strict";
import test from "node:test";
import {
  claimThrottleIdentity,
  clientAccountClaimResponse,
  requestSchema
} from "./_claimRequest";

test("account claim interface rejects malformed details before workflow side effects", async () => {
  const response = await clientAccountClaimResponse(new Request(
    "http://localhost/api/client-account-claim",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "request",
        contactKind: "phone",
        contactValue: "not-a-phone",
        petName: "Biscuit"
      })
    }
  ));

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "Check the account setup details."
  });
});

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
