#!/usr/bin/env node

import { createHash } from "node:crypto";

import {
  AgentError,
  candidatePaths,
  extractJson,
  issueLabels,
  issueSnapshotSha256
} from "./agent-lib.mjs";

export const INTENT_CAPSULE_VERSION = 6;
export const IMPLEMENTATION_RESULT_VERSION = 1;
export const IMPLEMENTATION_ADDENDUM_MARKER =
  "<!-- agent-intent-addendum:v1 -->";
export const PROOF_KINDS = Object.freeze(["none", "CI", "UI", "GIF", "service"]);
export const PROOF_SESSIONS = Object.freeze([
  "none",
  "demo-admin",
  "demo-staff",
  "demo-veterinarian",
  "demo-customer"
]);
export const EVIDENCE_LANES = Object.freeze([
  "deterministic",
  "browser",
  "service"
]);
const TRANSIENT_INTENT_LABELS = new Set(["agent:implement", "agent:triage"]);
const BEHAVIOR_CONTRACT_VERSION = 2;
const STABLE_INTENT_LABEL_VERSION = 3;
const EVIDENCE_LANE_CONTRACT_VERSION = 4;
const REFINED_EVIDENCE_LANE_CONTRACT_VERSION = 5;
const PROOF_RESULT_TRANSIENT_LABEL_VERSION = 6;
export const BASE_TRIAGE_FIELDS = Object.freeze([
  "value",
  "priority",
  "risk",
  "alignment",
  "implementationScope",
  "proofNeeded",
  "automationDecision",
  "humanQuestion"
]);
export const MANAGED_TRIAGE_FIELDS = Object.freeze([
  ...BASE_TRIAGE_FIELDS,
  "intentDigest",
  "issueSnapshotSha256",
  "ownerClarifications"
]);

const MAX_ISSUE_BODY_BYTES = 48_000;
const MAX_SECTION_BYTES = 16_000;
const MAX_CLARIFICATION_BYTES = 8_000;
const MAX_TRANSCRIPT_SUMMARY_BYTES = 8_000;
const MAX_REQUIREMENTS = 50;
const MAX_REQUIREMENT_BYTES = 1_000;
const MAX_IMPLEMENTATION_ITEMS = 50;
const MAX_IMPLEMENTATION_ITEM_BYTES = 2_000;
const MAX_PROOF_TASKS = 20;
const MAX_PROOF_STEPS = 20;
const MAX_PROOF_VALUE_BYTES = 1_000;

function normalizedText(value) {
  return String(value ?? "").replace(/\r\n?/g, "\n").trim();
}

function boundedText(value, maxBytes, label) {
  const text = normalizedText(value);
  if (Buffer.byteLength(text, "utf8") > maxBytes) {
    throw new AgentError(`${label} exceeds its bounded intent limit`, 1);
  }
  return text;
}

function sha256(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

function safeProofRoute(value, label = "proof route") {
  const route = normalizedText(value);
  if (
    !route ||
    !/^\/[A-Za-z0-9/_-]*$/.test(route) ||
    route.includes("..") ||
    route.includes("//") ||
    route.startsWith("/api/")
  ) {
    throw new AgentError(`${label} is invalid`, 1);
  }
  return route.length > 1 ? route.replace(/\/+$/, "") : route;
}

export function normalizeExplicitRoute(route) {
  if (!route) return null;
  const value = String(route).trim();
  if (
    !/^\/[A-Za-z0-9/_-]*$/.test(value) ||
    value.includes("..") ||
    value.includes("//") ||
    value.startsWith("/api/")
  ) {
    throw new AgentError(`unsafe or non-UI proof route: ${value}`, 2);
  }
  return value.length > 1 ? value.replace(/\/+$/, "") : value;
}

function routeForPageFile(path) {
  const match = String(path).match(
    /^apps\/internal\/app\/(.*\/)?page\.[jt]sx?$/
  );
  if (!match) return null;
  const segments = String(match[1] ?? "")
    .split("/")
    .filter(Boolean)
    .filter((segment) => !/^\([^)]*\)$/.test(segment));
  if (
    segments.some(
      (segment) =>
        segment.startsWith("@") ||
        segment.startsWith("(") ||
        segment.includes("[") ||
        segment.includes("]")
    )
  ) {
    return null;
  }
  return segments.length ? `/${segments.join("/")}` : "/";
}

export function deriveAffectedRoutes(files, explicitRoute = "") {
  const requested = normalizeExplicitRoute(explicitRoute);
  if (requested) return [requested];
  const routes = [];
  for (const file of files ?? []) {
    if (file?.status === "removed") continue;
    for (const path of candidatePaths([file])) {
      if (!path) continue;
      const route = routeForPageFile(path);
      if (route) routes.push(route);
      if (
        /^apps\/internal\/app\/(?:layout\.[jt]sx?|globals\.css)$/.test(path)
      ) {
        routes.push("/");
      }
    }
  }
  return [...new Set(routes)].sort();
}

function safeProofActionPath(value) {
  const path = normalizedText(value);
  const localPath = path.match(/^\/\/(?:localhost|127\.0\.0\.1)(\/[A-Za-z0-9/_-]*)$/i)?.[1];
  return safeProofRoute(localPath ?? path, "implementation proof action path");
}

function boundedStringArray(value, label) {
  if (
    !Array.isArray(value) ||
    value.length > MAX_IMPLEMENTATION_ITEMS ||
    value.some((item) => typeof item !== "string" || !item.trim())
  ) {
    throw new AgentError(`${label} is invalid`, 1);
  }
  return value.map((item) =>
    boundedText(item, MAX_IMPLEMENTATION_ITEM_BYTES, label)
  );
}

