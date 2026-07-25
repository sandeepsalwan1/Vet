#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import {
  AgentError,
  fail,
  finish,
  ghApiJson,
  ghJson,
  loadConfig,
  parseArgs,
  repoSlug,
  withTempJson
} from "./agent-lib.mjs";

export const READINESS_MARKER = "<!-- agent-readiness:v1 -->";

function newest(items, fields) {
  return [...(items ?? [])].sort((left, right) => {
    const leftTime = fields.map((field) => Date.parse(left?.[field] ?? "")).find(Number.isFinite) ?? 0;
    const rightTime = fields.map((field) => Date.parse(right?.[field] ?? "")).find(Number.isFinite) ?? 0;
    if (leftTime !== rightTime) return rightTime - leftTime;
    return Number(right?.id ?? 0) - Number(left?.id ?? 0);
  })[0];
}

function actionsDetailsUrl(value, config) {
  const repo = `${config.repo.owner}/${config.repo.name}`.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^https://github\\.com/${repo}/actions/runs/\\d+(?:/job/\\d+)?$`, "i").test(String(value ?? ""));
}

export function exactHeadCheckState(checks, name, headSha, config) {
  const candidates = (checks ?? []).filter(
    (check) =>
      check?.name === name &&
      check?.head_sha === headSha &&
      check?.app?.slug === "github-actions" &&
      actionsDetailsUrl(check?.details_url, config)
  );
  const check = newest(candidates, ["started_at", "created_at", "completed_at"]);
  return check?.conclusion ?? check?.status ?? "missing";
}

function finding(category, code, message) {
  return { category, code, message };
}

function hasCredential(credentials, name) {
  return credentials?.[name] === true;
}

function policyFindings(config, snapshot) {
  const findings = [];
  const branch = snapshot.branch;
  const protection = branch?.protection;
  const required = protection?.required_status_checks;
  const contexts = new Set([
    ...(required?.contexts ?? []),
    ...(required?.checks ?? []).map((check) => check?.context).filter(Boolean)
  ]);
  if (
    branch?.protected !== true ||
    !["non_admins", "everyone"].includes(required?.enforcement_level)
  ) {
    findings.push(
      finding(
        "policy",
        "branch-protected",
        "main branch protection or required-check enforcement is unavailable"
      )
    );
  }
  for (const name of config.automerge.requiredChecks) {
    if (!contexts.has(name)) {
      findings.push(finding("policy", `branch-check-${name}`, `main branch protection does not require ${name}`));
    }
  }
  return findings;
}

function baselineFindings(config, snapshot) {
  const findings = [];
  for (const name of config.readiness.baselineChecks) {
    const state = exactHeadCheckState(snapshot.checks, name, snapshot.headSha, config);
    if (state !== "success") {
      findings.push(finding("baseline", `check-${name}`, `${name} on current main is ${state}`));
    }
  }
  return findings;
}

function credentialFindings(credentials) {
  const findings = [];
  if (!hasCredential(credentials, "agentAuth")) {
    findings.push(finding("credential", "agent-auth", "required model authentication secret is missing"));
  }
  if (!hasCredential(credentials, "primaryProvider")) {
    findings.push(finding("credential", "primary-provider", "required primary Crabbox provider secret is missing"));
  }
  if (!hasCredential(credentials, "render")) {
    findings.push(finding("credential", "render", "required trusted Render authentication secret is missing"));
  }
  return findings;
}

function latestSuccessfulReadinessRun(runs, headSha) {
  return newest(
    (runs ?? []).filter(
      (run) =>
        run?.status === "completed" &&
        run?.conclusion === "success" &&
        run?.event !== "pull_request" &&
        run?.head_branch === "main" &&
        run?.head_sha === headSha
    ),
    ["updated_at", "created_at", "run_started_at"]
  );
}

function freshnessFindings(config, snapshot, now) {
  const run = latestSuccessfulReadinessRun(
    snapshot.readinessRuns,
    snapshot.headSha
  );
  if (!run) {
    return [
      finding(
        "provider",
        "health-missing",
        "no successful readiness run exists for the current main head"
      )
    ];
  }
  const timestamp = Date.parse(run.updated_at ?? run.created_at ?? "");
  const maxAgeMs = config.readiness.maxAgeHours * 60 * 60 * 1000;
  if (!Number.isFinite(timestamp) || now.getTime() - timestamp > maxAgeMs) {
    return [finding("provider", "health-stale", "latest successful readiness run is stale")];
  }
  return [];
}

