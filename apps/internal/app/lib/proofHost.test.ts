import assert from "node:assert/strict";
import test from "node:test";
import { isLocalProofHost } from "./proofHost";

test("allows localhost proof hosts", () => {
  assert.equal(isLocalProofHost("localhost"), true);
  assert.equal(isLocalProofHost("localhost:3000"), true);
  assert.equal(isLocalProofHost("127.0.0.1"), true);
  assert.equal(isLocalProofHost("127.0.0.1:3000"), true);
});

test("rejects nonlocal proof hosts", () => {
  assert.equal(isLocalProofHost("centralvet.eepish.com"), false);
  assert.equal(isLocalProofHost("[::1]"), false);
  assert.equal(isLocalProofHost(null), false);
});
