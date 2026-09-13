import assert from "node:assert/strict";
import test from "node:test";
import { withDbError } from "./_apiResponse";

test("withDbError preserves every route handler argument", async () => {
  const request = new Request("https://clinic.example/api/tasks/task-1");
  const context = { params: Promise.resolve({ id: "task-1" }) };
  const handler = withDbError(
    "tasks.update",
    async (receivedRequest: Request, receivedContext: typeof context) => {
      assert.equal(receivedRequest, request);
      assert.equal(receivedContext, context);
      return new Response("ok", { status: 202 });
    }
  );

  const response = await handler(request, context);

  assert.equal(response.status, 202);
  assert.equal(await response.text(), "ok");
});

test("withDbError maps unexpected failures with the route label", async () => {
  const originalConsoleError = console.error;
  let logged: unknown;
  console.error = (value) => {
    logged = value;
  };

  try {
    const handler = withDbError("tasks.update", async () => {
      throw new Error("database unavailable");
    });
    const response = await handler();

    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: "Server error." });
    assert.deepEqual(logged, {
      event: "server_error",
      at: (logged as { at: string }).at,
      route: "tasks.update",
      error: "database unavailable"
    });
  } finally {
    console.error = originalConsoleError;
  }
});
