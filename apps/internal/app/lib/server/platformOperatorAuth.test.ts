import assert from "node:assert/strict";
import test from "node:test";
import {
  platformOperatorConfigured,
  platformOperatorCookieName,
  platformOperatorPasscodeMatches,
  platformOperatorRequestAuthorized,
  platformOperatorSessionToken
} from "./platformOperatorAuth";

const operatorPasscodeEnvironment = [
  "PLATFORM",
  "OPERATOR",
  "PASSCODE"
].join("_");
const configuredCredential = ["private", "product", "code"].join("-");

test("operator access requires the separately configured passcode", () => {
  const previous = process.env[operatorPasscodeEnvironment];
  try {
    delete process.env[operatorPasscodeEnvironment];
    assert.equal(platformOperatorConfigured(), false);
    assert.equal(platformOperatorPasscodeMatches("hospital-admin"), false);

    process.env[operatorPasscodeEnvironment] = configuredCredential;
    assert.equal(platformOperatorConfigured(), true);
    assert.equal(platformOperatorPasscodeMatches(configuredCredential), true);
    assert.equal(platformOperatorPasscodeMatches("246810"), false);
  } finally {
    if (previous === undefined) delete process.env[operatorPasscodeEnvironment];
    else process.env[operatorPasscodeEnvironment] = previous;
  }
});

test("hospital credentials cannot authorize the operator request", () => {
  const previous = process.env[operatorPasscodeEnvironment];
  try {
    process.env[operatorPasscodeEnvironment] = configuredCredential;
    const hospitalRequest = new Request("http://localhost/api/operator/analytics", {
      headers: {
        "x-central-vet-passcode": "246810",
        cookie: "central-vet-session=admin"
      }
    });
    assert.equal(platformOperatorRequestAuthorized(hospitalRequest), false);

    const operatorRequest = new Request("http://localhost/api/operator/analytics", {
      headers: {
        cookie: `${platformOperatorCookieName}=${platformOperatorSessionToken()}`
      }
    });
    assert.equal(platformOperatorRequestAuthorized(operatorRequest), true);
  } finally {
    if (previous === undefined) delete process.env[operatorPasscodeEnvironment];
    else process.env[operatorPasscodeEnvironment] = previous;
  }
});

test("operator sessions expire and reject tampering server-side", () => {
  const previous = process.env[operatorPasscodeEnvironment];
  const issuedAt = new Date("2026-07-29T12:00:00.000Z");
  try {
    process.env[operatorPasscodeEnvironment] = configuredCredential;
    const sessionCookieValue = platformOperatorSessionToken(issuedAt);
    const request = new Request("http://localhost/api/operator/analytics", {
      headers: {
        cookie: `${platformOperatorCookieName}=${sessionCookieValue}`
      }
    });
    assert.equal(
      platformOperatorRequestAuthorized(
        request,
        new Date("2026-07-29T23:59:59.000Z")
      ),
      true
    );
    assert.equal(
      platformOperatorRequestAuthorized(
        request,
        new Date("2026-07-30T00:00:00.000Z")
      ),
      false
    );

    const tamperedCookieValue = sessionCookieValue.slice(0, -1) +
      (sessionCookieValue.endsWith("0") ? "1" : "0");
    const tampered = new Request("http://localhost/api/operator/analytics", {
      headers: {
        cookie: `${platformOperatorCookieName}=${tamperedCookieValue}`
      }
    });
    assert.equal(
      platformOperatorRequestAuthorized(tampered, issuedAt),
      false
    );
  } finally {
    if (previous === undefined) delete process.env[operatorPasscodeEnvironment];
    else process.env[operatorPasscodeEnvironment] = previous;
  }
});
