#!/usr/bin/env node

import { randomUUID } from "node:crypto";
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
const EVENT_TRACE_KEY = `__agentProofEventTraceV1_${randomUUID()}`;
const EVENT_TRACE_BINDING = `__agentProofEventBindingV1_${randomUUID().replaceAll("-", "")}`;
const EVENT_TRACE_WORLD = `agent-proof-events-${randomUUID()}`;
const EVENT_TYPES = new Set([
  "beforeinput",
  "input",
  "change",
  "keydown",
  "keyup",
  "pointerdown",
  "pointerup",
  "click",
  "submit"
]);
const EVENT_KEYS = new Set([
  "",
  "printable",
  "Backspace",
  "Tab",
  "Enter",
  "Escape",
  "PageUp",
  "PageDown",
  "End",
  "Home",
  "ArrowLeft",
  "ArrowUp",
  "ArrowRight",
  "ArrowDown",
  "Insert",
  "Delete"
]);
const EVENT_INPUT_TYPES = new Set([
  "",
  "insertText",
  "insertLineBreak",
  "insertParagraph",
  "deleteContentBackward",
  "deleteContentForward"
]);
const browserEventCollectors = new WeakMap();
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

class BrowserAssertionError extends Error {
  constructor(error) {
    super(error?.message ?? String(error), { cause: error });
    this.name = "BrowserAssertionError";
  }
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
  const listeners = new Map();
  let sequence = 0;
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (!message.id) {
      for (const listener of listeners.get(message.method) ?? []) {
        try {
          listener(message.params ?? {});
        } catch {
          // Diagnostic events must not interrupt the command channel.
        }
      }
      return;
    }
    if (!pending.has(message.id)) return;
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
    on(method, listener) {
      const methodListeners = listeners.get(method) ?? new Set();
      methodListeners.add(listener);
      listeners.set(method, methodListeners);
      return () => {
        methodListeners.delete(listener);
        if (!methodListeners.size) listeners.delete(method);
      };
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

function sanitizedBrowserEvent(value) {
  if (
    !value ||
    typeof value !== "object" ||
    value.trusted !== true ||
    !EVENT_TYPES.has(value.type)
  ) {
    return undefined;
  }
  const safeTag = (tag) =>
    typeof tag === "string" && /^[a-z][a-z0-9-]{0,31}$/.test(tag)
      ? tag
      : "";
  return {
    type: value.type,
    trusted: true,
    prevented: value.prevented === true,
    key: EVENT_KEYS.has(value.key) ? value.key : "",
    inputType: EVENT_INPUT_TYPES.has(value.inputType) ? value.inputType : "",
    targetTag: safeTag(value.targetTag),
    activeTag: safeTag(value.activeTag)
  };
}

function browserEventTraceInstallerSource() {
  return (
    `(() => { ` +
    `const key = ${JSON.stringify(EVENT_TRACE_KEY)}; ` +
    `const publish = globalThis[${JSON.stringify(EVENT_TRACE_BINDING)}]; ` +
    `if (globalThis[key]) return true; ` +
    `const events = []; ` +
    `const api = Object.freeze({ ` +
    `reset: () => { events.length = 0; return true; }, ` +
    `read: () => events.slice(-64).map(event => ({ ...event })) ` +
    `}); ` +
    `Object.defineProperty(globalThis, key, { value: api }); ` +
    `const namedKeys = new Set(${JSON.stringify([
      "Backspace",
      "Tab",
      "Enter",
      "Escape",
      "PageUp",
      "PageDown",
      "End",
      "Home",
      "ArrowLeft",
      "ArrowUp",
      "ArrowRight",
      "ArrowDown",
      "Insert",
      "Delete"
    ])}); ` +
    `const inputTypes = new Set(["insertText", "insertLineBreak", "insertParagraph", ` +
    `"deleteContentBackward", "deleteContentForward"]); ` +
    `for (const type of ["beforeinput", "input", "change", "keydown", "keyup", "pointerdown", "pointerup", "click", "submit"]) { ` +
    `document.addEventListener(type, event => { ` +
    `if (!event.isTrusted) return; ` +
    `queueMicrotask(() => { ` +
    `const eventKey = typeof event.key === "string" ` +
    `? (namedKeys.has(event.key) ? event.key : event.key.length === 1 ? "printable" : "") : ""; ` +
    `const inputType = inputTypes.has(event.inputType) ? event.inputType : ""; ` +
    `events.push({ ` +
    `type: event.type, trusted: event.isTrusted, prevented: event.defaultPrevented, ` +
    `key: eventKey, inputType, ` +
    `targetTag: String(event.target?.tagName ?? "").toLowerCase(), ` +
    `activeTag: String(document.activeElement?.tagName ?? "").toLowerCase()` +
    `}); ` +
    `if (typeof publish === "function") publish(JSON.stringify(events.at(-1))); ` +
    `if (events.length > 64) events.shift(); ` +
    `}); ` +
    `}, true); ` +
    `} ` +
    `return true; ` +
    `})()`
  );
}

export async function installBrowserEventCollector(client) {
  if (typeof client.on !== "function") return undefined;
  const events = [];
  const removeListener = client.on("Runtime.bindingCalled", (params) => {
    if (
      params.name !== EVENT_TRACE_BINDING ||
      typeof params.payload !== "string" ||
      params.payload.length > 512
    ) {
      return;
    }
    let parsed;
    try {
      parsed = JSON.parse(params.payload);
    } catch {
      return;
    }
    const event = sanitizedBrowserEvent(parsed);
    if (!event) return;
    events.push(event);
    if (events.length > 64) events.shift();
  });
  let scriptIdentifier;
  try {
    await client.send("Runtime.addBinding", {
      name: EVENT_TRACE_BINDING,
      executionContextName: EVENT_TRACE_WORLD
    });
    const script = await client.send("Page.addScriptToEvaluateOnNewDocument", {
      source: browserEventTraceInstallerSource(),
      worldName: EVENT_TRACE_WORLD,
      runImmediately: true
    });
    scriptIdentifier = script.identifier;
  } catch (error) {
    removeListener();
    throw error;
  }
  const collector = {
    reset() {
      events.length = 0;
    },
    read() {
      return events.map((event) => ({ ...event }));
    },
    async dispose() {
      removeListener();
      const cleanup = [
        client.send("Runtime.removeBinding", { name: EVENT_TRACE_BINDING })
      ];
      if (scriptIdentifier) {
        cleanup.push(
          client.send("Page.removeScriptToEvaluateOnNewDocument", {
            identifier: scriptIdentifier
          })
        );
      }
      await Promise.allSettled(cleanup);
    }
  };
  browserEventCollectors.set(client, collector);
  return collector;
}

async function ensureBrowserEventTrace(client) {
  if (browserEventCollectors.has(client)) return true;
  return await evaluate(client, browserEventTraceInstallerSource());
}

async function resetBrowserEventTrace(client) {
  const collector = browserEventCollectors.get(client);
  if (collector) {
    collector.reset();
    return;
  }
  await evaluate(
    client,
    `globalThis[${JSON.stringify(EVENT_TRACE_KEY)}]?.reset?.() ?? false`,
    true
  );
}

async function browserEventTrace(client) {
  const collected = browserEventCollectors.get(client)?.read();
  if (collected) return collected;
  const events = await evaluate(
    client,
    `globalThis[${JSON.stringify(EVENT_TRACE_KEY)}]?.read?.() ?? []`,
    true
  );
  return Array.isArray(events)
    ? events
        .slice(-64)
        .map(sanitizedBrowserEvent)
        .filter(Boolean)
    : [];
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
  const navigationSettled =
    `location.pathname === ${JSON.stringify(path)} && ` +
    `document.readyState === "complete" && ` +
    `globalThis[${JSON.stringify(NAVIGATION_MARKER)}] !== ${JSON.stringify(marker)}`;
  const settled = await waitForEvaluation(
    client,
    navigationSettled,
    8_000,
    true
  );
  if (!settled) fail(`browser navigation did not settle: ${path}`);
  const painted = await waitForEvaluation(
    client,
    `(async () => { ` +
      `return await Promise.race([` +
      `new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)))), ` +
      `new Promise(resolve => setTimeout(() => resolve(false), 1000))` +
      `]) && (${navigationSettled}); ` +
      `})()`,
    8_000,
    true
  );
  if (!painted) fail(`browser navigation did not become interactive: ${path}`);
}

function keyEventMetadata(key) {
  const namedKeys = {
    Backspace: { code: "Backspace", virtualKeyCode: 8 },
    Tab: { code: "Tab", virtualKeyCode: 9 },
    Enter: { code: "Enter", virtualKeyCode: 13, text: "\r" },
    Escape: { code: "Escape", virtualKeyCode: 27 },
    " ": { code: "Space", virtualKeyCode: 32, text: " " },
    PageUp: { code: "PageUp", virtualKeyCode: 33 },
    PageDown: { code: "PageDown", virtualKeyCode: 34 },
    End: { code: "End", virtualKeyCode: 35 },
    Home: { code: "Home", virtualKeyCode: 36 },
    ArrowLeft: { code: "ArrowLeft", virtualKeyCode: 37 },
    ArrowUp: { code: "ArrowUp", virtualKeyCode: 38 },
    ArrowRight: { code: "ArrowRight", virtualKeyCode: 39 },
    ArrowDown: { code: "ArrowDown", virtualKeyCode: 40 },
    Insert: { code: "Insert", virtualKeyCode: 45 },
    Delete: { code: "Delete", virtualKeyCode: 46 }
  };
  const named = namedKeys[key];
  if (named) {
    return {
      key,
      code: named.code,
      windowsVirtualKeyCode: named.virtualKeyCode,
      location: 0,
      ...(named.text ? { text: named.text } : {})
    };
  }
  const characters = [...key];
  if (characters.length === 1 && /^[A-Za-z0-9]$/.test(key)) {
    const upper = key.toUpperCase();
    return {
      key,
      code: /^[A-Za-z]$/.test(key) ? `Key${upper}` : `Digit${key}`,
      windowsVirtualKeyCode: upper.charCodeAt(0),
      location: 0,
      text: key
    };
  }
  fail(`unsupported browser key: ${JSON.stringify(key)}`);
}

async function dispatchKey(client, key, onKeyDown) {
  const { text, ...metadata } = keyEventMetadata(key);
  const characterText = /^[A-Za-z0-9]$/.test(key) ? text : undefined;
  const keyDown = client.send("Input.dispatchKeyEvent", {
    type: characterText ? "keyDown" : "rawKeyDown",
    modifiers: 0,
    ...metadata,
    ...(characterText
      ? { text: characterText, unmodifiedText: characterText }
      : {}),
    autoRepeat: false,
    isKeypad: metadata.location === 3,
    commands: []
  });
  onKeyDown?.();
  await keyDown;
  await client.send("Input.dispatchKeyEvent", {
    type: "keyUp",
    modifiers: 0,
    ...metadata
  });
}

async function selectAllText(client) {
  const { text: _text, ...metadata } = keyEventMetadata("a");
  await client.send("Input.dispatchKeyEvent", {
    type: "rawKeyDown",
    modifiers: 2,
    ...metadata,
    autoRepeat: false,
    isKeypad: false,
    commands: ["selectAll"]
  });
  await client.send("Input.dispatchKeyEvent", {
    type: "keyUp",
    modifiers: 0,
    ...metadata
  });
}

async function dispatchClick(client, targetExpression, onMouseDown) {
  const deadline = Date.now() + 5_000;
  let point;
  do {
    point = await evaluate(
      client,
      `(element => { ` +
        `if (!element || element.disabled || !element.getClientRects().length) return null; ` +
        `element.scrollIntoView({ block: "center", inline: "center" }); ` +
        `const rect = element.getBoundingClientRect(); ` +
        `const x = rect.left + rect.width / 2; ` +
        `const y = rect.top + rect.height / 2; ` +
        `const hit = document.elementFromPoint(x, y); ` +
        `return hit && (hit === element || element.contains(hit)) ? { x, y } : null; ` +
        `})(${targetExpression})`,
      true
    );
    if (
      point &&
      Number.isFinite(point.x) &&
      Number.isFinite(point.y)
    ) {
      break;
    }
    point = undefined;
    await sleep(50);
  } while (Date.now() < deadline);
  if (!point) return false;
  await client.send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: point.x,
    y: point.y,
    button: "none",
    buttons: 0,
    modifiers: 0
  });
  const mouseDown = client.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: point.x,
    y: point.y,
    button: "left",
    buttons: 1,
    clickCount: 1,
    modifiers: 0
  });
  onMouseDown?.();
  await mouseDown;
  await client.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: point.x,
    y: point.y,
    button: "left",
    buttons: 0,
    clickCount: 1,
    modifiers: 0
  });
  return true;
}

