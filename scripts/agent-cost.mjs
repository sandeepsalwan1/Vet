#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AgentError,
  actionsRunUrl,
  extractJson,
  fail,
  finish,
  getIssueComments,
  getPullRequest,
  ghApiJson,
  issueLabels,
  loadConfig,
  markdownJsonBlock,
  newestManagedComment,
  parseArgs,
  parseImplementationMetadata,
  setCommitStatus,
  skipsNoMistakesForCost,
  upsertManagedComment
} from "./agent-lib.mjs";

const LANES = new Set(["implement", "review", "no-mistakes", "proof"]);
const EFFECTS = new Set(["new-head", "finding", "proof", "decision", "none"]);
const MAX_RECORDS = 32;

function roundUsd(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function count(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new AgentError(`invalid ${label}`, 1);
  }
  return value;
}

export function validateModelUsage(value, expectedLane) {
  if (
    !value ||
    value.version !== 1 ||
    value.backend !== "codex" ||
    value.lane !== expectedLane ||
    typeof value.model !== "string" ||
    !value.model ||
    typeof value.effort !== "string" ||
    !value.effort ||
    typeof value.complete !== "boolean" ||
    !Array.isArray(value.calls) ||
    value.calls.length > 20
  ) {
    throw new AgentError("model usage record is invalid", 1);
  }
  const calls = value.calls.map((call) => {
    if (
      !/^[a-f0-9]{64}$/.test(String(call?.id ?? "")) ||
      Object.keys(call).some(
        (key) =>
          ![
            "id",
            "inputTokens",
            "cachedInputTokens",
            "outputTokens",
            "reasoningOutputTokens"
          ].includes(key)
      )
    ) {
      throw new AgentError("model usage call is invalid", 1);
    }
    const inputTokens = count(call.inputTokens, "input token count");
    const cachedInputTokens = count(call.cachedInputTokens, "cached input token count");
    if (cachedInputTokens > inputTokens) {
      throw new AgentError("cached input tokens exceed total input tokens", 1);
    }
    return {
      id: call.id,
      inputTokens,
      cachedInputTokens,
      outputTokens: count(call.outputTokens, "output token count"),
      reasoningOutputTokens:
        call.reasoningOutputTokens === null
          ? null
          : count(call.reasoningOutputTokens, "reasoning output token count")
    };
  });
  if (value.complete !== (calls.length > 0) && !(value.complete && calls.length === 0 && expectedLane === "no-mistakes")) {
    throw new AgentError("model usage completeness is inconsistent", 1);
  }
  return { ...value, calls };
}

export function priceModelUsage(config, usage) {
  const price = config.cost.modelPricing.models[usage.model];
  if (!price) throw new AgentError(`no price snapshot for model ${usage.model}`, 1);
  const calls = usage.calls.map((call) => {
    const uncachedInputTokens = call.inputTokens - call.cachedInputTokens;
    const estimatedUsd = roundUsd(
      (uncachedInputTokens * price.inputPerMillionUsd +
        call.cachedInputTokens * price.cachedInputPerMillionUsd +
        call.outputTokens * price.outputPerMillionUsd) /
        1_000_000
    );
    return { ...call, uncachedInputTokens, estimatedUsd };
  });
  return {
    attempted: calls.length > 0,
    complete: usage.complete,
    backend: usage.backend,
    model: usage.model,
    effort: usage.effort,
    authenticationMode: config.cost.authenticationMode,
    pricingVersion: config.cost.modelPricing.version,
    pricingSource: config.cost.modelPricing.source,
    calls,
    totals: {
      inputTokens: calls.reduce((sum, call) => sum + call.inputTokens, 0),
      cachedInputTokens: calls.reduce((sum, call) => sum + call.cachedInputTokens, 0),
      outputTokens: calls.reduce((sum, call) => sum + call.outputTokens, 0),
      reasoningOutputTokens: calls.reduce(
        (sum, call) => sum + (call.reasoningOutputTokens ?? 0),
        0
      ),
      estimatedUsd: roundUsd(calls.reduce((sum, call) => sum + call.estimatedUsd, 0))
    }
  };
}

export function validateRemoteRecord(config, value, expectedRemoteLane) {
  const allowedProviders = new Set([
    ...(config.crabbox.nonVisualProviders ?? []),
    ...(config.crabbox.visualProviders ?? [])
  ]);
  if (
    !value ||
    value.ok !== true ||
    value.attempted !== true ||
    value.lane !== expectedRemoteLane ||
    !allowedProviders.has(value.provider) ||
    !/^[A-Za-z0-9._:-]+$/.test(String(value.leaseId ?? "")) ||
    value.timing?.provider !== value.provider ||
    value.timing?.leaseId !== value.leaseId ||
    value.timing?.exitCode !== 0 ||
    !Number.isFinite(value.timing?.totalMs) ||
    value.timing.totalMs < 0
  ) {
    throw new AgentError("Crabbox cost provenance is invalid", 1);
  }
  return value;
}

