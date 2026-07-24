import assert from "node:assert/strict";
import test from "node:test";
import { requestHostname } from "./_requestHostname";

test("uses the request host instead of a client-supplied forwarded host", () => {
  const request = new Request("https://centralvet.eepish.com/api/clinic", {
    headers: {
      host: "centralvet.eepish.com",
      "x-forwarded-host": "tricityvet.eepish.com"
    }
  });

  assert.equal(requestHostname(request), "centralvet.eepish.com");
});

test("uses the URL host when the host header is unavailable", () => {
  const request = new Request("https://tricityvet.eepish.com/api/clinic");
  assert.equal(requestHostname(request), "tricityvet.eepish.com");
});
