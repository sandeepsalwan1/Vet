import assert from "node:assert/strict";
import test from "node:test";
import {
  deduplicateDatahubRecords,
  type DatahubPimsRecord
} from "./datahub";

function record(overrides: Partial<DatahubPimsRecord> = {}): DatahubPimsRecord {
  return {
    entityType: "clients",
    receiptType: "Client",
    integrationId: "client-1",
    providerPracticeId: "practice-1",
    pimsId: "pims-client-1",
    siteId: "site-1",
    isActive: true,
    isDeleted: false,
    deletedAt: null,
    providerUpdatedAt: null,
    payload: { firstName: "Before" },
    ...overrides
  };
}

test("deduplicateDatahubRecords keeps the last payload for one storage identity", () => {
  const after = record({ payload: { firstName: "After" } });
  const result = deduplicateDatahubRecords([record(), after]);
  assert.equal(result.length, 1);
  assert.equal(result[0], after);
});

test("deduplicateDatahubRecords preserves records with different storage identities", () => {
  const result = deduplicateDatahubRecords([
    record(),
    record({ providerPracticeId: "practice-2" }),
    record({ entityType: "patients" }),
    record({ integrationId: "client-2" })
  ]);
  assert.equal(result.length, 4);
});
