import assert from "node:assert/strict";
import test from "node:test";
import {
  createNotificationSender,
  type NotificationAttemptAdapter,
  type NotificationTransportAdapter
} from "./notificationSend";

function testSender(options?: {
  createResult?:
    | { id: string }
    | {
        duplicate: true;
        priorStatus?: "pending" | "sent" | "skipped" | "failed";
      };
  transportError?: string;
}) {
  const events: string[] = [];
  const attempts: NotificationAttemptAdapter = {
    async create(input) {
      events.push(`create:${input.notificationType}`);
      return options?.createResult === undefined
        ? { id: "attempt-1" }
        : options.createResult;
    },
    async mark(outcome) {
      events.push(`mark:${outcome.status}:${outcome.providerId ?? outcome.error ?? ""}`);
    }
  };
  const transports: NotificationTransportAdapter = {
    async sendEmail(input) {
      events.push(`email:${input.recipient}`);
      if (options?.transportError) throw new Error(options.transportError);
      return "provider-1";
    },
    async sendSms(input) {
      events.push(`sms:${input.recipient}`);
      return "provider-2";
    }
  };
  return {
    events,
    send: createNotificationSender(attempts, transports)
  };
}

const input = {
  notificationType: "operator_low_return",
  subject: "Return rate",
  html: "<p>Return rate</p>",
  text: "Return rate",
  idempotencyKeyBase: "operator-low-return/2026-07-29",
  modeOverride: "production" as const,
  channelOverride: "email" as const,
  deliveriesOverride: [{
    channel: "email" as const,
    recipients: ["operator@example.test"]
  }]
};

test("notification sender owns attempt, provider, and sent ordering", async () => {
  const sender = testSender();
  const results = await sender.send(input);

  assert.deepEqual(sender.events, [
    "create:operator_low_return_email",
    "email:operator@example.test",
    "mark:sent:provider-1"
  ]);
  assert.deepEqual(results, [{
    recipient: "operator@example.test",
    status: "sent",
    channel: "email",
    resendId: "provider-1"
  }]);
});

test("notification sender stops at a duplicate attempt", async () => {
  const sender = testSender({
    createResult: {
      duplicate: true,
      priorStatus: "failed"
    }
  });
  const results = await sender.send(input);

  assert.deepEqual(sender.events, ["create:operator_low_return_email"]);
  assert.deepEqual(results[0], {
    recipient: "operator@example.test",
    status: "duplicate",
    channel: "email",
    priorStatus: "failed"
  });
});

test("notification sender records provider failures", async () => {
  const sender = testSender({ transportError: "RESEND_API_KEY is required." });
  const results = await sender.send(input);

  assert.deepEqual(sender.events, [
    "create:operator_low_return_email",
    "email:operator@example.test",
    "mark:failed:RESEND_API_KEY is required."
  ]);
  assert.deepEqual(results[0], {
    recipient: "operator@example.test",
    status: "failed",
    channel: "email",
    error: "RESEND_API_KEY is required."
  });
});

test("notification sender records disabled delivery without provider work", async () => {
  const sender = testSender();
  const results = await sender.send({
    ...input,
    modeOverride: "disabled"
  });

  assert.deepEqual(sender.events, [
    "create:operator_low_return_email",
    "mark:skipped:NOTIFICATION_MODE=disabled"
  ]);
  assert.equal(results[0]?.status, "skipped");
});