function boundedProofValue(value, label, { allowEmpty = false } = {}) {
  if (typeof value !== "string" || (!allowEmpty && !value.trim())) {
    throw new AgentError(`${label} is invalid`, 1);
  }
  return boundedText(value, MAX_PROOF_VALUE_BYTES, label);
}

function boundedProofSelector(value) {
  const selector = boundedProofValue(value, "implementation proof selector");
  if (
    /:(?:has-text|text(?:-is|-matches)?|contains|visible|hidden)(?:\s*\(|\b)/i.test(
      selector
    ) ||
    /(?:^|[\s,>+~])(?:text|xpath|css|id|role|data-testid)\s*=/i.test(
      selector
    ) ||
    /^\s*(?:\.{0,2}|\()\s*\/\//.test(selector) ||
    /(?:^|\s)>>(?:\s|$)|\bgetBy[A-Z]/.test(selector)
  ) {
    throw new AgentError(
      "implementation proof selector must be CSS; use clickText for visible text",
      1
    );
  }
  return selector;
}

function validateProofAction(action) {
  const shapes = {
    navigate: ["path", "type"],
    click: ["selector", "type"],
    clickText: ["selector", "type", "value"],
    fill: ["selector", "type", "value"],
    press: ["key", "type"],
    wait: ["milliseconds", "type"]
  };
  const expected = shapes[action?.type];
  if (
    !action ||
    Array.isArray(action) ||
    !expected ||
    JSON.stringify(Object.keys(action).sort()) !== JSON.stringify(expected)
  ) {
    throw new AgentError("implementation proof action is invalid", 1);
  }
  if (action.type === "navigate") {
    return { type: action.type, path: safeProofActionPath(action.path) };
  }
  if (action.type === "wait") {
    if (!Number.isInteger(action.milliseconds) || action.milliseconds < 0 || action.milliseconds > 10_000) {
      throw new AgentError("implementation proof wait is invalid", 1);
    }
    return { type: action.type, milliseconds: action.milliseconds };
  }
  if (action.type === "press") {
    return { type: action.type, key: boundedProofValue(action.key, "implementation proof key") };
  }
  const normalized = {
    type: action.type,
    selector: boundedProofSelector(action.selector)
  };
  if (action.type === "fill" || action.type === "clickText") {
    normalized.value = boundedProofValue(action.value, "implementation proof value", {
      allowEmpty: action.type === "fill"
    });
  }
  return normalized;
}

function proofTaskSession(task) {
  if (!Object.hasOwn(task, "session")) return "none";
  if (!PROOF_SESSIONS.includes(task.session)) {
    throw new AgentError("implementation proof task session is invalid", 1);
  }
  return task.session;
}

function mutatesForm(action) {
  if (action.type === "fill") return true;
  if (!["click", "clickText"].includes(action.type)) return false;
  return /\b(?:input|textarea|select)\b|\[(?:role|type)\s*=\s*['"]?(?:switch|checkbox|radio|combobox|slider)/i.test(
    action.selector
  );
}

function validateProofTaskInteraction(task) {
  const session = task.session ?? "none";
  const interacts = task.actions.some(
    (action) => !["navigate", "wait"].includes(action.type)
  );
  if (
    /^\/staff(?:\/|$)/.test(task.route) &&
    interacts &&
    session === "none"
  ) {
    throw new AgentError(
      "protected staff browser proof must declare a demo staff session",
      1
    );
  }
  if (
    /^\/staff(?:\/|$)/.test(task.route) &&
    session === "demo-customer"
  ) {
    throw new AgentError(
      "staff browser proof cannot use a demo customer session",
      1
    );
  }
  for (const [index, action] of task.actions.entries()) {
    const saveLabel = `${action.selector ?? ""} ${action.value ?? ""}`;
    if (
      !["click", "clickText"].includes(action.type) ||
      !/\b(?:save|submit)\b/i.test(saveLabel)
    ) {
      continue;
    }
    if (!task.actions.slice(0, index).some(mutatesForm)) {
      throw new AgentError(
        "browser proof clicks save or submit without first changing a form control",
        1
      );
    }
  }
}

function validateProofAssertion(assertion) {
  const shapes = {
    visible: ["selector", "type"],
    hidden: ["selector", "type"],
    text: ["selector", "type", "value"],
    url: ["path", "type"],
    attribute: ["name", "selector", "type", "value"]
  };
  const expected = shapes[assertion?.type];
  if (
    !assertion ||
    Array.isArray(assertion) ||
    !expected ||
    JSON.stringify(Object.keys(assertion).sort()) !== JSON.stringify(expected)
  ) {
    throw new AgentError("implementation proof assertion is invalid", 1);
  }
  if (assertion.type === "url") return { type: assertion.type, path: safeProofRoute(assertion.path) };
  const normalized = {
    type: assertion.type,
    selector: boundedProofSelector(assertion.selector)
  };
  if (assertion.type === "text" || assertion.type === "attribute") {
    normalized.value = boundedProofValue(assertion.value, "implementation proof expected value", {
      allowEmpty: true
    });
  }
  if (assertion.type === "attribute") {
    normalized.name = boundedProofValue(assertion.name, "implementation proof attribute");
  }
  return normalized;
}

export function validateProofPlan(plan) {
  if (
    !plan ||
    Array.isArray(plan) ||
    JSON.stringify(Object.keys(plan).sort()) !== JSON.stringify(["tasks", "version"]) ||
    plan.version !== 1 ||
    !Array.isArray(plan.tasks) ||
    plan.tasks.length > MAX_PROOF_TASKS
  ) {
    throw new AgentError("implementation proof plan is invalid", 1);
  }
  return {
    version: 1,
    tasks: plan.tasks.map((task) => {
      const legacyKeys = [
        "actions",
        "clauseIds",
        "finalAssertions",
        "intermediateAssertions",
        "route"
      ];
      if (!task || Array.isArray(task)) {
        throw new AgentError("implementation proof task is invalid", 1);
      }
      const hasExplicitSession = Object.hasOwn(task, "session");
      const session = proofTaskSession(task);
      const keys = hasExplicitSession
        ? [...legacyKeys, "session"].sort()
        : legacyKeys;
      if (
        JSON.stringify(Object.keys(task).sort()) !== JSON.stringify(keys) ||
        !Array.isArray(task.clauseIds) ||
        task.clauseIds.length > MAX_REQUIREMENTS ||
        task.clauseIds.some((id) => !/^AC[1-9][0-9]*$/.test(id)) ||
        new Set(task.clauseIds).size !== task.clauseIds.length
      ) {
        throw new AgentError("implementation proof task is invalid", 1);
      }
      for (const field of ["actions", "intermediateAssertions", "finalAssertions"]) {
        if (!Array.isArray(task[field]) || task[field].length > MAX_PROOF_STEPS) {
          throw new AgentError(`implementation proof task ${field} is invalid`, 1);
        }
      }
      const normalized = {
        clauseIds: task.clauseIds,
        route: safeProofRoute(task.route),
        actions: task.actions.map(validateProofAction),
        intermediateAssertions: task.intermediateAssertions.map(validateProofAssertion),
        finalAssertions: task.finalAssertions.map(validateProofAssertion)
      };
      normalized.session = session;
      return normalized;
    })
  };
}

function contractCheckEvidenceLanes(check, contract) {
  if (
    Array.isArray(check?.evidenceLanes) &&
    check.evidenceLanes.length > 0
  ) {
    return check.evidenceLanes;
  }
  return ["UI", "GIF"].includes(contract?.target?.proofKind)
    ? ["browser"]
    : contract?.target?.proofKind === "service"
      ? ["service"]
      : ["deterministic"];
}

function contractCheckRoutes(check, contract) {
  const allowed = new Set(contract?.routes ?? []);
  const routes = [];
  const statement = normalizedText(check?.statement);
  const routePattern =
    /(?:^|[\s(`'"\[])(\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\/?)(?=$|[\s`'".,;:)\]])/g;
  for (const match of statement.matchAll(routePattern)) {
    const candidate =
      match[1].length > 1 ? match[1].replace(/\/+$/, "") : match[1];
    if (allowed.has(candidate)) routes.push(candidate);
  }
  if (
    allowed.has("/") &&
    /(?:`\/`|'\/'|"\/")/.test(statement)
  ) {
    routes.push("/");
  }
  return [...new Set(routes)];
}

export function browserProofRequirements({ proofKind, behaviorContract }) {
  if (!behaviorContract || behaviorContract.target?.kind !== "web") return [];
  return behaviorContract.checks
    .filter((check) =>
      (
        Array.isArray(check.evidenceLanes)
          ? contractCheckEvidenceLanes(check, behaviorContract)
          : ["UI", "GIF"].includes(proofKind)
            ? ["browser"]
            : contractCheckEvidenceLanes(check, behaviorContract)
      ).includes("browser")
    )
    .map((check) => ({
      clauseId: check.id,
      requiredRoutes: contractCheckRoutes(check, behaviorContract)
    }));
}

export function validateBrowserProofPlan({
  proofKind,
  routes,
  behaviorContract,
  proofPlan,
  evidenceLanes = null
}) {
  const validatedPlan = validateProofPlan(proofPlan);
  const visualRequired = Array.isArray(evidenceLanes)
    ? evidenceLanes.includes("browser")
    : ["UI", "GIF"].includes(proofKind);
  if (!visualRequired) return proofPlan;
  if (!behaviorContract || behaviorContract.target?.kind !== "web") {
    throw new AgentError("visual proof has no sealed web behavior contract", 1);
  }
  const requirements = browserProofRequirements({
    proofKind,
    behaviorContract
  });
  const expected = new Map(
    requirements.map((requirement) => [
      requirement.clauseId,
      requirement
    ])
  );
  const covered = new Set();
  const coveredRoutes = new Set();
  if (!validatedPlan.tasks.length) {
    const expectedSummary = requirements.length
      ? requirements
          .map(({ clauseId, requiredRoutes }) =>
            requiredRoutes.length
              ? `${clauseId}@${requiredRoutes.join("|")}`
              : clauseId
          )
          .join(", ")
      : "one route-bound artifact task";
    throw new AgentError(
      `visual proof has no implementation browser plan; expected browser clauses: ${expectedSummary}`,
      1
    );
  }
  for (const task of validatedPlan.tasks) {
    if (!routes.includes(task.route)) {
      throw new AgentError(
        `browser proof task route was not prepared: ${task.route}`,
        1
      );
    }
    if (!task.finalAssertions.length) {
      throw new AgentError("browser proof task has no final assertion", 1);
    }
    if (proofKind === "GIF" && !task.intermediateAssertions.length) {
      throw new AgentError("GIF proof task has no intermediate assertion", 1);
    }
    if (
      proofKind === "GIF" &&
      !task.actions.some((action) => !["navigate", "wait"].includes(action.type))
    ) {
      throw new AgentError("GIF proof task has no user trigger action", 1);
    }
    validateProofTaskInteraction(task);
    for (const clauseId of task.clauseIds) {
      if (!expected.has(clauseId)) {
        throw new AgentError(
          `browser proof task references unknown or non-browser clause ${clauseId}; allowed browser clauses: ${[...expected.keys()].join(", ") || "none"}`,
          1
        );
      }
      const clauseRoutes = expected.get(clauseId).requiredRoutes;
      if (clauseRoutes.length && !clauseRoutes.includes(task.route)) {
        throw new AgentError(
          `browser proof task for ${clauseId} uses ${task.route} instead of sealed route ${clauseRoutes.join(" or ")}`,
          1
        );
      }
      covered.add(clauseId);
      coveredRoutes.add(`${clauseId}\0${task.route}`);
    }
  }
  const missing = [...expected].filter(
    ([clauseId]) => !covered.has(clauseId)
  ).map(([clauseId]) => clauseId);
  const missingRoutes = requirements.flatMap((requirement) =>
    requirement.requiredRoutes
      .filter(
        (route) =>
          !coveredRoutes.has(`${requirement.clauseId}\0${route}`)
      )
      .map((route) => `${requirement.clauseId}@${route}`)
  );
  if (missing.length) {
    throw new AgentError(
      `browser proof plan does not cover sealed clauses: ${missing.join(", ")}`,
      1
    );
  }
  if (missingRoutes.length) {
    throw new AgentError(
      `browser proof plan does not cover sealed clause routes: ${missingRoutes.join(", ")}`,
      1
    );
  }
  if (
    proofKind === "GIF" &&
    behaviorContract.captureBeforeAction !== true
  ) {
    throw new AgentError(
      "GIF proof contract does not require capture before action",
      1
    );
  }
  return proofPlan;
}

function cleanSectionValue(value) {
  const text = normalizedText(value);
  return /^_?no response_?$/i.test(text) ? "" : text;
}

export function parseIssueSections(body) {
  const sections = {};
  let current = "";
  for (const line of normalizedText(body).split("\n")) {
    const heading = line.match(/^###\s+(.+?)\s*$/);
    if (heading) {
      current = heading[1].trim().toLowerCase();
      sections[current] ??= [];
      continue;
    }
    if (current) sections[current].push(line);
  }
  return Object.fromEntries(
    Object.entries(sections).map(([name, lines]) => [
      name,
      boundedText(cleanSectionValue(lines.join("\n")), MAX_SECTION_BYTES, `issue section ${name}`)
    ])
  );
}

function requirementLines(value) {
  const text = cleanSectionValue(value);
  if (!text) return [];
  const bullets = text
    .split("\n")
    .map((line) =>
      line
        .trim()
        .replace(/^[-*]\s+(?:\[[ xX]\]\s*)?/, "")
        .replace(/^\d+[.)]\s+/, "")
        .trim()
    )
    .filter(Boolean);
  const values = bullets.length > 1 ? bullets : [text];
  if (values.length > MAX_REQUIREMENTS) {
    throw new AgentError("acceptance criteria exceed the bounded intent limit", 1);
  }
  return values.map((requirement) =>
    boundedText(requirement, MAX_REQUIREMENT_BYTES, "acceptance criterion")
  );
}

function exclusionLines(value) {
  return cleanSectionValue(value)
    .split("\n")
    .map((line) => line.replace(/^[-*]\s+/, "").trim())
    .filter(
      (line) =>
        line &&
        /\b(?:do not|don't|must not|never|without|exclude|only|out of scope|no\s+\w+)/i.test(line)
    )
    .slice(0, MAX_REQUIREMENTS)
    .map((line) => boundedText(line, MAX_REQUIREMENT_BYTES, "explicit exclusion"));
}

function transcriptContext(sections) {
  const summary = boundedText(
    sections["conversation intent summary"],
    MAX_TRANSCRIPT_SUMMARY_BYTES,
    "conversation intent summary"
  );
  const sourceDigest = normalizedText(sections["conversation source digest"]).toLowerCase();
  if (!summary || !/^[a-f0-9]{64}$/.test(sourceDigest)) return null;
  return { summary, sourceDigest };
}

function normalizedClarifications(clarifications) {
  const values = (clarifications ?? []).map((clarification) => {
    const commentId = Number(clarification?.commentId ?? clarification?.id);
    const body = boundedText(
      clarification?.body,
      MAX_CLARIFICATION_BYTES,
      "owner clarification"
    );
    const bodySha256 = sha256(body);
    const expectedSha256 = clarification?.sha256 ?? clarification?.bodySha256 ?? bodySha256;
    if (
      !Number.isSafeInteger(commentId) ||
      commentId <= 0 ||
      !body ||
      expectedSha256 !== bodySha256
    ) {
      throw new AgentError("owner clarification is invalid", 1);
    }
    return { commentId, sha256: bodySha256, body };
  });
  values.sort((left, right) => left.commentId - right.commentId);
  if (new Set(values.map((value) => value.commentId)).size !== values.length) {
    throw new AgentError("owner clarifications contain duplicate comments", 1);
  }
  return values;
}

function decisionCapsuleFields(decision) {
  return {
    value: decision.value,
    priority: decision.priority,
    risk: decision.risk,
    alignment: decision.alignment,
    implementationScope: decision.implementationScope,
    proofNeeded: decision.proofNeeded,
    automationDecision: decision.automationDecision,
    humanQuestion: decision.humanQuestion
  };
}

function capsulePayload(capsule) {
  const { intentDigest: _intentDigest, ...payload } = capsule;
  return payload;
}

function stableIntentLabels(issue, version) {
  return [...new Set(issueLabels(issue))]
    .filter(
      (label) =>
        !TRANSIENT_INTENT_LABELS.has(label) &&
        !(
          version >= PROOF_RESULT_TRANSIENT_LABEL_VERSION &&
          label === "agent:proof-failed"
        )
    )
    .sort();
}

function legacyIntentIssues(issue, decision) {
  const currentLabels = [...new Set(issueLabels(issue))].sort();
  const labelSets = [];
  const addProofResultVariants = (labels) => {
    const normalized = [...new Set(labels)].sort();
    labelSets.push(
      normalized,
      normalized.filter((label) => label !== "agent:proof-failed"),
      [...new Set([...normalized, "agent:proof-failed"])].sort()
    );
  };
  addProofResultVariants(currentLabels);
  if (decision.automationDecision === "implement") {
    const activeLabels = new Set(currentLabels);
    activeLabels.add("agent:implement");
    activeLabels.delete("agent:blocked");
    addProofResultVariants([...activeLabels]);
  }
  return labelSets
    .filter(
      (labels, index, values) =>
        values.findIndex((other) => JSON.stringify(other) === JSON.stringify(labels)) === index
    )
    .map((labels) => ({ ...issue, labels }));
}

function proofRoutes(sections) {
  const value = cleanSectionValue(sections["proof route"]);
  if (!value) return [];
  return [...new Set(value.split(/\s+/).filter(Boolean).map((route) => safeProofRoute(route)))].sort();
}

export function clauseEvidenceLanes(
  statement,
  proofKind,
  contractVersion = 3
) {
  const text = normalizedText(statement).toLowerCase();
  const lanes = new Set();
  if (
    /\b(?:test|tests|lint|typecheck|build|compile|regression|snapshot|file|line|content|order|format|localhost|local app|production data|secret|credential|permission|policy|configuration)\b/.test(
      text
    )
  ) {
    lanes.add("deterministic");
  }
  if (
    /\b(?:database|migration|schema|deployment|deploy|service|integration|webhook|email|sms|pims|postgres|health|logs?|tenant(?: data)? (?:isolated|isolation))\b/.test(
      text
    )
  ) {
    lanes.add("service");
  }
  const browserPattern =
    contractVersion >= 3
      ? /\b(?:visible|page|screen|click|loading|render|copy|text|layout|style|form|button|user|browser|animation|transition|navigation|timing)\b/
      : /\b(?:visible|page|screen|route|open|click|loading|render|copy|text|layout|style|form|button|link|user|browser|animation|transition)\b/;
  if (browserPattern.test(text)) {
    lanes.add("browser");
  }
  if (!lanes.size) {
    lanes.add(
      proofKind === "UI" || proofKind === "GIF"
        ? "browser"
        : proofKind === "service"
          ? "service"
          : "deterministic"
    );
  }
  return EVIDENCE_LANES.filter((lane) => lanes.has(lane));
}

function artifactEvidenceLanes(proofKind) {
  if (proofKind === "UI" || proofKind === "GIF") return ["browser"];
  if (proofKind === "service") return ["service"];
  return ["deterministic"];
}

function behaviorContract({
  outcome,
  acceptanceCriteria,
  explicitExclusions,
  sections,
  proofKind,
  version
}) {
  const userTasks = requirementLines(sections["proof interaction"]);
  const contractVersion =
    version >= REFINED_EVIDENCE_LANE_CONTRACT_VERSION
      ? 3
      : version >= EVIDENCE_LANE_CONTRACT_VERSION
        ? 2
        : 1;
  const payload = {
    version: contractVersion,
    goal: outcome,
    target: {
      kind:
        proofKind === "service"
          ? "service"
          : proofKind === "UI" || proofKind === "GIF"
            ? "web"
            : "repository",
      proofKind
    },
    routes: proofRoutes(sections),
    userTasks,
    checks: acceptanceCriteria.map((statement, index) => ({
      id: `AC${index + 1}`,
      statement,
      ...(contractVersion >= 2
        ? {
            evidenceLanes: clauseEvidenceLanes(
              statement,
              proofKind,
              contractVersion
            )
          }
        : {})
    })),
    antiCheatProbes:
      proofKind === "GIF"
        ? [
            "Capture starts before the triggering action.",
            "The requested intermediate and final states are both observed.",
            "The final route and visible page are not substituted with a different surface."
          ]
        : proofKind === "UI"
          ? [
              "The requested behavior is exercised through the rendered user surface.",
              "The final route and visible page are not substituted with a different surface."
            ]
          : proofKind === "service"
            ? [
                "Evidence comes from the trusted configured service and exact merged revision.",
                "Secrets and production records are not included in proof."
              ]
            : [
                "Checks execute against the exact candidate revision.",
                "A successful process exit without the configured assertions is insufficient."
              ],
    evidenceRequired:
      proofKind === "GIF"
        ? ["clause results", "browser assertions", "video", "GIF", "artifact digests"]
        : proofKind === "UI"
          ? ["clause results", "browser assertions", "screenshot", "artifact digests"]
          : proofKind === "service"
            ? ["clause results", "deployment revision", "health", "logs", "artifact digests"]
            : ["clause results", "commands", "exit status"],
    outOfScope: explicitExclusions,
    captureBeforeAction: proofKind === "GIF"
  };
  if (contractVersion >= 2) {
    payload.artifactLanes = artifactEvidenceLanes(proofKind);
  }
  return {
    ...payload,
    contractDigest: sha256(JSON.stringify(payload))
  };
}

function validateBehaviorContract(contract, acceptanceCriteria, proofKind) {
  const legacyKeys = [
    "antiCheatProbes",
    "captureBeforeAction",
    "checks",
    "contractDigest",
    "evidenceRequired",
    "goal",
    "outOfScope",
    "routes",
    "target",
    "userTasks",
    "version"
  ];
  const expectedKeys =
    contract?.version >= 2
      ? [...legacyKeys, "artifactLanes"].sort()
      : legacyKeys;
  const { contractDigest: _contractDigest, ...payload } = contract ?? {};
  if (
    !contract ||
    Array.isArray(contract) ||
    JSON.stringify(Object.keys(contract).sort()) !== JSON.stringify(expectedKeys) ||
    ![1, 2, 3].includes(contract.version) ||
    !/^[a-f0-9]{64}$/.test(contract.contractDigest ?? "") ||
    sha256(JSON.stringify(payload)) !== contract.contractDigest ||
    contract.target?.proofKind !== proofKind ||
    !["repository", "web", "service"].includes(contract.target?.kind) ||
    typeof contract.goal !== "string" ||
    !contract.goal ||
    typeof contract.captureBeforeAction !== "boolean" ||
    !Array.isArray(contract.routes) ||
    !Array.isArray(contract.userTasks) ||
    !Array.isArray(contract.checks) ||
    !Array.isArray(contract.antiCheatProbes) ||
    !Array.isArray(contract.evidenceRequired) ||
    !Array.isArray(contract.outOfScope) ||
    JSON.stringify(contract.checks) !==
      JSON.stringify(
        acceptanceCriteria.map((statement, index) => ({
          id: `AC${index + 1}`,
          statement,
          ...(contract.version >= 2
            ? {
                evidenceLanes: clauseEvidenceLanes(
                  statement,
                  proofKind,
                  contract.version
                )
              }
            : {})
        }))
      ) ||
    (contract.version >= 2 &&
      JSON.stringify(contract.artifactLanes) !==
        JSON.stringify(artifactEvidenceLanes(proofKind)))
  ) {
    throw new AgentError("behavior contract is invalid", 1);
  }
  for (const route of contract.routes) {
    if (safeProofRoute(route) !== route) throw new AgentError("behavior contract route is invalid", 1);
  }
  return contract;
}

export function createIntentCapsuleVersion({
  issue,
  decision,
  ownerClarifications = [],
  version = INTENT_CAPSULE_VERSION
}) {
  const issueNumber = Number(issue?.number);
  const title = boundedText(issue?.title, 512, "issue title");
  const body = boundedText(issue?.body, MAX_ISSUE_BODY_BYTES, "issue body");
  if (!Number.isSafeInteger(issueNumber) || issueNumber <= 0 || !title) {
    throw new AgentError("source issue is invalid", 1);
  }
  const sections = parseIssueSections(body);
  const acceptanceCriteria = requirementLines(sections["acceptance criteria"]);
  const outcome = boundedText(sections.outcome || title, MAX_SECTION_BYTES, "issue outcome");
  const criteria = acceptanceCriteria.length
    ? acceptanceCriteria
    : [boundedText(sections.outcome || title, MAX_REQUIREMENT_BYTES, "fallback acceptance criterion")];
  const explicitExclusions = exclusionLines(sections.constraints);
  const capsule = {
    version,
    sourceIssue: issueNumber,
    issueSnapshotSha256: issueSnapshotSha256(issue),
    sourceLabels:
      version >= STABLE_INTENT_LABEL_VERSION
        ? stableIntentLabels(issue, version)
        : [...new Set(issueLabels(issue))].sort(),
    title,
    body,
    outcome,
    context: boundedText(sections["plan or context"], MAX_SECTION_BYTES, "issue context"),
    acceptanceCriteria: criteria,
    constraints: boundedText(sections.constraints, MAX_SECTION_BYTES, "issue constraints"),
    explicitExclusions,
    ownerClarifications: normalizedClarifications(ownerClarifications),
    transcriptContext: transcriptContext(sections),
    decision: decisionCapsuleFields(decision)
  };
  if (version >= BEHAVIOR_CONTRACT_VERSION) {
    capsule.behaviorContract = behaviorContract({
      outcome,
      acceptanceCriteria: criteria,
      explicitExclusions,
      sections,
      proofKind: decision.proofNeeded,
      version
    });
  }
  return {
    ...capsule,
    intentDigest: sha256(JSON.stringify(capsule))
  };
}

export function createIntentCapsule({ issue, decision, ownerClarifications = [] }) {
  return createIntentCapsuleVersion({ issue, decision, ownerClarifications });
}

export function validateIntentCapsule(capsule) {
  const legacyKeys = [
    "acceptanceCriteria",
    "body",
    "constraints",
    "context",
    "decision",
    "explicitExclusions",
    "intentDigest",
    "issueSnapshotSha256",
    "outcome",
    "ownerClarifications",
    "sourceIssue",
    "sourceLabels",
    "title",
    "transcriptContext",
    "version"
  ];
  const expectedKeys =
    capsule?.version >= BEHAVIOR_CONTRACT_VERSION
      ? [...legacyKeys, "behaviorContract"].sort()
      : legacyKeys;
  if (
    !capsule ||
    Array.isArray(capsule) ||
    JSON.stringify(Object.keys(capsule).sort()) !== JSON.stringify(expectedKeys) ||
    ![
      1,
      BEHAVIOR_CONTRACT_VERSION,
      STABLE_INTENT_LABEL_VERSION,
      EVIDENCE_LANE_CONTRACT_VERSION,
      REFINED_EVIDENCE_LANE_CONTRACT_VERSION,
      INTENT_CAPSULE_VERSION
    ].includes(capsule.version) ||
    !Number.isSafeInteger(capsule.sourceIssue) ||
    capsule.sourceIssue <= 0 ||
    !/^[a-f0-9]{64}$/.test(capsule.issueSnapshotSha256 ?? "") ||
    !/^[a-f0-9]{64}$/.test(capsule.intentDigest ?? "") ||
    sha256(JSON.stringify(capsulePayload(capsule))) !== capsule.intentDigest ||
    !Array.isArray(capsule.sourceLabels) ||
    !Array.isArray(capsule.acceptanceCriteria) ||
    capsule.acceptanceCriteria.length === 0 ||
    !Array.isArray(capsule.explicitExclusions) ||
    !Array.isArray(capsule.ownerClarifications) ||
    typeof capsule.title !== "string" ||
    !capsule.title ||
    typeof capsule.body !== "string" ||
    typeof capsule.outcome !== "string" ||
    !capsule.outcome ||
    typeof capsule.context !== "string" ||
    typeof capsule.constraints !== "string" ||
    !capsule.decision ||
    Array.isArray(capsule.decision) ||
    !PROOF_KINDS.includes(capsule.decision.proofNeeded)
  ) {
    throw new AgentError("intent capsule is invalid", 1);
  }
  normalizedClarifications(capsule.ownerClarifications);
  if (capsule.version >= BEHAVIOR_CONTRACT_VERSION) {
    validateBehaviorContract(
      capsule.behaviorContract,
      capsule.acceptanceCriteria,
      capsule.decision.proofNeeded
    );
  }
  return capsule;
}

export function validateImplementationResult(result) {
  const expectedKeys = [
    "changes",
    "checks",
    "intentAddendum",
    "summary",
    "version"
  ];
  const addendumKeys = [
    "assumptions",
    "decisions",
    "proofPlan",
    "scopeClarifications",
    "unresolvedQuestions",
    "verificationDecisions"
  ];
  const legacyAddendumKeys = addendumKeys.filter((key) => key !== "proofPlan");
  const actualAddendumKeys = Object.keys(result?.intentAddendum ?? {}).sort();
  const supportedAddendum =
    JSON.stringify(actualAddendumKeys) === JSON.stringify(addendumKeys) ||
    JSON.stringify(actualAddendumKeys) === JSON.stringify(legacyAddendumKeys);
  if (
    !result ||
    Array.isArray(result) ||
    JSON.stringify(Object.keys(result).sort()) !== JSON.stringify(expectedKeys) ||
    result.version !== IMPLEMENTATION_RESULT_VERSION ||
    typeof result.summary !== "string" ||
    !result.summary.trim() ||
    !result.intentAddendum ||
    Array.isArray(result.intentAddendum) ||
    !supportedAddendum
  ) {
    throw new AgentError("implementation result is invalid", 1);
  }
  if (result.intentAddendum.unresolvedQuestions.length > 1) {
    throw new AgentError(
      "implementation result must consolidate unresolved questions",
      1
    );
  }
  return {
    version: IMPLEMENTATION_RESULT_VERSION,
    summary: boundedText(result.summary, 4_000, "implementation summary"),
    changes: boundedStringArray(result.changes, "implementation changes"),
    checks: boundedStringArray(result.checks, "implementation checks"),
    intentAddendum: {
      decisions: boundedStringArray(
        result.intentAddendum.decisions,
        "implementation decisions"
      ),
      assumptions: boundedStringArray(
        result.intentAddendum.assumptions,
        "implementation assumptions"
      ),
      scopeClarifications: boundedStringArray(
        result.intentAddendum.scopeClarifications,
        "scope clarifications"
      ),
      verificationDecisions: boundedStringArray(
        result.intentAddendum.verificationDecisions,
        "verification decisions"
      ),
      proofPlan: validateProofPlan(
        result.intentAddendum.proofPlan ?? { version: 1, tasks: [] }
      ),
      unresolvedQuestions: boundedStringArray(
        result.intentAddendum.unresolvedQuestions,
        "unresolved questions"
      )
    }
  };
}

export function implementationAddendumEnvelope(result) {
  const validated = validateImplementationResult(result);
  return {
    version: IMPLEMENTATION_RESULT_VERSION,
    intentAddendum: validated.intentAddendum,
    digest: sha256(JSON.stringify(validated.intentAddendum))
  };
}

export function parseImplementationAddendum(body) {
  const text = String(body ?? "");
  if (text.split(IMPLEMENTATION_ADDENDUM_MARKER).length !== 2) {
    throw new AgentError("PR must contain exactly one implementation intent addendum", 1);
  }
  const afterMarker = text.slice(
    text.indexOf(IMPLEMENTATION_ADDENDUM_MARKER) +
      IMPLEMENTATION_ADDENDUM_MARKER.length
  );
  const match = afterMarker.match(/^\s*Implementation intent addendum:\s*```json\s*([\s\S]*?)```/i);
  if (!match) throw new AgentError("implementation intent addendum JSON is missing", 1);
  const envelope = extractJson(match[1]);
  const expectedKeys = ["digest", "intentAddendum", "version"];
  if (
    !envelope ||
    Array.isArray(envelope) ||
    JSON.stringify(Object.keys(envelope).sort()) !== JSON.stringify(expectedKeys) ||
    envelope.version !== IMPLEMENTATION_RESULT_VERSION ||
    !/^[a-f0-9]{64}$/.test(envelope.digest ?? "")
  ) {
    throw new AgentError("implementation intent addendum is invalid", 1);
  }
  if (sha256(JSON.stringify(envelope.intentAddendum)) !== envelope.digest) {
    throw new AgentError("implementation intent addendum digest does not match", 1);
  }
  const validated = validateImplementationResult({
    version: IMPLEMENTATION_RESULT_VERSION,
    summary: "Validated implementation addendum.",
    changes: [],
    checks: [],
    intentAddendum: envelope.intentAddendum
  });
  return {
    ...envelope,
    intentAddendum: validated.intentAddendum
  };
}

export function parseManagedTriageDecision(comment, marker) {
  const text = String(comment?.body ?? "");
  const markerIndex = text.indexOf(String(marker));
  if (markerIndex < 0) throw new AgentError("managed triage marker is missing", 1);
  const afterMarker = text.slice(markerIndex + String(marker).length);
  const fences = [...afterMarker.matchAll(/```json\s*([\s\S]*?)```/gi)];
  if (fences.length !== 1) {
    throw new AgentError("managed triage must contain exactly one decision JSON block", 1);
  }
  const decision = extractJson(fences[0][1]);
  const clarificationValid = (decision?.ownerClarifications ?? []).every(
    (clarification) =>
      Number.isSafeInteger(clarification?.commentId) &&
      clarification.commentId > 0 &&
      /^[a-f0-9]{64}$/.test(clarification?.sha256 ?? "")
  );
  if (
    !decision ||
    Array.isArray(decision) ||
    JSON.stringify(Object.keys(decision).sort()) !==
      JSON.stringify([...MANAGED_TRIAGE_FIELDS].sort()) ||
    !["low", "medium", "high"].includes(decision.value) ||
    !["low", "medium", "high"].includes(decision.priority) ||
    !["low", "medium", "high"].includes(decision.risk) ||
    !["yes", "no", "unclear"].includes(decision.alignment) ||
    typeof decision.implementationScope !== "string" ||
    !decision.implementationScope.trim() ||
    !PROOF_KINDS.includes(decision.proofNeeded) ||
    !["implement", "manual-review", "blocked", "reject"].includes(
      decision.automationDecision
    ) ||
    typeof decision.humanQuestion !== "string" ||
    !/^[a-f0-9]{64}$/.test(decision.issueSnapshotSha256 ?? "") ||
    !/^[a-f0-9]{64}$/.test(decision.intentDigest ?? "") ||
    !Array.isArray(decision.ownerClarifications) ||
    !clarificationValid ||
    new Set(decision.ownerClarifications.map((value) => value.commentId)).size !==
      decision.ownerClarifications.length
  ) {
    throw new AgentError("managed triage JSON is invalid", 1);
  }
  return decision;
}

export function resolveOwnerClarifications(comments, decision, repoOwner) {
  const owner = String(repoOwner ?? "").toLowerCase();
  return decision.ownerClarifications.map((expected) => {
    const comment = (comments ?? []).find(
      (entry) => Number(entry?.database_id ?? entry?.id) === expected.commentId
    );
    const body = normalizedText(comment?.body);
    if (
      !comment ||
      String(comment?.user?.login ?? "").toLowerCase() !== owner ||
      !body ||
      sha256(body) !== expected.sha256
    ) {
      throw new AgentError("sealed owner clarification is missing or changed", 1);
    }
    return {
      commentId: expected.commentId,
      sha256: expected.sha256,
      body
    };
  });
}

export function intentCapsuleForManagedTriage({
  issue,
  comments,
  triageComment,
  marker,
  repoOwner
}) {
  const decision = parseManagedTriageDecision(triageComment, marker);
  if (issueSnapshotSha256(issue) !== decision.issueSnapshotSha256) {
    throw new AgentError(`source issue #${issue?.number} changed after trusted triage`, 1);
  }
  const ownerClarifications = resolveOwnerClarifications(
    comments,
    decision,
    repoOwner
  );
  const capsule = createIntentCapsule({
    issue,
    decision,
    ownerClarifications
  });
  if (capsule.intentDigest === decision.intentDigest) {
    return { decision, capsule };
  }
  for (const legacyIssue of legacyIntentIssues(issue, decision)) {
    for (const version of [
      REFINED_EVIDENCE_LANE_CONTRACT_VERSION,
      EVIDENCE_LANE_CONTRACT_VERSION,
      STABLE_INTENT_LABEL_VERSION,
      BEHAVIOR_CONTRACT_VERSION,
      1
    ]) {
      const legacyCapsule = createIntentCapsuleVersion({
        issue: legacyIssue,
        decision,
        ownerClarifications,
        version
      });
      if (legacyCapsule.intentDigest === decision.intentDigest) {
        return { decision, capsule: legacyCapsule };
      }
    }
  }
  throw new AgentError("managed triage intent digest does not match its sealed capsule", 1);
}
