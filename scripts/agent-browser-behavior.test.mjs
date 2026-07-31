import assert from "node:assert/strict";
import test from "node:test";

import {
  assertionLabel,
  assertionExpression,
  establishDemoSession,
  intermediateAssertionTimeout,
  runAction,
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

test("text proof reads form values and treats an expected empty value exactly", () => {
  const expression = assertionExpression({
    type: "text",
    selector: "textarea.chatInput",
    value: ""
  });

  assert.match(expression, /element\.matches\("input,textarea,select"\)/);
  assert.match(expression, /element\.value/);
  assert.match(expression, /=== ""/);
  assert.doesNotMatch(expression, /\.includes\(""\)/);
});

test("text proof reads a button's visible label instead of its value property", () => {
  const expression = assertionExpression({
    type: "text",
    selector: "button",
    value: "Submit"
  });
  const button = {
    matches: () => false,
    value: "",
    textContent: "Submit",
    getClientRects: () => [{}]
  };
  const result = Function(
    "document",
    "getComputedStyle",
    `return ${expression};`
  )(
    { querySelector: () => button },
    () => ({ visibility: "visible", display: "block" })
  );

  assert.equal(result, true);
});

test("text proof binds a select assertion to its selected value", () => {
  const expression = assertionExpression({
    type: "text",
    selector: "select",
    value: "urgent"
  });
  const select = {
    matches: (selector) => selector.includes("select"),
    value: "normal",
    textContent: "NormalUrgent",
    getClientRects: () => [{}]
  };
  const result = Function(
    "document",
    "getComputedStyle",
    `return ${expression};`
  )(
    { querySelector: () => select },
    () => ({ visibility: "visible", display: "block" })
  );

  assert.equal(result, false);
});

test("fill uses the selected control's value setter", async () => {
  let expression = "";
  const client = {
    async send(method, params = {}) {
      if (method === "Runtime.evaluate") expression = params.expression;
      return { result: { value: true } };
    }
  };

  await runAction(client, "", {
    type: "fill",
    selector: "textarea.chatInput",
    value: "Hello"
  });

  assert.match(expression, /Object\.getPrototypeOf\(element\)/);
  assert.match(expression, /element\.focus\(\)/);
  assert.doesNotMatch(expression, /HTMLInputElement\.prototype/);
});

test("press emits complete browser key metadata", async () => {
  const calls = [];
  const client = {
    async send(method, params = {}) {
      calls.push({ method, params });
      return {};
    }
  };

  await runAction(client, "", { type: "press", key: "Enter" });

  assert.deepEqual(calls, [
    {
      method: "Input.dispatchKeyEvent",
      params: {
        type: "keyDown",
        key: "Enter",
        code: "Enter",
        windowsVirtualKeyCode: 13,
        nativeVirtualKeyCode: 13,
        text: "\r",
        unmodifiedText: "\r"
      }
    },
    {
      method: "Input.dispatchKeyEvent",
      params: {
        type: "keyUp",
        key: "Enter",
        code: "Enter",
        windowsVirtualKeyCode: 13,
        nativeVirtualKeyCode: 13
      }
    }
  ]);
});

test("press rejects keys without truthful DOM metadata", async () => {
  await assert.rejects(
    () => runAction({ send: async () => ({}) }, "", { type: "press", key: "." }),
    /unsupported browser key/
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
  const evaluationResults = [
    true,
    true,
    true,
    true,
    true,
    true,
    true,
    true,
    true,
    true
  ];
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

test("navigation retries evaluation while the page context changes", async () => {
  let settledChecks = 0;
  const task = {
    clauseIds: ["AC1"],
    route: "/request",
    session: "none",
    actions: [{ type: "navigate", path: "/request" }],
    intermediateAssertions: [],
    finalAssertions: [{ type: "visible", selector: "main" }]
  };
  const client = {
    async send(method, params = {}) {
      if (method !== "Runtime.evaluate") return {};
      if (
        params.expression.includes("__agentProofNavigationMarkerV1") &&
        params.expression.includes(" = ")
      ) {
        return { result: { value: true } };
      }
      if (params.expression.includes("location.pathname")) {
        settledChecks += 1;
        if (settledChecks === 1) return { result: { value: false } };
        if (settledChecks === 2) {
          throw new Error("Execution context was destroyed");
        }
        if (settledChecks === 3) return { exceptionDetails: {} };
      }
      return { result: { value: true } };
    }
  };

  const result = await runTask(client, payload, task);

  assert.equal(result.status, "pass");
  assert.equal(settledChecks, 4);
});

test("intermediate state is observed only after a user trigger", async () => {
  let filled = false;
  let pressed = false;
  const intermediateChecks = [];
  const task = {
    clauseIds: ["AC1"],
    route: "/proof/dog-egg",
    session: "none",
    actions: [
      { type: "navigate", path: "/proof/dog-egg" },
      { type: "fill", selector: "textarea.chatInput", value: "trigger" },
      { type: "press", key: "Enter" }
    ],
    intermediateAssertions: [
      { type: "text", selector: "textarea.chatInput", value: "" }
    ],
    finalAssertions: [
      { type: "visible", selector: "[data-agent-proof='dog-easter-egg']" }
    ]
  };
  const client = {
    async send(method, params = {}) {
      if (method === "Page.navigate") return {};
      if (method === "Input.dispatchKeyEvent") {
        if (params.type === "keyDown") pressed = true;
        return {};
      }
      if (method !== "Runtime.evaluate") return {};
      if (params.expression.includes("Object.getOwnPropertyDescriptor")) {
        filled = true;
        return { result: { value: true } };
      }
      if (params.expression.includes("textarea.chatInput")) {
        intermediateChecks.push({ filled, pressed });
        return { result: { value: pressed } };
      }
      return { result: { value: true } };
    }
  };

  const result = await runTask(client, payload, task);

  assert.equal(result.status, "pass");
  assert.ok(intermediateChecks.length > 0);
  assert.ok(intermediateChecks.every((check) => check.filled));
  assert.ok(intermediateChecks.some((check) => !check.pressed));
  assert.ok(intermediateChecks.some((check) => check.pressed));
});

test("requested intermediate state cannot disappear without a user trigger", async () => {
  const task = {
    clauseIds: ["AC1"],
    route: "/proof/loading",
    session: "none",
    actions: [{ type: "navigate", path: "/proof/loading" }],
    intermediateAssertions: [
      { type: "visible", selector: "[data-agent-proof-state='loading']" }
    ],
    finalAssertions: [
      { type: "visible", selector: "[data-agent-proof-state='complete']" }
    ]
  };
  const client = {
    async send(method) {
      if (method === "Runtime.evaluate") return { result: { value: true } };
      return {};
    }
  };

  const result = await runTask(client, payload, task);

  assert.equal(result.status, "fail");
  assert.deepEqual(
    result.assertions.filter((assertion) => assertion.phase === "intermediate"),
    [
      {
        phase: "intermediate",
        assertion: "[data-agent-proof-state='loading'] is visible",
        passed: false
      }
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
  assert.deepEqual(result.assertions, []);
});

test("interaction failures retain requested intermediate observations", async () => {
  const task = {
    clauseIds: ["AC1"],
    route: "/staff",
    session: "none",
    actions: [{ type: "click", selector: "button[data-missing]" }],
    intermediateAssertions: [
      { type: "visible", selector: "[data-agent-proof-state='saving']" }
    ],
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
  assert.deepEqual(result.assertions, [
    {
      phase: "intermediate",
      assertion: "[data-agent-proof-state='saving'] is visible",
      passed: false
    }
  ]);
});

test("browser task converts final assertion exceptions into exact failed evidence", async () => {
  const task = {
    clauseIds: ["AC1"],
    route: "/request",
    session: "none",
    actions: [],
    intermediateAssertions: [],
    finalAssertions: [{ type: "unsupported", selector: "main" }]
  };
  const client = {
    async send(method, params = {}) {
      if (
        method === "Runtime.evaluate" &&
        (
          (
            params.expression.includes("__agentProofNavigationMarkerV1") &&
            params.expression.includes(" = ")
          ) ||
          params.expression.includes("location.pathname")
        )
      ) {
        return { result: { value: true } };
      }
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

test("browser task does not wait away a transient final state by rechecking proven intermediates", async () => {
  let hiddenChecks = 0;
  const task = {
    clauseIds: ["AC1"],
    route: "/staff",
    session: "none",
    actions: [
      { type: "click", selector: "button[data-logo]" },
      { type: "click", selector: "button[data-logo]" }
    ],
    intermediateAssertions: [
      { type: "hidden", selector: ".miniConfetti" }
    ],
    finalAssertions: [
      { type: "visible", selector: ".miniConfetti" }
    ]
  };
  const client = {
    async send(method, params = {}) {
      if (method !== "Runtime.evaluate") return {};
      if (params.expression.includes("element.click()")) {
        return { result: { value: true } };
      }
      if (params.expression.startsWith("!")) {
        hiddenChecks += 1;
      }
      return { result: { value: true } };
    }
  };

  const result = await runTask(client, payload, task);

  assert.equal(result.status, "pass");
  assert.equal(hiddenChecks, 1);
});