async function waitForStableInputValue(
  client,
  selector,
  value,
  timeoutMs = 1_000,
  stableMs = 250
) {
  const deadline = Date.now() + timeoutMs;
  let matchingSince;
  do {
    const matches = await evaluate(
      client,
      `(element => Boolean(element && element.value === ${JSON.stringify(value)}))` +
        `(document.querySelector(${JSON.stringify(selector)}))`,
      true
    );
    if (!matches) matchingSince = undefined;
    else {
      matchingSince ??= Date.now();
      if (Date.now() - matchingSince >= stableMs) return true;
    }
    await sleep(50);
  } while (Date.now() < deadline);
  return false;
}

export async function runAction(client, baseUrl, action, onTriggered) {
  if (action.type === "navigate") {
    await navigate(client, baseUrl, action.path);
    return `Navigate to ${action.path}`;
  }
  if (action.type === "wait") {
    await sleep(action.milliseconds);
    return `Wait ${action.milliseconds}ms`;
  }
  if (action.type === "press") {
    await dispatchKey(client, action.key, onTriggered);
    return `Press ${action.key}`;
  }
  const selector = JSON.stringify(action.selector);
  if (action.type === "click") {
    const clicked = await dispatchClick(
      client,
      `document.querySelector(${selector})`,
      onTriggered
    );
    if (!clicked) fail(`browser action target was not found: ${action.selector}`);
    return `Click ${action.selector}`;
  }
  if (action.type === "clickText") {
    const clicked = await dispatchClick(
      client,
      `(elements => { ` +
        `const value = ${JSON.stringify(action.value)}; ` +
        `return Array.from(elements).find(candidate => ` +
        `!candidate.disabled && candidate.getClientRects().length && ` +
        `String(candidate.textContent ?? "").includes(value)) ?? null; ` +
        `})(document.querySelectorAll(${selector}))`,
      onTriggered
    );
    if (!clicked) {
      fail(`browser action text was not found: ${action.selector} ${JSON.stringify(action.value)}`);
    }
    return `Click ${action.selector} containing ${JSON.stringify(action.value)}`;
  }
  if (action.type === "fill") {
    const fillable = await waitForEvaluation(
      client,
      `(element => Boolean(element && !element.disabled && ` +
        `element.matches("input,textarea,select")))` +
        `(document.querySelector(${selector}))`
    );
    if (!fillable) fail(`browser fill target was not found: ${action.selector}`);
    const inputKind = await evaluate(
      client,
      `(element => { ` +
        `element.focus(); ` +
        `if (document.activeElement !== element) return "unfocused"; ` +
        `if (element.matches("select")) { ` +
        `const matched = Array.from(element.options).some(option => option.value === ${JSON.stringify(action.value)}); ` +
        `if (!matched) return "missing-option"; ` +
        `for (const option of element.options) option.selected = option.value === ${JSON.stringify(action.value)}; ` +
        `element.dispatchEvent(new Event("input", { bubbles: true })); ` +
        `element.dispatchEvent(new Event("change", { bubbles: true })); ` +
        `return "select"; ` +
        `} ` +
        `const typeable = element.matches(` +
        `"textarea,input:not([type]),input[type=text],input[type=email],input[type=number],` +
        `input[type=password],input[type=search],input[type=tel],input[type=url]"); ` +
        `if (!typeable) return "unsupported"; ` +
        `return "text"; ` +
        `})(document.querySelector(${selector}))`
    );
    if (inputKind === "unsupported") {
      fail(`browser fill target is unsupported: ${action.selector}`);
    }
    if (inputKind === "missing-option") {
      fail(`browser fill option was not found: ${action.selector}`);
    }
    if (inputKind === "unfocused") {
      fail(`browser fill target could not be focused: ${action.selector}`);
    }
    let triggeredObservation;
    if (inputKind === "text") {
      await selectAllText(client);
      if (action.value === "") {
        await dispatchKey(client, "Backspace", () => {
          triggeredObservation = onTriggered?.();
        });
      } else {
        const insertion = client.send("Input.insertText", {
          text: action.value
        });
        triggeredObservation = onTriggered?.();
        await insertion;
      }
    } else {
      triggeredObservation = onTriggered?.();
    }
    if (
      ["select", "text"].includes(inputKind) &&
      !(await waitForStableInputValue(client, action.selector, action.value))
    ) {
      await triggeredObservation;
      fail(`browser fill did not persist: ${action.selector}`);
    }
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
  await ensureBrowserEventTrace(client);
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
  await resetBrowserEventTrace(client);
  const reproductionSteps = [];
  const intermediate = task.intermediateAssertions.map((assertion) => ({
    assertion: assertionLabel(assertion),
    passed: false
  }));
  const final = task.finalAssertions.map((assertion) => ({
    assertion: assertionLabel(assertion),
    passed: false
  }));
  const actions = task.actions.length
    ? task.actions
    : [{ type: "navigate", path: task.route }];
  const lastTriggerActionIndex = actions.findLastIndex((action) =>
    ["fill", "click", "clickText", "press"].includes(action.type)
  );
  try {
    const sessionStep = await establishDemoSession(
      client,
      task.session ?? "none",
      payload.baseUrl,
      task.route
    );
    if (sessionStep) {
      reproductionSteps.push(sessionStep);
      await resetBrowserEventTrace(client);
    }
    for (const [actionIndex, action] of actions.entries()) {
      const isTrigger = ["fill", "click", "clickText", "press"].includes(
        action.type
      );
      if (isTrigger) await ensureBrowserEventTrace(client);
      const pendingIntermediateIndexes = isTrigger
        ? intermediate
            .map((result, index) => (result.passed ? -1 : index))
            .filter((index) => index !== -1)
        : [];
      const pendingFinalIndexes =
        actionIndex === lastTriggerActionIndex
          ? final
              .map((result, index) => (result.passed ? -1 : index))
              .filter((index) => index !== -1)
          : [];
      const pending = [
        ...pendingIntermediateIndexes.map((index) => ({
          phase: "intermediate",
          index,
          assertion: task.intermediateAssertions[index]
        })),
        ...pendingFinalIndexes.map((index) => ({
          phase: "final",
          index,
          assertion: task.finalAssertions[index]
        }))
      ];
      let observationPromise;
      const observeTriggeredState = pending.length
        ? () => {
            if (observationPromise) return observationPromise;
            observationPromise = waitForAssertions(
              client,
              pending.map((entry) => entry.assertion),
              intermediateAssertionTimeout(
                lastTriggerActionIndex + 1,
                actionIndex
              )
            ).then(
              (observed) => ({ observed }),
              (error) => ({ error })
            );
            return observationPromise;
          }
        : undefined;
      reproductionSteps.push(
        await runAction(
          client,
          payload.baseUrl,
          action,
          observeTriggeredState
        )
      );
      if (observeTriggeredState) {
        observeTriggeredState();
        const observation = await observationPromise;
        if (observation.error) {
          throw new BrowserAssertionError(observation.error);
        }
        for (const [observedIndex, result] of observation.observed.entries()) {
          const entry = pending[observedIndex];
          const target =
            entry.phase === "intermediate" ? intermediate : final;
          target[entry.index] = {
            ...target[entry.index],
            passed: result.passed
          };
        }
      }
    }
  } catch (error) {
    const assertionFailure = error instanceof BrowserAssertionError;
    return {
      clauseIds: task.clauseIds,
      route: task.route,
      status: "fail",
      evidence: `Browser ${assertionFailure ? "assertion" : "interaction"} failed: ${error?.message ?? String(error)}`,
      reproductionSteps,
      browserEvents: await browserEventTrace(client),
      assertions: [
        ...intermediate.map((result) => ({
          phase: "intermediate",
          ...result
        })),
        ...(assertionFailure
          ? final.map((result) => ({
              phase: "final",
              ...result
            }))
          : [])
      ]
    };
  }
  try {
    const pendingFinalIndexes = final
      .map((result, index) => (result.passed ? -1 : index))
      .filter((index) => index !== -1);
    if (pendingFinalIndexes.length) {
      const observed = await waitForAssertions(
        client,
        pendingFinalIndexes.map((index) => task.finalAssertions[index]),
        8_000
      );
      for (const [observedIndex, result] of observed.entries()) {
        const finalIndex = pendingFinalIndexes[observedIndex];
        final[finalIndex] = {
          ...final[finalIndex],
          passed: result.passed
        };
      }
    }
  } catch (error) {
    return {
      clauseIds: task.clauseIds,
      route: task.route,
      status: "fail",
      evidence: `Browser assertion failed: ${error?.message ?? String(error)}`,
      reproductionSteps,
      browserEvents: await browserEventTrace(client),
      assertions: [
        ...intermediate.map((result) => ({
          phase: "intermediate",
          ...result
        })),
        ...final.map((result) => ({
          phase: "final",
          ...result
        }))
      ]
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
    browserEvents: await browserEventTrace(client),
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
    await installBrowserEventCollector(client);
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
    await browserEventCollectors.get(client)?.dispose();
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
