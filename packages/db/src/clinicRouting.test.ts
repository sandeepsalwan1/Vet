import assert from "node:assert/strict";
import test from "node:test";
import {
  UnknownClinicHostnameError,
  normalizeClinicHostname,
  resolveMappedClinicForHostname
} from "./clinicRouting";

const centralVet = {
  id: "central-id",
  slug: "central-vet",
  name: "Central Veterinary Hospital",
  timeZone: "America/Los_Angeles"
};

test("normalizes forwarded host values without changing the hospital identity", () => {
  assert.equal(
    normalizeClinicHostname("CentralVet.Eepish.com:443, proxy.internal"),
    "centralvet.eepish.com"
  );
});

test("resolves only an explicitly mapped hospital hostname", async () => {
  const seen: string[] = [];
  const clinic = await resolveMappedClinicForHostname(
    "centralvet.eepish.com:443",
    async (hostname) => {
      seen.push(hostname);
      return hostname === "centralvet.eepish.com" ? centralVet : null;
    }
  );

  assert.deepEqual(seen, ["centralvet.eepish.com"]);
  assert.deepEqual(clinic, {
    clinicId: "central-id",
    slug: "central-vet",
    name: "Central Veterinary Hospital",
    timeZone: "America/Los_Angeles",
    hostname: "centralvet.eepish.com"
  });
});

test("rejects unknown hostnames instead of falling back to another hospital", async () => {
  await assert.rejects(
    () => resolveMappedClinicForHostname("unknown.eepish.com", async () => null),
    (error: unknown) => {
      assert.ok(error instanceof UnknownClinicHostnameError);
      assert.equal(error.hostname, "unknown.eepish.com");
      return true;
    }
  );
});

test("rejects requests without a hostname", async () => {
  await assert.rejects(
    () => resolveMappedClinicForHostname(null, async () => centralVet),
    UnknownClinicHostnameError
  );
});
