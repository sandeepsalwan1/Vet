#!/usr/bin/env node

import { fileURLToPath } from "node:url";

export const BROWSER_BEHAVIOR_MARKER = "AGENT_BROWSER_BEHAVIOR_V1 ";
export const DEMO_SESSION_CREDENTIALS = Object.freeze({
  "demo-admin": Object.freeze({
    email: "admin@clinic.demo",
    password: "admin1234"
  }),
  "demo-staff": Object.freeze({
    email: "staff@clinic.demo",
    password: "staff1234"
  }),
  "demo-veterinarian": Object.freeze({
    email: "vet@clinic.demo",
    password: "vet1234"
  }),
  "demo-customer": Object.freeze({
    email: "maya@example.com",
    password: "demo1234"
  })
});
const NAVIGATION_MARKER = "__agentProofNavigationMarkerV1";
let navigationSequence = 0;

function parseArgs(argv = process.argv.slice(2)) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith("--")) continue;
    result[key.slice(2)] = argv[index + 1];
    index += 1;
  }
  return result;
}

function fail(message) {
  throw new Error(message);
}

export function validateBrowserPayload(payload) {
  if (
    !payload ||
    Array.isArray(payload) ||
    typeof payload.baseUrl !== "string" ||
    !/^http:\/\/127\.0\.0\.1:[0-9]+$/.test(payload.baseUrl) ||
    typeof payload.route !== "string" ||
    !/^\/[A-Za-z0-9/_-]*$/.test(payload.route) ||
    !Array.isArray(payload.tasks) ||
    payload.tasks.length === 0 ||
    payload.tasks.some(
      (task) =>
        task?.route !== payload.route ||
        !Array.isArray(task.clauseIds) ||
        !Array.isArray(task.actions) ||
        !Array.isArray(task.intermediateAssertions) ||
        !Array.isArray(task.finalAssertions) ||
        (
          task.session !== undefined &&
          task.session !== "none" &&
          !Object.hasOwn(DEMO_SESSION_CREDENTIALS, task.session)
        ) ||
        task.finalAssertions.length === 0
    )
  ) {
    fail("browser behavior payload is invalid");
  }
  return payload;
}

function decodePayload(value) {
  if (!value) fail("missing browser behavior payload");
  let payload;
  try {
    payload = JSON.parse(Buffer.from(value, "base64").toString("utf8"));
  } catch (error) {
    fail(`browser behavior payload is invalid: ${error.message}`);
  }
  return validateBrowserPayload(payload);
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function devtoolsTarget(port = 9222) {
  let lastError = "";
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await response.json();
      const page = targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl);
      if (page) return page;
    } catch (error) {
      lastError = error.message;
    }
    await sleep(100);
  }
  fail(`browser DevTools endpoint is unavailable${lastError ? `: ${lastError}` : ""}`);
}

async function cdpClient(webSocketDebuggerUrl) {
  if (typeof WebSocket !== "function") fail("Node WebSocket support is unavailable");
  const socket = new WebSocket(webSocketDebuggerUrl);
  const pending = new Map();
  let sequence = 0;
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result ?? {});
  });
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", () => reject(new Error("browser DevTools connection failed")), {
      once: true
    });
  });
  return {
    async send(method, params = {}) {
      const id = ++sequence;
      const result = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
      socket.send(JSON.stringify({ id, method, params }));
      return result;
    },
    close() {
      socket.close();
    }
  };
}

function selectorExpression(selector) {
  return `document.querySelector(${JSON.stringify(selector)})`;
}

function isHeadingSelector(selector) {
  return /^h[1-6]$/i.test(String(selector ?? "").trim());
}