export function priceProviderUsage(config, remote) {
  if (!remote) {
    return {
      attempted: false,
      complete: true,
      provider: "",
      leaseId: "",
      durationMs: 0,
      estimatedIncrementalUsd: 0,
      estimateKind: "not-used",
      networkCost: "not-used"
    };
  }
  if (remote.provider === "hetzner") {
    const price = config.cost.hetznerCloudPricing;
    if (
      !price ||
      price.machineClass !== "beast" ||
      price.location !== "fsn1" ||
      !Array.isArray(price.fallbackTypes) ||
      price.fallbackTypes.length === 0 ||
      !Number.isFinite(price.maximumServerPerHourUsd) ||
      price.maximumServerPerHourUsd <= 0 ||
      !Number.isFinite(price.primaryIpv4PerHourUsd) ||
      price.primaryIpv4PerHourUsd < 0 ||
      price.billingIncrementHours !== 1
    ) {
      throw new AgentError("Hetzner price snapshot is invalid", 1);
    }
    const billableHours = Math.max(
      price.billingIncrementHours,
      Math.ceil(remote.timing.totalMs / 3_600_000)
    );
    const serverUsd = billableHours * price.maximumServerPerHourUsd;
    const primaryIpv4Usd = billableHours * price.primaryIpv4PerHourUsd;
    return {
      attempted: true,
      complete: true,
      provider: remote.provider,
      leaseId: remote.leaseId,
      durationMs: remote.timing.totalMs,
      pricingVersion: price.version,
      pricingSource: price.source,
      billingSource: price.billingSource,
      estimatedIncrementalUsd: roundUsd(serverUsd + primaryIpv4Usd),
      estimateKind:
        "conservative-beast-class-hourly-rounding-plus-primary-ipv4",
      assumptions: {
        machineClass: price.machineClass,
        location: price.location,
        fallbackTypes: price.fallbackTypes,
        billableHours
      },
      components: {
        serverUpperBoundUsd: roundUsd(serverUsd),
        primaryIpv4Usd: roundUsd(primaryIpv4Usd)
      },
      storageCost: "included in the selected cloud server rate",
      networkCost: "not-reported; traffic allowance and overage excluded"
    };
  }
  if (remote.provider !== "vercel-sandbox") {
    const localIncluded = remote.provider === "local-container";
    return {
      attempted: true,
      complete: localIncluded,
      provider: remote.provider,
      leaseId: remote.leaseId,
      durationMs: remote.timing.totalMs,
      estimatedIncrementalUsd: localIncluded ? 0 : null,
      estimateKind: localIncluded
        ? "github-hosted-local-container-included"
        : "provider-price-not-configured",
      networkCost: localIncluded ? "included" : "not-reported"
    };
  }
  const price = config.cost.vercelSandboxPricing;
  const hours = remote.timing.totalMs / 3_600_000;
  const vcpus = price.defaultVcpus;
  const memoryGb = vcpus * price.memoryGbPerVcpu;
  const activeCpuUpperBoundUsd = hours * vcpus * price.activeCpuPerHourUsd;
  const memoryUsd = hours * memoryGb * price.memoryPerGbHourUsd;
  const creationUsd = price.creationPerMillionUsd / 1_000_000;
  return {
    attempted: true,
    complete: true,
    provider: remote.provider,
    leaseId: remote.leaseId,
    durationMs: remote.timing.totalMs,
    pricingVersion: price.version,
    pricingSource: price.source,
    estimatedIncrementalUsd: roundUsd(activeCpuUpperBoundUsd + memoryUsd + creationUsd),
    estimateKind: "upper-bound-active-cpu-plus-memory-and-creation",
    assumptions: { vcpus, memoryGb },
    components: {
      activeCpuUpperBoundUsd: roundUsd(activeCpuUpperBoundUsd),
      memoryUsd: roundUsd(memoryUsd),
      creationUsd: roundUsd(creationUsd)
    },
    networkCost: "not-reported; outbound usage excluded"
  };
}