function scheduledFindings(config, snapshot) {
  const findings = [];
  if (snapshot.staticAgentTests !== true) {
    findings.push(finding("repository", "agent-tests", "deterministic agent tests failed"));
  }
  if (snapshot.audit?.ok !== true) {
    findings.push(finding("dependency", "production-audit", "production dependency audit failed"));
  }
  const provider = snapshot.providerRecord;
  const acceptablePrimaryProviders = new Set(
    config.crabbox.nonVisualProviders ?? [config.readiness.primaryProvider]
  );
  if (
    provider?.ok !== true ||
    provider?.attempted !== true ||
    !acceptablePrimaryProviders.has(provider?.provider) ||
    !/^[A-Za-z0-9._:-]+$/.test(String(provider?.leaseId ?? "")) ||
    provider?.timing?.provider !== provider?.provider ||
    provider?.timing?.leaseId !== provider?.leaseId ||
    !Number.isFinite(provider?.timing?.totalMs) ||
    provider.timing.totalMs < 0 ||
    provider?.timing?.exitCode !== 0
  ) {
    findings.push(finding("provider", "primary-lifecycle", "primary Crabbox provider lifecycle smoke failed"));
  }
  const fallback = snapshot.fallbackProviderRecord;
  if (
    fallback?.ok !== true ||
    fallback?.attempted !== true ||
    fallback?.provider !== config.readiness.fallbackProvider ||
    !/^[A-Za-z0-9._:-]+$/.test(String(fallback?.leaseId ?? "")) ||
    fallback?.timing?.provider !== config.readiness.fallbackProvider ||
    fallback?.timing?.leaseId !== fallback?.leaseId ||
    !Number.isFinite(fallback?.timing?.totalMs) ||
    fallback.timing.totalMs < 0 ||
    fallback?.timing?.exitCode !== 0
  ) {
    findings.push(
      finding(
        "provider",
        "fallback-lifecycle",
        "fallback Crabbox provider lifecycle smoke failed"
      )
    );
  }
  const render = snapshot.renderRecord;
  if (
    render?.status !== "passed" ||
    render?.deployStatus !== "live" ||
    !Array.isArray(render?.health) ||
    render.health.length === 0 ||
    render.health.some((check) => check?.passed !== true)
  ) {
    findings.push(
      finding(
        "service",
        "render-health",
        "trusted Render deployment, logs, or tenant health verification failed"
      )
    );
  }
  return findings;
}

export function evaluateReadiness(config, snapshot, options = {}) {
  const mode = options.mode ?? "scheduled";
  const now = options.now ?? new Date();
  if (!/^[a-f0-9]{40}$/.test(String(snapshot?.headSha ?? ""))) {
    throw new AgentError("readiness snapshot is missing an exact main head", 1);
  }
  const findings = [
    ...credentialFindings(snapshot.credentials),
    ...baselineFindings(config, snapshot),
    ...policyFindings(config, snapshot),
    ...(mode === "scheduled" ? scheduledFindings(config, snapshot) : freshnessFindings(config, snapshot, now))
  ];
  return {
    version: 1,
    ready: findings.length === 0,
    mode,
    repo: repoSlug(config),
    headSha: snapshot.headSha,
    checkedAt: now.toISOString(),
    provider: mode === "scheduled" ? snapshot.providerRecord?.provider ?? "" : config.readiness.primaryProvider,
    leaseId: mode === "scheduled" ? snapshot.providerRecord?.leaseId ?? "" : "",
    fallbackProvider:
      mode === "scheduled"
        ? snapshot.fallbackProviderRecord?.provider ?? ""
        : config.readiness.fallbackProvider,
    fallbackLeaseId:
      mode === "scheduled" ? snapshot.fallbackProviderRecord?.leaseId ?? "" : "",
    findings
  };
}

function api(config, path, options = {}) {
  return ghApiJson(`repos/${config.repo.owner}/${config.repo.name}/${path}`, options);
}

function booleanEnvironment(name) {
  return String(process.env[name] ?? "").toLowerCase() === "true";
}

function readJsonIfPresent(path, fallback) {
  if (!path) return fallback;
  try {
    return JSON.parse(readFileSync(resolve(path), "utf8"));
  } catch {
    return fallback;
  }
}