export function assertionExpression(assertion) {
  if (assertion.type === "url") {
    return `location.pathname === ${JSON.stringify(assertion.path)}`;
  }
  const element = selectorExpression(assertion.selector);
  const visible =
    `(element => Boolean(element && element.getClientRects().length && ` +
    `getComputedStyle(element).visibility !== "hidden" && getComputedStyle(element).display !== "none"))`;
  if (assertion.type === "visible") return `${visible}(${element})`;
  if (assertion.type === "hidden") return `!${visible}(${element})`;
  if (assertion.type === "text") {
    const text =
      `(element => String(element.matches("input,textarea,select") ? ` +
      `element.value ?? "" : element.textContent ?? ""))`;
    const textMatches =
      assertion.value === ""
        ? `${text}(element) === ""`
        : `${text}(element).includes(${JSON.stringify(assertion.value)})`;
    const matches =
      `(element => Boolean(element && ${visible}(element) && ` +
      `${textMatches}))`;
    if (isHeadingSelector(assertion.selector)) {
      return (
        `(${matches}(${element}) || ` +
        `Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6")).some(` +
        `(element) => ${matches}(element)))`
      );
    }
    return `${matches}(${element})`;
  }
  if (assertion.type === "attribute") {
    return `(element => Boolean(element && element.getAttribute(${JSON.stringify(assertion.name)}) === ${JSON.stringify(assertion.value)}))(${element})`;
  }
  fail(`unsupported browser assertion: ${assertion.type}`);
}

export function assertionLabel(assertion) {
  if (assertion.type === "url") return `URL is ${assertion.path}`;
  if (assertion.type === "text") {
    return isHeadingSelector(assertion.selector)
      ? `visible heading contains ${JSON.stringify(assertion.value)}`
      : `${assertion.selector} contains expected text`;
  }
  if (assertion.type === "attribute") {
    return `${assertion.selector} has expected ${assertion.name} attribute`;
  }
  return `${assertion.selector} is ${assertion.type}`;
}

async function evaluate(client, expression, tolerateExceptions = false) {
  let result;
  try {
    result = await client.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
  } catch (error) {
    if (tolerateExceptions) return false;
    throw error;
  }
  if (result.exceptionDetails) {
    if (tolerateExceptions) return false;
    fail("browser assertion evaluation failed");
  }
  return result.result?.value;
}

async function waitForEvaluation(
  client,
  expression,
  timeoutMs = 5_000,
  tolerateExceptions = false
) {
  const deadline = Date.now() + timeoutMs;
  do {
    if (await evaluate(client, expression, tolerateExceptions)) return true;
    await sleep(50);
  } while (Date.now() < deadline);
  return false;
}

async function assertionResults(client, assertions, tolerateExceptions = false) {
  const values = [];
  for (const assertion of assertions) {
    values.push({
      assertion: assertionLabel(assertion),
      passed: Boolean(
        await evaluate(client, assertionExpression(assertion), tolerateExceptions)
      )
    });
  }
  return values;
}

async function waitForAssertions(client, assertions, timeoutMs) {
  const observed = assertions.map(() => false);
  const deadline = Date.now() + timeoutMs;
  do {
    const results = await assertionResults(client, assertions, true);
    for (const [index, result] of results.entries()) {
      if (result.passed) observed[index] = true;
    }
    if (observed.every(Boolean)) break;
    await sleep(50);
  } while (Date.now() < deadline);
  return assertions.map((assertion, index) => ({
    assertion: assertionLabel(assertion),
    passed: observed[index]
  }));
}

async function navigate(client, baseUrl, path) {
  const marker = `${Date.now()}:${++navigationSequence}`;
  const marked = await waitForEvaluation(
    client,
    `globalThis[${JSON.stringify(NAVIGATION_MARKER)}] = ${JSON.stringify(marker)}; true`,
    8_000,
    true
  );
  if (!marked) fail("browser navigation could not bind the current document");
  const result = await client.send("Page.navigate", { url: `${baseUrl}${path}` });
  if (result.errorText) fail(`browser navigation failed: ${result.errorText}`);
  const settled = await waitForEvaluation(
    client,
    `location.pathname === ${JSON.stringify(path)} && ` +
      `document.readyState !== "loading" && ` +
      `globalThis[${JSON.stringify(NAVIGATION_MARKER)}] !== ${JSON.stringify(marker)}`,
    8_000,
    true
  );
  if (!settled) fail(`browser navigation did not settle: ${path}`);
}