export function proofOutcomeRecord(remote, local = null) {
  const outcome =
    remote?.terminal === true && remote?.result?.status === "passed"
      ? remote
      : local?.terminal === true && local?.result?.status === "passed"
        ? local
        : null;
  if (!outcome) throw new AgentError("no passing proof outcome is available for cost accounting", 1);
  const provider = String(outcome.result?.provider ?? "");
  if (!provider || provider === "github-actions") return { record: null, lane: "" };
  const lane =
    outcome.result.proofKind === "GIF"
      ? "gifProof"
      : outcome.result.proofKind === "UI"
        ? "visualProof"
        : "ciRemote";
  return {
    lane,
    record: {
      ok: true,
      attempted: true,
      lane,
      provider,
      leaseId: outcome.result.leaseId,
      timing: outcome.timing
    }
  };
}

export function proofRemoteRecord(encodedRemote, encodedLocal) {
  const decode = (value) => {
    if (!value) return null;
    try {
      return JSON.parse(Buffer.from(String(value), "base64").toString("utf8"));
    } catch {
      throw new AgentError("proof outcome cost input is invalid", 1);
    }
  };
  return proofOutcomeRecord(decode(encodedRemote), decode(encodedLocal));
}

function newestDate(items, fields) {
  return [...items].sort((left, right) => {
    const leftTime = fields.map((field) => Date.parse(left?.[field] ?? "")).find(Number.isFinite) ?? 0;
    const rightTime = fields.map((field) => Date.parse(right?.[field] ?? "")).find(Number.isFinite) ?? 0;
    return rightTime - leftTime;
  })[0];
}

export function actionsUsage(config, runId, options = {}) {
  if (!/^\d+$/.test(String(runId ?? ""))) {
    return { runId: "", observedJobMinutes: 0, billing: "unavailable", estimatedUsd: null };
  }
  const apiJson = options.ghApiJson ?? ghApiJson;
  const now = options.now ?? new Date();
  const root = `repos/${config.repo.owner}/${config.repo.name}`;
  const repository = apiJson(root);
  const jobs = apiJson(`${root}/actions/runs/${runId}/jobs?per_page=100`)?.jobs ?? [];
  const observedJobMinutes = jobs.reduce((sum, job) => {
    const start = Date.parse(job?.started_at ?? "");
    const end = Date.parse(job?.completed_at ?? "");
    if (!Number.isFinite(start)) return sum;
    const duration = Math.max(0, (Number.isFinite(end) ? end : now.getTime()) - start);
    return sum + Math.ceil(duration / 60_000);
  }, 0);
  const included = repository?.private === false;
  return {
    runId: String(runId),
    observedJobMinutes,
    billing: included ? "included-public-repository" : "plan-dependent",
    estimatedUsd: included ? 0 : null
  };
}

function stableRecordId(record) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        lane: record.lane,
        headSha: record.headSha,
        modelCalls: record.model.calls.map((call) => call.id),
        provider: record.provider.provider,
        leaseId: record.provider.leaseId,
        runId: record.githubActions.runId
      })
    )
    .digest("hex");
}

export function buildCostRecord(config, options) {
  if (!LANES.has(options.lane) || !EFFECTS.has(options.effect)) {
    throw new AgentError("cost lane or effect is invalid", 2);
  }
  if (!/^[a-f0-9]{40}$/.test(String(options.headSha ?? ""))) {
    throw new AgentError("cost record requires an exact head", 2);
  }
  const usage = options.modelUsage
    ? validateModelUsage(options.modelUsage, options.lane)
    : {
        version: 1,
        backend: "codex",
        lane: options.lane,
        model: config.backend.model,
        effort: config.backend.effort,
        complete: options.lane === "proof",
        calls: []
      };
  const remote = options.remoteRecord
    ? validateRemoteRecord(config, options.remoteRecord, options.remoteLane)
    : null;
  const record = {
    id: "",
    lane: options.lane,
    headSha: options.headSha,
    recordedAt: (options.now ?? new Date()).toISOString(),
    retryReason: String(options.retryReason ?? "initial").slice(0, 120),
    effect: options.effect,
    complete: usage.complete,
    model: priceModelUsage(config, usage),
    provider: priceProviderUsage(config, remote),
    githubActions: options.githubActions,
    fixedServices: {
      incrementalUsd: 0,
      note: "Render, Hostinger, and database fixed subscriptions are not allocated when the lane does not use them"
    }
  };
  record.complete = record.model.complete && record.provider.complete;
  record.id = stableRecordId(record);
  return record;
}

