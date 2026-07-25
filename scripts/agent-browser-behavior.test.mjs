import assert from "node:assert/strict";
import test from "node:test";

import {
  assertionExpression,
  validateBrowserPayload
} from "./agent-browser-behavior.mjs";

const payload = {
  baseUrl: "http://127.0.0.1:3000",
  route: "/proof/loading",
  tasks: [
    {
      clauseIds: ["AC1"],
      route: "/proof/loading",
      actions: [{ type: "navigate", path: "/proof/loading" }],
      intermediateAssertions: [
        { type: "visible", selector: "[data-agent-proof-state='loading']" }
      ],
      finalAssertions: [
        { type: "text", selector: "main", value: "Complete" }
      ]
    }
  ]
};

test("browser payload requires route-bound tasks and final assertions", () => {
  assert.equal(validateBrowserPayload(payload), payload);
  assert.throws(
    () =>
      validateBrowserPayload({
        ...payload,
        tasks: [{ ...payload.tasks[0], route: "/other" }]
      }),
    /payload is invalid/
  );
  assert.throws(
    () =>
      validateBrowserPayload({
        ...payload,
        tasks: [{ ...payload.tasks[0], finalAssertions: [] }]
      }),
    /payload is invalid/
  );
});

test("browser assertion expression treats selectors and values as data", () => {
  const expression = assertionExpression({
    type: "text",
    selector: "[data-value=\"');process.exit()//\"]",
    value: "expected');throw new Error()//"
  });

  assert.match(expression, /document\.querySelector/);
  assert.ok(expression.includes(JSON.stringify("[data-value=\"');process.exit()//\"]")));
  assert.ok(expression.includes(JSON.stringify("expected');throw new Error()//")));
});