export async function runAction(client, baseUrl, action) {
  if (action.type === "navigate") {
    await navigate(client, baseUrl, action.path);
    return `Navigate to ${action.path}`;
  }
  if (action.type === "wait") {
    await sleep(action.milliseconds);
    return `Wait ${action.milliseconds}ms`;
  }
  if (action.type === "press") {
    await client.send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: action.key
    });
    await client.send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: action.key
    });
    return `Press ${action.key}`;
  }
  const selector = JSON.stringify(action.selector);
  if (action.type === "click") {
    const clicked = await waitForEvaluation(
      client,
      `(element => { ` +
        `if (!element || element.disabled || !element.getClientRects().length) return false; ` +
        `element.click(); return true; ` +
        `})(document.querySelector(${selector}))`
    );
    if (!clicked) fail(`browser action target was not found: ${action.selector}`);
    return `Click ${action.selector}`;
  }
  if (action.type === "clickText") {
    const clicked = await waitForEvaluation(
      client,
      `(elements => { ` +
        `const value = ${JSON.stringify(action.value)}; ` +
        `const element = Array.from(elements).find(candidate => ` +
        `!candidate.disabled && candidate.getClientRects().length && ` +
        `String(candidate.textContent ?? "").includes(value)); ` +
        `if (!element) return false; element.click(); return true; ` +
        `})(document.querySelectorAll(${selector}))`
    );
    if (!clicked) {
      fail(`browser action text was not found: ${action.selector} ${JSON.stringify(action.value)}`);
    }
    return `Click ${action.selector} containing ${JSON.stringify(action.value)}`;
  }
  if (action.type === "fill") {
    const filled = await waitForEvaluation(
      client,
      `(element => { if (!element) return false; ` +
        `element.focus(); ` +
        `const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value")?.set; ` +
        `if (setter) setter.call(element, ${JSON.stringify(action.value)}); else element.value = ${JSON.stringify(action.value)}; ` +
        `element.dispatchEvent(new Event("input", { bubbles: true })); ` +
        `element.dispatchEvent(new Event("change", { bubbles: true })); return true; ` +
        `})(document.querySelector(${selector}))`
    );
    if (!filled) fail(`browser fill target was not found: ${action.selector}`);
    return `Fill ${action.selector}`;
  }
  fail(`unsupported browser action: ${action.type}`);
}

export async function establishDemoSession(
  client,
  session,
  baseUrl,
  route
) {
  if (!session || session === "none") return "";
  const credentials = DEMO_SESSION_CREDENTIALS[session];
  if (!credentials) fail(`unsupported browser demo session: ${session}`);
  const expectedRole = session.replace(/^demo-/, "");
  const hasExpectedRole =
    `(value => { try { return JSON.parse(value ?? "null")?.role === ` +
    `${JSON.stringify(expectedRole)}; } catch { return false; } })` +
    `(localStorage.getItem("central-vet-session"))`;
  await evaluate(
    client,
    `localStorage.removeItem("central-vet-session"); true`
  );
  const loginRoute = session === "demo-customer" ? "/" : "/staff";
  await navigate(client, baseUrl, loginRoute);
  const emailVisible = await waitForEvaluation(
    client,
    `Boolean(document.querySelector("input[type='email']"))`,
    8_000
  );
  if (!emailVisible) fail(`browser demo sign-in form was not found for ${session}`);
  await runAction(client, "", {
    type: "fill",
    selector: "input[type='email']",
    value: credentials.email
  });
  await runAction(client, "", {
    type: "fill",
    selector: "input[type='password']",
    value: credentials.password
  });
  await runAction(client, "", {
    type: "click",
    selector: "form button[type='submit']"
  });
  const signedIn = await waitForEvaluation(
    client,
    hasExpectedRole,
    8_000
  );
  if (!signedIn) fail(`browser demo sign-in did not complete for ${session}`);
  if (route !== loginRoute) await navigate(client, baseUrl, route);
  return `Sign in with the visible ${session} account`;
}

export function intermediateAssertionTimeout(actionCount, actionIndex) {
  return actionIndex === actionCount - 1 ? 4_000 : 250;
}

