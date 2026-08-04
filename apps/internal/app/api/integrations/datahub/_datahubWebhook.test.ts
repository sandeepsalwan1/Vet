import assert from "node:assert/strict";
import test from "node:test";
import {
  datahubWebhookResponse,
  hasValidDatahubWebhookSecret,
  InvalidDatahubPayloadError,
  parseDatahubWebhook
} from "./_datahubWebhook";

const payload = {
  metadata: {
    practiceIds: ["practice-1"],
    timestamp: "2026-08-04T18:00:00Z",
    version: "1.0.0"
  },
  data: {
    clients: [{
      type: "Client",
      integrationId: "client-1",
      pimsId: "pims-client-1",
      practiceId: "practice-1",
      isActive: true,
      isDeleted: false,
      firstName: "Test",
      lastName: "Client"
    }],
    futureEntities: [{
      integrationId: "future-1",
      practiceId: "practice-1"
    }]
  }
};

test("parseDatahubWebhook preserves known and future entity arrays", () => {
  const result = parseDatahubWebhook(payload);
  assert.deepEqual(result.practiceIds, ["practice-1"]);
  assert.equal(result.groups.length, 2);
  assert.equal(result.groups[0].records[0].receiptType, "Client");
  assert.equal(result.groups[1].records[0].entityType, "futureEntities");
  assert.deepEqual(result.groups[0].records[0].payload, payload.data.clients[0]);
});

test("parseDatahubWebhook produces a failure receipt for an entity without an id", () => {
  const result = parseDatahubWebhook({
    ...payload,
    data: { clients: [{ firstName: "Missing" }] }
  });
  assert.equal(result.groups[0].records.length, 0);
  assert.deepEqual(result.invalidReceipts, [{
    type: "Client",
    id: "clients:0",
    success: false,
    error: "Entity is missing integrationId and id."
  }]);
});

test("parseDatahubWebhook rejects malformed metadata and entity collections", () => {
  assert.throws(
    () => parseDatahubWebhook({ metadata: {}, data: {} }),
    InvalidDatahubPayloadError
  );
  assert.throws(
    () => parseDatahubWebhook({ ...payload, data: { clients: {} } }),
    InvalidDatahubPayloadError
  );
});

test("hasValidDatahubWebhookSecret supports a dedicated header and constant comparison", () => {
  assert.equal(hasValidDatahubWebhookSecret(new Headers({
    "X-Datahub-Webhook-Secret": "expected"
  }), "expected"), true);
  assert.equal(hasValidDatahubWebhookSecret(new Headers({
    "X-Partner-Api-Key": "wrong"
  }), "expected"), false);
  assert.equal(hasValidDatahubWebhookSecret(new Headers(), undefined), false);
});

test("datahubWebhookResponse returns one 200 receipt array for partial entity results", async () => {
  let receivedPracticeId = "";
  const request = new Request("https://vet.example/api/integrations/datahub", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Datahub-Webhook-Secret": "expected"
    },
    body: JSON.stringify(payload)
  });
  const response = await datahubWebhookResponse(request, {
    expectedSecret: "expected",
    ingest: async (input) => {
      receivedPracticeId = input.practiceIds[0];
      return {
        clinicId: "clinic-1",
        deliveryId: "delivery-1",
        receipts: [
          { type: "Client", id: "client-1", success: true, error: "" },
          { type: "FutureEntity", id: "future-1", success: false, error: "Storage failed." }
        ]
      };
    }
  });
  assert.equal(response.status, 200);
  assert.equal(receivedPracticeId, "practice-1");
  assert.equal((await response.json()).length, 2);
});

test("datahubWebhookResponse rejects unauthorized and malformed requests before storage", async () => {
  const unauthorized = await datahubWebhookResponse(new Request(
    "https://vet.example/api/integrations/datahub",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }
  ), { expectedSecret: "expected" });
  assert.equal(unauthorized.status, 401);

  const malformed = await datahubWebhookResponse(new Request(
    "https://vet.example/api/integrations/datahub",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Datahub-Webhook-Secret": "expected"
      },
      body: JSON.stringify({ metadata: {}, data: {} })
    }
  ), { expectedSecret: "expected" });
  assert.equal(malformed.status, 400);
});
