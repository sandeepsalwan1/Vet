import assert from "node:assert/strict";
import test from "node:test";

import {
  assertionLabel,
  assertionExpression,
  establishDemoSession,
  intermediateAssertionTimeout,
  runTask,
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

test("heading text proof accepts the visible text across semantic heading levels", () => {
  const heading = assertionExpression({
    type: "text",
    selector: "h1",
    value: "Welcome back"
  });
  const exactElement = assertionExpression({
    type: "text",
    selector: "[data-agent-proof='signin']",
    value: "Welcome back"
  });

  assert.match(heading, /document\.querySelector\\?\("h1"\\?\)/);
  assert.match(
    heading,
    /document\.querySelectorAll\("h1,h2,h3,h4,h5,h6"\)/
  );
  assert.match(heading, /getComputedStyle/);
  assert.doesNotMatch(exactElement, /querySelectorAll/);
  assert.notEqual(
    assertionLabel({ type: "text", selector: "h1", value: "Welcome back" }),
    assertionLabel({ type: "text", selector: "h2", value: "Opening your clinic" })
  );
});

test("browser payload accepts bounded demo sessions and rejects unknown sessions", () => {
  const authenticated = {
    ...payload,
    tasks: [{ ...payload.tasks[0], session: "demo-admin" }]
  };
  assert.equal(validateBrowserPayload(authenticated), authenticated);
  assert.throws(
    () =>
      validateBrowserPayload({
        ...payload,
        tasks: [{ ...payload.tasks[0], session: "personal-browser" }]
      }),
    /payload is invalid/
  );
});

test("demo session setup clears ambient state before visible login", async () => {
  const calls = [];
  const evaluationResults = [true, true, true, true, true, true];
  const client = {
    async send(method, params = {}) {
      calls.push({ method, params });
      if (method === "Runtime.evaluate") {
        return { result: { value: evaluationResults.shift() } };
      }
      return {};
    }
  };

  const result = await establishDemoSession(
    client,
    "demo-staff",
    "http://127.0.0.1:3000",
    "/staff/approvals"
  );

  assert.equal(result, "Sign in with the visible demo-staff account");
  assert.ok(
    calls.some(
      ({ method, params }) =>
        method === "Runtime.evaluate" &&
        params.expression.includes(
          'localStorage.removeItem("central-vet-session")'
        )
    )
  );
  assert.deepEqual(
    calls
      .filter(({ method }) => method === "Page.navigate")
      .map(({ params }) => params.url),
    [
      "http://127.0.0.1:3000/staff",
      "http://127.0.0.1:3000/staff/approvals"
    ]
  );
});

test("browser task converts interaction exceptions into exact failed evidence", async () => {
  const task = {
    clauseIds: ["AC1"],
    route: "/staff",
    session: "none",
    actions: [{ type: "click", selector: "button[data-missing]" }],
    intermediateAssertions: [],
    finalAssertions: [{ type: "visible", selector: "main" }]
  };
  const client = {
    async send(method) {
      if (method === "Runtime.evaluate") return { exceptionDetails: {} };
      return {};
    }
  };

  const result = await runTask(client, payload, task);

  assert.equal(result.status, "fail");
  assert.match(result.evidence, /browser assertion evaluation failed/);
  assert.deepEqual(result.clauseIds, ["AC1"]);
});

test("browser task converts final assertion exceptions into exact failed evidence", async () => {
  const task = {
    clauseIds: ["AC1"],
    route: "/request",
    session: "none",
    actions: [],
    intermediateAssertions: [],
    finalAssertions: [{ type: "visible", selector: "main" }]
  };
  const client = {
    async send(method) {
      if (method === "Runtime.evaluate") return { exceptionDetails: {} };
      return {};
    }
  };

  const result = await runTask(client, payload, task);

  assert.equal(result.status, "fail");
  assert.match(result.evidence, /Browser assertion failed/);
  assert.deepEqual(result.reproductionSteps, ["Navigate to /request"]);
});

test("intermediate observations wait fully only after the final action", () => {
  assert.equal(intermediateAssertionTimeout(4, 0), 250);
  assert.equal(intermediateAssertionTimeout(4, 2), 250);
  assert.equal(intermediateAssertionTimeout(4, 3), 4_000);
});
