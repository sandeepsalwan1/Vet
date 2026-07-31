import assert from "node:assert/strict";
import test from "node:test";

import {
  assertionLabel,
  assertionExpression,
  establishDemoSession,
  installBrowserEventCollector,
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

test("fill uses browser-native insertion and waits for controlled state", async () => {
  const calls = [];
  let persistenceChecks = 0;
  let triggeredAtPersistenceCheck;
  const client = {
    async send(method, params = {}) {
      calls.push({ method, params });
      if (
        method === "Runtime.evaluate" &&
        params.expression.includes('return "text"')
      ) {
        return { result: { value: "text" } };
      }
      if (
        method === "Runtime.evaluate" &&
        params.expression.includes('element.value === "Hello"')
      ) {
        persistenceChecks += 1;
        return { result: { value: true } };
      }
      return { result: { value: true } };
    }
  };

  await runAction(
    client,
    "",
    {
      type: "fill",
      selector: "textarea.chatInput",
      value: "Hello"
    },
    () => {
      triggeredAtPersistenceCheck = persistenceChecks;
    }
  );

  for (const { method, params } of calls) {
    if (method === "Runtime.evaluate") {
      assert.doesNotThrow(() => new Function(`return (${params.expression});`));
    }
  }
  assert.ok(
    calls.some(
      ({ method, params }) =>
        method === "Runtime.evaluate" &&
        params.expression.includes("element.focus()") &&
        params.expression.includes('return "text"')
    )
  );
  assert.equal(triggeredAtPersistenceCheck, 0);
  assert.ok(persistenceChecks >= 5);
  assert.deepEqual(
    calls
      .filter(({ method }) => method === "Input.insertText")
      .map(({ params }) => params.text),
    ["Hello"]
  );
  assert.deepEqual(
    calls
      .filter(({ method }) => method === "Input.dispatchKeyEvent")
      .map(({ params }) => ({
        type: params.type,
        key: params.key,
        commands: params.commands
      })),
    [
      { type: "rawKeyDown", key: "a", commands: ["selectAll"] },
      { type: "keyUp", key: "a", commands: undefined }
    ]
  );
});

test("fill fails before the next action when controlled state rejects the value", async () => {
  let persistenceChecks = 0;
  const client = {
    async send(method, params = {}) {
      if (
        method === "Runtime.evaluate" &&
        params.expression.includes('return "text"')
      ) {
        return { result: { value: "text" } };
      }
      if (
        method === "Runtime.evaluate" &&
        params.expression.includes('element.value === "a@b.c"')
      ) {
        persistenceChecks += 1;
        return { result: { value: persistenceChecks <= 3 } };
      }
      return { result: { value: true } };
    }
  };

  await assert.rejects(
    () =>
      runAction(client, "", {
        type: "fill",
        selector: "input[type=email]",
        value: "a@b.c"
      }),
    /browser fill did not persist: input\[type=email\]/
  );
  assert.ok(persistenceChecks > 3);
});

test("select fill waits for the controlled value to persist", async () => {
  let persistenceChecks = 0;
  const client = {
    async send(method, params = {}) {
      if (
        method === "Runtime.evaluate" &&
        params.expression.includes('return "select"')
      ) {
        return { result: { value: "select" } };
      }
      if (
        method === "Runtime.evaluate" &&
        params.expression.includes('element.value === "urgent"')
      ) {
        persistenceChecks += 1;
        return { result: { value: true } };
      }
      return { result: { value: true } };
    }
  };

  await runAction(client, "", {
    type: "fill",
    selector: "select[name=priority]",
    value: "urgent"
  });

  assert.ok(persistenceChecks >= 5);
});

test("number fill uses browser selection without invalid DOM selection APIs", async () => {
  const calls = [];
  const client = {
    async send(method, params = {}) {
      calls.push({ method, params });
      if (
        method === "Runtime.evaluate" &&
        params.expression.includes('return "text"')
      ) {
        return { result: { value: "text" } };
      }
      return { result: { value: true } };
    }
  };

  await runAction(client, "", {
    type: "fill",
    selector: "input[type=number]",
    value: "42"
  });

  assert.ok(
    calls
      .filter(({ method }) => method === "Runtime.evaluate")
      .every(({ params }) => !params.expression.includes("element.select()"))
  );
  assert.ok(
    calls.some(
      ({ method, params }) =>
        method === "Input.dispatchKeyEvent" &&
        params.commands?.includes("selectAll")
    )
  );
  assert.ok(
    calls.some(
      ({ method, params }) =>
        method === "Input.insertText" && params.text === "42"
    )
  );
});

test("empty fill clears controlled state with a browser-native Backspace", async () => {
  const calls = [];
  const client = {
    async send(method, params = {}) {
      calls.push({ method, params });
      if (
        method === "Runtime.evaluate" &&
        params.expression.includes('return "text"')
      ) {
        return { result: { value: "text" } };
      }
      return { result: { value: true } };
    }
  };

  await runAction(client, "", {
    type: "fill",
    selector: "textarea.chatInput",
    value: ""
  });

  assert.ok(
    calls.some(
      ({ method, params }) =>
        method === "Runtime.evaluate" &&
        params.expression.includes("element.focus()")
    )
  );
  assert.deepEqual(
    calls
      .filter(({ method }) => method === "Input.dispatchKeyEvent")
      .map(({ params }) => ({ type: params.type, key: params.key })),
    [
      { type: "rawKeyDown", key: "a" },
      { type: "keyUp", key: "a" },
      { type: "rawKeyDown", key: "Backspace" },
      { type: "keyUp", key: "Backspace" }
    ]
  );
  assert.ok(calls.every(({ method }) => method !== "Input.insertText"));
});

test("fill rejects non-text inputs instead of invoking invalid selection APIs", async () => {
  const client = {
    async send(method, params = {}) {
      if (method !== "Runtime.evaluate") return {};
      if (params.expression.includes('return "unsupported"')) {
        return { result: { value: "unsupported" } };
      }
      return { result: { value: true } };
    }
  };

  await assert.rejects(
    () =>
      runAction(client, "", {
        type: "fill",
        selector: "input[type=file]",
        value: "anything"
      }),
    /browser fill target is unsupported/
  );
});

test("fill never sends native input when the requested control cannot focus", async () => {
  const calls = [];
  const client = {
    async send(method, params = {}) {
      calls.push({ method, params });
      if (
        method === "Runtime.evaluate" &&
        params.expression.includes('return "unfocused"')
      ) {
        return { result: { value: "unfocused" } };
      }
      return { result: { value: true } };
    }
  };

  await assert.rejects(
    () =>
      runAction(client, "", {
        type: "fill",
        selector: "textarea[hidden]",
        value: "must not leak"
      }),
    /browser fill target could not be focused/
  );
  assert.ok(
    calls.every(
      ({ method }) =>
        method !== "Input.dispatchKeyEvent" && method !== "Input.insertText"
    )
  );
});

test("click uses browser-native pointer input at the visible target", async () => {
  const calls = [];
  const client = {
    async send(method, params = {}) {
      calls.push({ method, params });
      if (
        method === "Runtime.evaluate" &&
        params.expression.includes("getBoundingClientRect")
      ) {
        return { result: { value: { x: 24.5, y: 48.25 } } };
      }
      return {};
    }
  };

  await runAction(client, "", {
    type: "click",
    selector: "button[data-save]"
  });

  assert.doesNotMatch(calls[0].params.expression, /element\.click/);
  assert.deepEqual(
    calls
      .filter(({ method }) => method === "Input.dispatchMouseEvent")
      .map(({ params }) => ({
        type: params.type,
        x: params.x,
        y: params.y,
        button: params.button,
        buttons: params.buttons
      })),
    [
      {
        type: "mouseMoved",
        x: 24.5,
        y: 48.25,
        button: "none",
        buttons: 0
      },
      {
        type: "mousePressed",
        x: 24.5,
        y: 48.25,
        button: "left",
        buttons: 1
      },
      {
        type: "mouseReleased",
        x: 24.5,
        y: 48.25,
        button: "left",
        buttons: 0
      }
    ]
  );
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
        type: "rawKeyDown",
        modifiers: 0,
        key: "Enter",
        code: "Enter",
        windowsVirtualKeyCode: 13,
        location: 0,
        autoRepeat: false,
        isKeypad: false,
        commands: []
      }
    },
    {
      method: "Input.dispatchKeyEvent",
      params: {
        type: "keyUp",
        modifiers: 0,
        key: "Enter",
        code: "Enter",
        windowsVirtualKeyCode: 13,
        location: 0
      }
    }
  ]);
});