export async function runTask(client, payload, task) {
  const reproductionSteps = [];
  const intermediate = task.intermediateAssertions.map((assertion) => ({
    assertion: assertionLabel(assertion),
    passed: false
  }));
  const actions = task.actions.length
    ? task.actions
    : [{ type: "navigate", path: task.route }];
  try {
    const sessionStep = await establishDemoSession(
      client,
      task.session ?? "none",
      payload.baseUrl,
      task.route
    );
    if (sessionStep) reproductionSteps.push(sessionStep);
    for (const [actionIndex, action] of actions.entries()) {
      reproductionSteps.push(await runAction(client, payload.baseUrl, action));
      if (
        task.intermediateAssertions.length &&
        ["fill", "click", "clickText", "press"].includes(action.type)
      ) {
        const pendingIndexes = intermediate
          .map((result, index) => (result.passed ? -1 : index))
          .filter((index) => index !== -1);
        if (!pendingIndexes.length) continue;
        const observed = await waitForAssertions(
          client,
          pendingIndexes.map(
            (index) => task.intermediateAssertions[index]
          ),
          intermediateAssertionTimeout(actions.length, actionIndex)
        );
        for (const [observedIndex, result] of observed.entries()) {
          const intermediateIndex = pendingIndexes[observedIndex];
          intermediate[intermediateIndex] = {
            ...intermediate[intermediateIndex],
            passed: result.passed
          };
        }
      }
    }
  } catch (error) {
    return {
      clauseIds: task.clauseIds,
      route: task.route,
      status: "fail",
      evidence: `Browser interaction failed: ${error?.message ?? String(error)}`,
      reproductionSteps,
      assertions: intermediate.map((result) => ({
        phase: "intermediate",
        ...result
      }))
    };
  }
  let final;
  try {
    final = await waitForAssertions(client, task.finalAssertions, 8_000);
  } catch (error) {
    return {
      clauseIds: task.clauseIds,
      route: task.route,
      status: "fail",
      evidence: `Browser assertion failed: ${error?.message ?? String(error)}`,
      reproductionSteps,
      assertions: intermediate.map((result) => ({
        phase: "intermediate",
        ...result
      }))
    };
  }
  const assertions = [
    ...intermediate.map((result) => ({ phase: "intermediate", ...result })),
    ...final.map((result) => ({ phase: "final", ...result }))
  ];
  const passed = assertions.length > 0 && assertions.every((result) => result.passed);
  return {
    clauseIds: task.clauseIds,
    route: task.route,
    status: passed ? "pass" : "fail",
    evidence: passed
      ? "All deterministic rendered-state assertions were observed."
      : `Missing observations: ${assertions.filter((result) => !result.passed).map((result) => result.assertion).join(", ")}.`,
    reproductionSteps,
    assertions
  };
}

export async function runBrowserBehavior(payload) {
  validateBrowserPayload(payload);
  const target = await devtoolsTarget();
  const client = await cdpClient(target.webSocketDebuggerUrl);
  try {
    await client.send("Page.enable");
    await client.send("Runtime.enable");
    const taskResults = [];
    for (const task of payload.tasks) {
      taskResults.push(await runTask(client, payload, task));
    }
    const routeObserved = await evaluate(
      client,
      `location.pathname === ${JSON.stringify(payload.route)}`
    );
    return {
      route: payload.route,
      status:
        taskResults.every((result) => result.status === "pass") && routeObserved
          ? "pass"
          : "fail",
      taskResults,
      antiCheatProbes: [
        {
          probe: "Rendered route binding",
          result: routeObserved
            ? `Browser ended on ${payload.route}.`
            : `Browser did not end on ${payload.route}.`
        },
        {
          probe: "Intermediate-state observation",
          result: taskResults.some((result) =>
            result.assertions.some(
              (assertion) => assertion.phase === "intermediate" && assertion.passed
            )
          )
            ? "At least one intermediate state was observed after a user trigger."
            : "No intermediate state was observed."
        }
      ]
    };
  } finally {
    client.close();
  }
}

async function main() {
  const args = parseArgs();
  const payload = decodePayload(args["payload-base64"]);
  const observation = await runBrowserBehavior(payload);
  const encoded = Buffer.from(JSON.stringify(observation), "utf8").toString("base64");
  process.stdout.write(`${BROWSER_BEHAVIOR_MARKER}${encoded}\n`);
  if (observation.status !== "pass") process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