export function parseCostLedger(comment, marker) {
  if (!comment) return { version: 1, records: [] };
  const body = String(comment.body ?? "");
  if (!(body === marker || body.startsWith(`${marker}\n`))) {
    throw new AgentError("cost ledger marker is invalid", 1);
  }
  const value = extractJson(body.slice(marker.length));
  if (value?.version !== 1 || !Array.isArray(value.records) || value.records.length > MAX_RECORDS) {
    throw new AgentError("cost ledger is invalid", 1);
  }
  for (const record of value.records) {
    if (
      !/^[a-f0-9]{64}$/.test(String(record?.id ?? "")) ||
      !LANES.has(record?.lane) ||
      !/^[a-f0-9]{40}$/.test(String(record?.headSha ?? "")) ||
      typeof record?.complete !== "boolean"
    ) {
      throw new AgentError("cost ledger record is invalid", 1);
    }
  }
  return value;
}

export function mergeCostRecord(ledger, record) {
  const records = [...ledger.records.filter((item) => item.id !== record.id), record]
    .sort((left, right) => Date.parse(left.recordedAt) - Date.parse(right.recordedAt))
    .slice(-MAX_RECORDS);
  return { version: 1, records };
}

function latestIssueRecords(ledger, headSha) {
  const records = ledger.records;
  return [...LANES].flatMap((lane) => {
    // Implementation runs once before repair heads exist. Later semantic and
    // proof lanes must be fresh for the current head; their prior costs remain
    // in the issue ledger but cannot satisfy the exact-head cost status.
    const eligible =
      lane === "implement"
        ? records.filter((item) => item.lane === lane)
        : records.filter(
            (item) => item.lane === lane && item.headSha === headSha
          );
    const record = newestDate(
      eligible,
      ["recordedAt"]
    );
    return record ? [record] : [];
  });
}

export function expectedCostLanes(config, { pull, metadata, pullLabels, sourceLabels }) {
  const expected = ["implement", "review"];
  if (
    !skipsNoMistakesForCost(config, {
      metadata,
      pullLabels,
      sourceLabels
    })
  ) {
    expected.push("no-mistakes");
  }
  if ([...pullLabels, ...sourceLabels].includes(config.labels.proof)) expected.push("proof");
  return expected;
}

export function costState(config, ledger, context) {
  const expected = expectedCostLanes(config, context);
  const latest = latestIssueRecords(ledger, context.pull.head.sha);
  const byLane = new Map(latest.map((record) => [record.lane, record]));
  const incomplete = expected.filter((lane) => byLane.has(lane) && !byLane.get(lane).complete);
  const missing = expected.filter((lane) => !byLane.has(lane));
  return {
    state: incomplete.length ? "failure" : missing.length ? "pending" : "success",
    headSha: context.pull.head.sha,
    expected,
    missing,
    incomplete,
    records: latest
  };
}

export function costTotals(records) {
  return {
    modelEstimatedUsd: roundUsd(
      records.reduce((sum, record) => sum + (record.model?.totals?.estimatedUsd ?? 0), 0)
    ),
    providerEstimatedUsd: roundUsd(
      records.reduce(
        (sum, record) =>
          sum +
          (typeof record.provider?.estimatedIncrementalUsd === "number"
            ? record.provider.estimatedIncrementalUsd
            : 0),
        0
      )
    ),
    inputTokens: records.reduce((sum, record) => sum + (record.model?.totals?.inputTokens ?? 0), 0),
    cachedInputTokens: records.reduce(
      (sum, record) => sum + (record.model?.totals?.cachedInputTokens ?? 0),
      0
    ),
    outputTokens: records.reduce((sum, record) => sum + (record.model?.totals?.outputTokens ?? 0), 0),
    actionsObservedJobMinutes: records.reduce(
      (sum, record) => sum + (record.githubActions?.observedJobMinutes ?? 0),
      0
    )
  };
}

export function costCommentBody(ledger, state) {
  const records = ledger.records;
  const totals = costTotals(records);
  const laneSummary = [...LANES]
    .map((lane) => {
      const laneRecords = records.filter((record) => record.lane === lane);
      if (!laneRecords.length) return "";
      const laneTotals = costTotals(laneRecords);
      const unpriced = laneRecords.some(
        (record) => record.provider.attempted && record.provider.estimatedIncrementalUsd === null
      );
      return `- ${lane}: ${laneRecords.length} call set(s), model $${laneTotals.modelEstimatedUsd.toFixed(6)}, provider ${
        unpriced ? "unpriced" : `$${laneTotals.providerEstimatedUsd.toFixed(6)}`
      }, ${laneTotals.inputTokens}/${laneTotals.outputTokens} input/output tokens`;
    })
    .filter(Boolean)
    .join("\n");
  return `Cost state: ${state.state}
Exact head: \`${state.headSha ?? "pending"}\`
Model estimate: $${totals.modelEstimatedUsd.toFixed(6)}
Provider estimate: $${totals.providerEstimatedUsd.toFixed(6)}
GitHub Actions observed job minutes: ${totals.actionsObservedJobMinutes} (${records[0]?.githubActions?.billing ?? "pending"})
Manual comparison: not claimed; no measured human baseline was supplied.
Fixed subscriptions: recorded separately and not allocated to this issue.
${state.missing.length ? `Missing lanes: ${state.missing.join(", ")}\n` : ""}
${state.incomplete.length ? `Incomplete lanes: ${state.incomplete.join(", ")}\n` : ""}
${laneSummary || "- no completed lane records"}

Structured cost ledger:
${markdownJsonBlock(ledger)}`;
}