test("alphanumeric press retains browser text generation", async () => {
  const calls = [];
  const client = {
    async send(method, params = {}) {
      calls.push({ method, params });
      return {};
    }
  };

  await runAction(client, "", { type: "press", key: "a" });

  assert.equal(calls[0].params.type, "keyDown");
  assert.equal(calls[0].params.text, "a");
  assert.equal(calls[0].params.unmodifiedText, "a");
  assert.equal(calls[1].params.type, "keyUp");
});

test("Space uses one named-control raw key sequence", async () => {
  const calls = [];
  const client = {
    async send(method, params = {}) {
      calls.push({ method, params });
      return {};
    }
  };

  await runAction(client, "", { type: "press", key: " " });

  assert.equal(calls[0].params.type, "rawKeyDown");
  assert.equal(calls[0].params.key, " ");
  assert.equal(calls[0].params.code, "Space");
  assert.equal(calls[0].params.text, undefined);
  assert.equal(calls[0].params.unmodifiedText, undefined);
  assert.equal(calls[1].params.type, "keyUp");
});

test("non-text keys use raw keydown browser metadata", async () => {
  const calls = [];
  const client = {
    async send(method, params = {}) {
      calls.push({ method, params });
      return {};
    }
  };

  await runAction(client, "", { type: "press", key: "ArrowDown" });

  assert.equal(calls[0].params.type, "rawKeyDown");
  assert.equal(calls[0].params.key, "ArrowDown");
  assert.equal(calls[0].params.code, "ArrowDown");
  assert.equal(calls[0].params.windowsVirtualKeyCode, 40);
  assert.equal(calls[0].params.text, undefined);
  assert.equal(calls[0].params.unmodifiedText, undefined);
  assert.equal(calls[0].params.nativeVirtualKeyCode, undefined);
  assert.equal(calls[1].params.type, "keyUp");
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
  const client = {
    async send(method, params = {}) {
      calls.push({ method, params });
      if (method === "Runtime.evaluate") {
        if (params.expression.includes("getBoundingClientRect")) {
          return { result: { value: { x: 20, y: 20 } } };
        }
        if (params.expression.includes('return "text"')) {
          return { result: { value: "text" } };
        }
        return { result: { value: true } };
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
  let painted = false;
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
      if (params.expression.includes("requestAnimationFrame")) {
        painted = true;
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
  assert.equal(painted, true);
});

test("navigation requires full document load before its painted interaction boundary", async () => {
  const expressions = [];
  const client = {
    async send(method, params = {}) {
      if (method === "Runtime.evaluate") {
        expressions.push(params.expression);
        return { result: { value: true } };
      }
      return {};
    }
  };

  await runAction(client, "http://127.0.0.1:3000", {
    type: "navigate",
    path: "/request"
  });

  const settledIndex = expressions.findIndex((expression) =>
    expression.includes('document.readyState === "complete"')
  );
  const paintedIndex = expressions.findIndex((expression) =>
    expression.includes("requestAnimationFrame") &&
    expression.includes("setTimeout(() => resolve(false)")
  );
  assert.ok(settledIndex >= 0);
  assert.ok(paintedIndex > settledIndex);
  assert.match(expressions[paintedIndex], /location\.pathname === "\/request"/);
  assert.match(
    expressions[paintedIndex],
    /document\.readyState === "complete"/
  );
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
        if (params.type === "rawKeyDown" && params.key === "Enter") pressed = true;
        return {};
      }
      if (method !== "Runtime.evaluate") return {};
      if (params.expression.includes('return "text"')) {
        filled = true;
        return { result: { value: "text" } };
      }
      if (params.expression.includes('element.value === "trigger"')) {
        return { result: { value: true } };
      }
      if (params.expression.includes("Boolean(element && !element.disabled")) {
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

test("rejected controlled fill cannot authorize a later action or assertion", async () => {
  let pressed = false;
  let emptyAssertionChecks = 0;
  const task = {
    clauseIds: ["AC1"],
    route: "/proof/dog-egg",
    session: "none",
    actions: [
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
      if (
        method === "Input.dispatchKeyEvent" &&
        params.type === "rawKeyDown" &&
        params.key === "Enter"
      ) {
        pressed = true;
        return {};
      }
      if (method !== "Runtime.evaluate") return {};
      if (params.expression.includes('return "text"')) {
        return { result: { value: "text" } };
      }
      if (params.expression.includes('element.value === "trigger"')) {
        return { result: { value: false } };
      }
      if (
        params.expression.includes("textarea.chatInput") &&
        params.expression.includes('=== ""')
      ) {
        emptyAssertionChecks += 1;
        return { result: { value: true } };
      }
      return { result: { value: true } };
    }
  };

  const result = await runTask(client, payload, task);

  assert.equal(result.status, "fail");
  assert.match(result.evidence, /browser fill did not persist/);
  assert.equal(pressed, false);
  assert.ok(emptyAssertionChecks > 0);
  assert.deepEqual(result.assertions, [
    {
      phase: "intermediate",
      assertion: "textarea.chatInput contains expected text",
      passed: false
    }
  ]);
});

test("failed tasks retain bounded content-free native browser event evidence", async () => {
  let traceInstaller = "";
  const nativeEvents = [
    {
      type: "input",
      trusted: true,
      prevented: false,
      key: "",
      inputType: "insertText",
      targetTag: "textarea",
      activeTag: "textarea"
    },
    {
      type: "keydown",
      trusted: true,
      prevented: true,
      key: "Enter",
      inputType: "",
      targetTag: "textarea",
      activeTag: "textarea"
    }
  ];
  const task = {
    clauseIds: ["AC1"],
    route: "/proof/dog-egg",
    session: "none",
    actions: [
      { type: "press", key: "Enter" },
      { type: "unsupported" }
    ],
    intermediateAssertions: [],
    finalAssertions: [
      { type: "visible", selector: "[data-agent-proof='dog-easter-egg']" }
    ]
  };
  const client = {
    async send(method, params = {}) {
      if (method !== "Runtime.evaluate") return {};
      if (params.expression.includes("__agentProofEventTraceV1") &&
          params.expression.includes(".read?.()")) {
        return { result: { value: nativeEvents } };
      }
      if (params.expression.includes("__agentProofEventTraceV1")) {
        traceInstaller = params.expression;
        return { result: { value: true } };
      }
      return { result: { value: true } };
    }
  };

  const result = await runTask(client, payload, task);

  assert.equal(result.status, "fail");
  assert.deepEqual(result.browserEvents, nativeEvents);
  assert.ok(
    Object.values(result.browserEvents[0]).every(
      (value) => value !== "I NEED A DOG IMAGE NOW"
    )
  );
  assert.match(traceInstaller, /if \(!event\.isTrusted\) return/);
  assert.match(traceInstaller, /namedKeys\.has\(event\.key\)/);
  assert.match(traceInstaller, /inputTypes\.has\(event\.inputType\)/);
  assert.match(traceInstaller, /length > 64\) events\.shift/);
  assert.match(traceInstaller, /Object\.defineProperty\(globalThis, key/);
  assert.match(traceInstaller, /publish\(JSON\.stringify\(events\.at\(-1\)\)\)/);
  assert.match(traceInstaller, /}, true\)/);
});

test("browser event evidence resets before each task", async () => {
  const keyup = {
    type: "keyup",
    trusted: true,
    prevented: false,
    key: "Enter",
    inputType: "",
    targetTag: "textarea",
    activeTag: "textarea"
  };
  let events = [{ ...keyup, type: "keydown" }];
  let resetCount = 0;
  const client = {
    async send(method, params = {}) {
      if (method !== "Runtime.evaluate") return {};
      if (
        params.expression.includes("__agentProofEventTraceV1") &&
        params.expression.includes(".reset?.()")
      ) {
        events = [];
        resetCount += 1;
        return { result: { value: true } };
      }
      if (
        params.expression.includes("__agentProofEventTraceV1") &&
        params.expression.includes(".read?.()")
      ) {
        return { result: { value: structuredClone(events) } };
      }
      if (params.expression.includes("__agentProofEventTraceV1")) {
        events.push(keyup);
        return { result: { value: true } };
      }
      return { result: { value: true } };
    }
  };
  const task = {
    clauseIds: ["AC1"],
    route: "/proof/dog-egg",
    session: "none",
    actions: [
      { type: "press", key: "Enter" },
      { type: "unsupported" }
    ],
    intermediateAssertions: [],
    finalAssertions: [
      { type: "visible", selector: "[data-agent-proof='dog-easter-egg']" }
    ]
  };

  const first = await runTask(client, payload, task);
  events.push({
    type: "input",
    trusted: true,
    prevented: false,
    key: "",
    inputType: "insertText",
    targetTag: "textarea",
    activeTag: "textarea"
  });
  const second = await runTask(client, payload, task);

  assert.equal(resetCount, 2);
  assert.deepEqual(first.browserEvents, [keyup]);
  assert.deepEqual(second.browserEvents, [keyup]);
});

test("runner event collector retains only bounded sanitized navigation-safe events", async () => {
  let bindingListener;
  let disposed = false;
  let bindingName = "";
  const calls = [];
  const client = {
    on(method, listener) {
      assert.equal(method, "Runtime.bindingCalled");
      bindingListener = listener;
      return () => {
        disposed = true;
      };
    },
    async send(method, params = {}) {
      calls.push({ method, params });
      if (method === "Runtime.addBinding") bindingName = params.name;
      if (method === "Page.addScriptToEvaluateOnNewDocument") {
        return { identifier: "event-trace-script" };
      }
      return {};
    }
  };

  const collector = await installBrowserEventCollector(client);
  const binding = calls.find(({ method }) => method === "Runtime.addBinding");
  const script = calls.find(
    ({ method }) => method === "Page.addScriptToEvaluateOnNewDocument"
  );
  assert.equal(binding.params.executionContextName, script.params.worldName);
  assert.equal(script.params.runImmediately, true);
  assert.match(script.params.source, /if \(!event\.isTrusted\) return/);
  bindingListener({
    name: bindingName,
    payload: JSON.stringify({
      type: "click",
      trusted: true,
      prevented: false,
      key: "secret page text",
      inputType: "secret input type",
      targetTag: "button",
      activeTag: "body"
    })
  });
  bindingListener({
    name: bindingName,
    payload: JSON.stringify({
      type: "keydown",
      trusted: false,
      key: "Enter"
    })
  });
  bindingListener({
    name: bindingName,
    payload: "x".repeat(513)
  });

  assert.deepEqual(collector.read(), [
    {
      type: "click",
      trusted: true,
      prevented: false,
      key: "",
      inputType: "",
      targetTag: "button",
      activeTag: "body"
    }
  ]);
  collector.reset();
  assert.deepEqual(collector.read(), []);
  await collector.dispose();
  assert.equal(disposed, true);
  assert.ok(
    calls.some(({ method }) => method === "Runtime.removeBinding")
  );
  assert.ok(
    calls.some(
      ({ method, params }) =>
        method === "Page.removeScriptToEvaluateOnNewDocument" &&
        params.identifier === "event-trace-script"
    )
  );
});

test("successful demo setup events are cleared before task actions", async () => {
  let events = [];
  let resetCount = 0;
  const client = {
    async send(method, params = {}) {
      if (method === "Runtime.evaluate") {
        if (
          params.expression.includes("__agentProofEventTraceV1") &&
          params.expression.includes(".reset?.()")
        ) {
          events = [];
          resetCount += 1;
          return { result: { value: true } };
        }
        if (
          params.expression.includes("__agentProofEventTraceV1") &&
          params.expression.includes(".read?.()")
        ) {
          return { result: { value: structuredClone(events) } };
        }
        if (params.expression.includes("__agentProofEventTraceV1")) {
          events.push({ type: "input", inputType: "insertText" });
          return { result: { value: true } };
        }
        if (params.expression.includes('return "text"')) {
          return { result: { value: "text" } };
        }
        if (params.expression.includes("getBoundingClientRect")) {
          return { result: { value: { x: 20, y: 20 } } };
        }
        return { result: { value: true } };
      }
      return {};
    }
  };
  const task = {
    clauseIds: ["AC1"],
    route: "/staff",
    session: "demo-staff",
    actions: [{ type: "unsupported" }],
    intermediateAssertions: [],
    finalAssertions: [{ type: "visible", selector: "main" }]
  };

  const result = await runTask(client, payload, task);

  assert.equal(resetCount, 2);
  assert.deepEqual(result.browserEvents, []);
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
          params.expression.includes("location.pathname") ||
          params.expression.includes("requestAnimationFrame")
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
  assert.deepEqual(result.assertions, [
    {
      phase: "final",
      assertion: "main is unsupported",
      passed: false
    }
  ]);
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
      if (params.expression.includes("getBoundingClientRect")) {
        return { result: { value: { x: 20, y: 20 } } };
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

test("last user action observes transient final state while intermediate state settles", async () => {
  let intermediateChecks = 0;
  let finalChecks = 0;
  const task = {
    clauseIds: ["AC1"],
    route: "/request",
    session: "none",
    actions: [{ type: "click", selector: "button[data-save]" }],
    intermediateAssertions: [
      { type: "visible", selector: "[data-state='saved']" }
    ],
    finalAssertions: [
      { type: "visible", selector: "[data-state='toast']" }
    ]
  };
  const client = {
    async send(method, params = {}) {
      if (method !== "Runtime.evaluate") return {};
      if (params.expression.includes("getBoundingClientRect")) {
        return { result: { value: { x: 20, y: 20 } } };
      }
      if (params.expression.includes("[data-state='saved']")) {
        intermediateChecks += 1;
        return { result: { value: intermediateChecks >= 2 } };
      }
      if (params.expression.includes("[data-state='toast']")) {
        finalChecks += 1;
        return { result: { value: finalChecks === 1 } };
      }
      return { result: { value: true } };
    }
  };

  const result = await runTask(client, payload, task);

  assert.equal(result.status, "pass");
  assert.ok(intermediateChecks >= 2);
  assert.ok(finalChecks >= 1);
});

test("last user action observes transient final state without intermediate assertions", async () => {
  let finalChecks = 0;
  const task = {
    clauseIds: ["AC1"],
    route: "/request",
    session: "none",
    actions: [{ type: "click", selector: "button[data-save]" }],
    intermediateAssertions: [],
    finalAssertions: [
      { type: "visible", selector: "[data-state='toast']" }
    ]
  };
  const client = {
    async send(method, params = {}) {
      if (method !== "Runtime.evaluate") return {};
      if (params.expression.includes("getBoundingClientRect")) {
        return { result: { value: { x: 20, y: 20 } } };
      }
      if (params.expression.includes("[data-state='toast']")) {
        finalChecks += 1;
        return { result: { value: finalChecks === 1 } };
      }
      return { result: { value: true } };
    }
  };

  const result = await runTask(client, payload, task);

  assert.equal(result.status, "pass");
  assert.equal(finalChecks, 1);
});

test("key-triggered final state is observed before a slow keydown response", async () => {
  let visible = false;
  const task = {
    clauseIds: ["AC1"],
    route: "/request",
    session: "none",
    actions: [{ type: "press", key: "Enter" }],
    intermediateAssertions: [],
    finalAssertions: [
      { type: "visible", selector: "[data-state='toast']" }
    ]
  };
  const client = {
    async send(method, params = {}) {
      if (
        method === "Input.dispatchKeyEvent" &&
        params.type === "rawKeyDown"
      ) {
        visible = true;
        setTimeout(() => {
          visible = false;
        }, 20);
        await new Promise((resolve) => setTimeout(resolve, 50));
        return {};
      }
      if (
        method === "Input.dispatchKeyEvent" &&
        params.type === "keyUp"
      ) {
        return {};
      }
      if (
        method === "Runtime.evaluate" &&
        params.expression.includes("[data-state='toast']")
      ) {
        return { result: { value: visible } };
      }
      return {};
    }
  };

  const result = await runTask(client, payload, task);

  assert.equal(result.status, "pass");
});

test("last user trigger retains a delayed transient final state before a trailing wait", async () => {
  let triggeredAt = 0;
  const task = {
    clauseIds: ["AC1"],
    route: "/request",
    session: "none",
    actions: [
      { type: "click", selector: "button[data-save]" },
      { type: "wait", milliseconds: 500 }
    ],
    intermediateAssertions: [],
    finalAssertions: [
      { type: "visible", selector: "[data-state='toast']" }
    ]
  };
  const client = {
    async send(method, params = {}) {
      if (method !== "Runtime.evaluate") return {};
      if (params.expression.includes("getBoundingClientRect")) {
        triggeredAt = Date.now();
        return { result: { value: { x: 20, y: 20 } } };
      }
      if (params.expression.includes("[data-state='toast']")) {
        const elapsed = Date.now() - triggeredAt;
        return { result: { value: elapsed >= 300 && elapsed < 650 } };
      }
      return { result: { value: true } };
    }
  };

  const result = await runTask(client, payload, task);

  assert.equal(result.status, "pass");
});

test("final assertion errors after a user trigger remain assertion failures", async () => {
  const task = {
    clauseIds: ["AC1"],
    route: "/request",
    session: "none",
    actions: [{ type: "click", selector: "button[data-save]" }],
    intermediateAssertions: [],
    finalAssertions: [{ type: "unsupported", selector: "main" }]
  };
  const client = {
    async send(method, params = {}) {
      if (
        method === "Runtime.evaluate" &&
        params.expression.includes("getBoundingClientRect")
      ) {
        return { result: { value: { x: 20, y: 20 } } };
      }
      return {};
    }
  };

  const result = await runTask(client, payload, task);

  assert.equal(result.status, "fail");
  assert.match(result.evidence, /Browser assertion failed/);
  assert.doesNotMatch(result.evidence, /Browser interaction failed/);
  assert.deepEqual(result.assertions, [
    {
      phase: "final",
      assertion: "main is unsupported",
      passed: false
    }
  ]);
});
