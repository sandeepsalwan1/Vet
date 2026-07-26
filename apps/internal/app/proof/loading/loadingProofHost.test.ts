import assert from "node:assert/strict";
import test from "node:test";
import { isLocalProofHost } from "./loadingProofHost";

test("accepts localhost proof hosts", () => {
  assert.equal(isLocalProofHost("localhost"), true);
  assert.equal(isLocalProofHost("localhost:3000"), true);
  assert.equal(isLocalProofHost("127.0.0.1"), true);
  assert.equal(isLocalProofHost("127.0.0.1:3000"), true);
});

test("rejects non-local proof hosts", () => {
  assert.equal(isLocalProofHost("centralvet.eepish.com"), false);
  assert.equal(isLocalProofHost("tricityvet.eepish.com"), false);
  assert.equal(isLocalProofHost(null), false);
});