function issue(config, number) {
  return ghApiJson(`repos/${config.repo.owner}/${config.repo.name}/issues/${number}`);
}

export function recordCost(config, options, dependencies = {}) {
  const pull = options.pull ?? getPullRequest(config, options.prNumber);
  const pullIssue = options.pullIssue ?? issue(config, options.prNumber);
  const metadata = parseImplementationMetadata(pull.body);
  const sourceIssue = options.sourceIssue ?? issue(config, metadata.sourceIssue);
  const comments = (dependencies.getIssueComments ?? getIssueComments)(config, metadata.sourceIssue);
  const existing = newestManagedComment(comments, config.comments.cost, config.repo.owner);
  const ledger = mergeCostRecord(parseCostLedger(existing, config.comments.cost), options.record);
  const context = {
    pull,
    metadata,
    pullLabels: issueLabels(pullIssue),
    sourceLabels: issueLabels(sourceIssue)
  };
  const state = costState(config, ledger, context);
  const comment = (dependencies.upsertManagedComment ?? upsertManagedComment)({
    config,
    number: metadata.sourceIssue,
    marker: config.comments.cost,
    body: costCommentBody(ledger, state),
    dryRun: Boolean(options.dryRun)
  });
  const status = (dependencies.setCommitStatus ?? setCommitStatus)({
    config,
    sha: pull.head.sha,
    state: state.state,
    context: config.cost.status,
    description:
      state.state === "success"
        ? "complete model and provider cost record"
        : state.state === "pending"
          ? `waiting for cost lanes: ${state.missing.join(", ")}`.slice(0, 140)
          : `incomplete cost lanes: ${state.incomplete.join(", ")}`.slice(0, 140),
    targetUrl: actionsRunUrl(config),
    dryRun: Boolean(options.dryRun)
  });
  return { ledger, state, comment, status, sourceIssue: metadata.sourceIssue };
}

function readJson(path) {
  return JSON.parse(readFileSync(resolve(path), "utf8"));
}

export async function main() {
  const args = parseArgs();
  const config = loadConfig();
  const lane = String(args.lane ?? "");
  const prNumber = Number(args["pr-number"]);
  if (!Number.isInteger(prNumber) || prNumber <= 0) throw new AgentError("missing --pr-number", 2);
  const pull = getPullRequest(config, prNumber);
  const headSha = String(args["head-sha"] ?? pull.head.sha);
  const modelUsage = args["usage-file"] ? readJson(args["usage-file"]) : null;
  const proofRemote =
    lane === "proof"
      ? args["proof-outcome-file"]
        ? proofOutcomeRecord(readJson(args["proof-outcome-file"]))
        : proofRemoteRecord(args["proof-remote-outcome-base64"], args["proof-local-outcome-base64"])
      : null;
  const remoteRecord = args["remote-record"]
    ? readJson(args["remote-record"])
    : proofRemote?.record ?? null;
  const runId = String(process.env.GITHUB_RUN_ID ?? "");
  const record = buildCostRecord(config, {
    lane,
    headSha,
    modelUsage,
    remoteRecord,
    remoteLane: String(args["remote-lane"] ?? proofRemote?.lane ?? ""),
    retryReason: args["retry-reason"],
    effect: String(args.effect ?? "decision"),
    githubActions: actionsUsage(config, runId)
  });
  const result = recordCost(config, {
    prNumber,
    pull,
    record,
    dryRun: Boolean(args["dry-run"])
  });
  finish(
    {
      ok: result.state.state !== "failure",
      message: `recorded ${lane} cost for PR #${prNumber}`,
      record,
      state: result.state
    },
    Boolean(args.json),
    result.state.state === "failure" ? 1 : 0
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => fail(error, Boolean(parseArgs().json)));
}