export function collectReadinessSnapshot(config, options = {}) {
  const readApi =
    options.api ??
    ((path, apiOptions = {}) => api(config, path, apiOptions));
  const expectedHead = String(options.expectedHead ?? "").trim();
  if (expectedHead && !/^[a-f0-9]{40}$/.test(expectedHead)) {
    throw new AgentError("readiness expected head is invalid", 2);
  }
  const head = readApi(
    `commits/${expectedHead || config.repo.defaultBranch}`
  );
  const headSha = String(head?.sha ?? "");
  if (expectedHead && headSha !== expectedHead) {
    throw new AgentError("readiness commit lookup did not match the expected head", 1);
  }
  const checks =
    readApi(`commits/${headSha}/check-runs?per_page=100`, {
      paginate: false
    })?.check_runs ?? [];
  const readinessRuns =
    readApi(
      `actions/workflows/${config.readiness.workflow}/runs?branch=${encodeURIComponent(config.repo.defaultBranch)}&per_page=20`
    )?.workflow_runs ?? [];
  return {
    headSha,
    checks,
    // The branch summary exposes required checks to read-only workflow tokens.
    // Exact-head automerge independently enforces base freshness.
    branch: readApi(`branches/${config.repo.defaultBranch}`),
    readinessRuns,
    credentials: {
      agentAuth: booleanEnvironment("AGENT_AUTH_PRESENT"),
      primaryProvider: booleanEnvironment("PRIMARY_PROVIDER_AUTH_PRESENT"),
      render: booleanEnvironment("RENDER_AUTH_PRESENT")
    },
    providerRecord: readJsonIfPresent(options.providerRecord, null),
    fallbackProviderRecord: readJsonIfPresent(
      options.fallbackProviderRecord,
      null
    ),
    renderRecord: readJsonIfPresent(options.renderRecord, null),
    staticAgentTests: booleanEnvironment("STATIC_AGENT_TESTS_PASSED"),
    audit: readJsonIfPresent(options.auditRecord, { ok: false })
  };
}

export function readinessSummary(result) {
  const lines = [
    READINESS_MARKER,
    `head: \`${result.headSha}\``,
    `checked: ${result.checkedAt}`,
    `state: ${result.ready ? "ready" : "blocked"}`
  ];
  if (result.provider) lines.push(`provider: ${result.provider}`);
  if (result.leaseId) lines.push(`lease: ${result.leaseId}`);
  if (result.fallbackProvider) {
    lines.push(`fallback provider: ${result.fallbackProvider}`);
  }
  if (result.fallbackLeaseId) {
    lines.push(`fallback lease: ${result.fallbackLeaseId}`);
  }
  if (result.findings.length) {
    lines.push("", "Findings:");
    for (const item of result.findings) lines.push(`- ${item.category}/${item.code}: ${item.message}`);
  }
  return `${lines.join("\n")}\n`;
}

export async function waitForPreflightReadiness(config, options = {}) {
  const timeoutMs = Number(options.timeoutMs ?? 0);
  const pollMs = Number(options.pollMs ?? 15_000);
  if (
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 0 ||
    timeoutMs > 1_800_000 ||
    !Number.isInteger(pollMs) ||
    pollMs < 1_000 ||
    pollMs > 60_000
  ) {
    throw new AgentError("readiness wait bounds are invalid", 2);
  }
  const clock = options.clock ?? Date.now;
  const sleep = options.sleep ?? delay;
  const collect =
    options.collect ?? (() => collectReadinessSnapshot(config, options));
  const deadline = clock() + timeoutMs;
  let result;
  do {
    const now = clock();
    result = evaluateReadiness(config, collect(), {
      mode: "preflight",
      now: new Date(now)
    });
    if (result.ready || now >= deadline) return result;
    await sleep(Math.min(pollMs, deadline - now));
  } while (true);
}

const PENDING_CHECK_STATES = new Set([
  "missing",
  "pending",
  "queued",
  "requested",
  "waiting",
  "in_progress"
]);

export async function waitForBaselineChecks(config, options = {}) {
  const timeoutMs = Number(options.timeoutMs ?? 0);
  const pollMs = Number(options.pollMs ?? 15_000);
  if (
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 0 ||
    timeoutMs > 1_800_000 ||
    !Number.isInteger(pollMs) ||
    pollMs < 1_000 ||
    pollMs > 60_000
  ) {
    throw new AgentError("baseline wait bounds are invalid", 2);
  }
  const clock = options.clock ?? Date.now;
  const sleep = options.sleep ?? delay;
  const collect =
    options.collect ?? (() => collectReadinessSnapshot(config, options));
  const deadline = clock() + timeoutMs;
  do {
    const snapshot = collect();
    const states = Object.fromEntries(
      config.readiness.baselineChecks.map((name) => [
        name,
        exactHeadCheckState(snapshot.checks, name, snapshot.headSha, config)
      ])
    );
    const ready = Object.values(states).every((state) => state === "success");
    const terminalFailure = Object.values(states).some(
      (state) => state !== "success" && !PENDING_CHECK_STATES.has(state)
    );
    const now = clock();
    const result = {
      ready,
      headSha: snapshot.headSha,
      states,
      terminalFailure,
      timedOut: !ready && !terminalFailure && now >= deadline
    };
    if (ready || terminalFailure || now >= deadline) return result;
    await sleep(Math.min(pollMs, deadline - now));
  } while (true);
}

function findReadinessIssue(config) {
  const issues = api(config, "issues?state=all&per_page=100", { paginate: true }) ?? [];
  return newest(
    issues.filter(
      (issue) =>
        !issue.pull_request &&
        (String(issue.body ?? "").includes(READINESS_MARKER) || issue.title === config.readiness.alertTitle)
    ),
    ["updated_at", "created_at"]
  );
}

function mutateJson(args, payload, dependencies = {}) {
  const temp = dependencies.withTempJson ?? withTempJson;
  const execute = dependencies.ghJson ?? ghJson;
  return temp(payload, (path) => execute([...args, "--input", path]));
}

export function publishReadiness(config, result, options = {}, dependencies = {}) {
  const summary = readinessSummary(result);
  const repo = `repos/${config.repo.owner}/${config.repo.name}`;
  const detailsUrl = String(options.detailsUrl ?? "");
  const checkPayload = {
    name: config.readiness.status,
    head_sha: result.headSha,
    status: "completed",
    conclusion: result.ready ? "success" : "failure",
    details_url: detailsUrl,
    output: {
      title: result.ready ? "AFK automation ready" : "AFK automation blocked",
      summary
    }
  };
  mutateJson(["api", `${repo}/check-runs`, "--method", "POST"], checkPayload, dependencies);

  const existing = (dependencies.findIssue ?? findReadinessIssue)(config);
  if (result.ready) {
    if (existing?.state === "open") {
      mutateJson(
        ["api", `${repo}/issues/${existing.number}`, "--method", "PATCH"],
        { state: "closed", state_reason: "completed", body: summary },
        dependencies
      );
    }
    return { check: "success", issue: existing?.state === "open" ? "closed" : "none" };
  }

  if (existing) {
    mutateJson(
      ["api", `${repo}/issues/${existing.number}`, "--method", "PATCH"],
      { state: "open", title: config.readiness.alertTitle, body: summary },
      dependencies
    );
    return { check: "failure", issue: existing.state === "open" ? "updated" : "reopened", number: existing.number };
  }
  const issue = mutateJson(
    ["api", `${repo}/issues`, "--method", "POST"],
    { title: config.readiness.alertTitle, body: summary },
    dependencies
  );
  return { check: "failure", issue: "created", number: issue?.number };
}

export async function main() {
  const args = parseArgs();
  const config = loadConfig();
  const mode = args.preflight ? "preflight" : "scheduled";
  const snapshotOptions = {
    expectedHead:
      args["expected-head"] ?? process.env.READINESS_EXPECTED_HEAD ?? "",
    providerRecord: args["provider-record"],
    fallbackProviderRecord: args["fallback-provider-record"],
    renderRecord: args["render-record"],
    auditRecord: args["audit-record"]
  };
  const waitSeconds = Number(args["wait-seconds"] ?? 0);
  if (
    !Number.isInteger(waitSeconds) ||
    waitSeconds < 0 ||
    waitSeconds > 1_800
  ) {
    throw new AgentError("readiness wait seconds are invalid", 2);
  }
  if (args["wait-baseline"]) {
    const baseline = await waitForBaselineChecks(config, {
      ...snapshotOptions,
      timeoutMs: waitSeconds * 1_000
    });
    finish(
      {
        ok: baseline.ready,
        message: baseline.ready
          ? "exact-head baseline checks passed"
          : "exact-head baseline checks did not pass",
        baseline
      },
      Boolean(args.json),
      baseline.ready ? 0 : 1
    );
    return;
  }
  const result =
    mode === "preflight" && waitSeconds > 0
      ? await waitForPreflightReadiness(config, {
          ...snapshotOptions,
          timeoutMs: waitSeconds * 1_000
        })
      : evaluateReadiness(
          config,
          collectReadinessSnapshot(config, snapshotOptions),
          { mode }
        );
  let publication = null;
  if (args.publish) {
    publication = publishReadiness(config, result, {
      detailsUrl: process.env.GITHUB_RUN_URL ?? ""
    });
  }
  finish({ ok: result.ready, result, publication }, Boolean(args.json), result.ready ? 0 : 1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => fail(error, Boolean(parseArgs().json)));
}
