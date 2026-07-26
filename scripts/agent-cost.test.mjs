import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCostRecord,
  costCommentBody,
  costState,
  costTotals,
  mergeCostRecord,
  parseCostLedger,
  priceModelUsage,
  priceProviderUsage,
  proofOutcomeRecord,
  proofRemoteRecord,
  recordCost,
  validateRemoteRecord,
  validateModelUsage
} from "./agent-cost.mjs";

const headSha = "a".repeat(40);
const config = {
  repo: { owner: "owner", name: "repo" },
  backend: { model: "gpt-5.4-mini", effort: "low" },
  labels: { proof: "agent:proof", priorityTrivial: "priority:trivial" },
  comments: { cost: "<!-- agent-cost:v1 -->" },
  cost: {
    status: "agent-cost",
    authenticationMode: "metered-api",
    modelPricing: {
      version: "openai-2026-03-17",
      source: "https://example.test/openai",
      models: {
        "gpt-5.4-mini": {
          inputPerMillionUsd: 0.75,
          cachedInputPerMillionUsd: 0.075,
          outputPerMillionUsd: 4.5
        }
      }
    },
    vercelSandboxPricing: {
      version: "vercel-2026-07-24",
      source: "https://example.test/vercel",
      defaultVcpus: 2,
      memoryGbPerVcpu: 2,
      activeCpuPerHourUsd: 0.128,
      memoryPerGbHourUsd: 0.0212,
      creationPerMillionUsd: 0.6
    },
    hetznerCloudPricing: {
      version: "hetzner-2026-06-15",
      source: "https://example.test/hetzner",
      billingSource: "https://example.test/hetzner-billing",
      machineClass: "beast",
      location: "fsn1",
      fallbackTypes: ["ccx63", "ccx53", "ccx43", "cpx62", "cx53"],
      maximumServerPerHourUsd: 1.6138,
      primaryIpv4PerHourUsd: 0.001,
      billingIncrementHours: 1
    }
  },
  crabbox: {
    nonVisualProviders: ["vercel-sandbox", "hetzner"],
    visualProviders: ["local-container"]
  }
};

function usage(lane) {
  return {
    version: 1,
    backend: "codex",
    lane,
    model: "gpt-5.4-mini",
    effort: "low",
    complete: true,
    calls: [
      {
        id: lane.padEnd(64, "a").slice(0, 64).replace(/[^a-f0-9]/g, "a"),
        inputTokens: 1000,
        cachedInputTokens: 600,
        outputTokens: 100,
        reasoningOutputTokens: 50
      }
    ]
  };
}

function remote(lane = "implementRemote", provider = "vercel-sandbox") {
  return {
    ok: true,
    attempted: true,
    lane,
    provider,
    leaseId: `${provider === "hetzner" ? "hcloud" : "vsbx"}_${lane}`,
    timing: {
      provider,
      leaseId: `${provider === "hetzner" ? "hcloud" : "vsbx"}_${lane}`,
      totalMs: 60_000,
      exitCode: 0
    }
  };
}

function record(lane) {
  return buildCostRecord(config, {
    lane,
    headSha,
    modelUsage: usage(lane),
    remoteRecord: remote(`${lane === "no-mistakes" ? "noMistakes" : lane}Remote`),
    remoteLane: `${lane === "no-mistakes" ? "noMistakes" : lane}Remote`,
    retryReason: "initial",
    effect: lane === "implement" ? "new-head" : "decision",
    githubActions: {
      runId: "42",
      observedJobMinutes: 3,
      billing: "included-public-repository",
      estimatedUsd: 0
    },
    now: new Date("2026-07-24T10:00:00Z")
  });
}

test("model pricing separates uncached, cached, and output tokens", () => {
  const priced = priceModelUsage(config, validateModelUsage(usage("implement"), "implement"));

  assert.equal(priced.calls[0].uncachedInputTokens, 400);
  assert.equal(priced.totals.inputTokens, 1000);
  assert.equal(priced.totals.cachedInputTokens, 600);
  assert.equal(priced.totals.outputTokens, 100);
  assert.equal(priced.totals.estimatedUsd, 0.000795);
});

test("Vercel estimate records a conservative upper bound and explicit network exclusion", () => {
  const priced = priceProviderUsage(config, remote());

  assert.equal(priced.provider, "vercel-sandbox");
  assert.equal(priced.assumptions.vcpus, 2);
  assert.equal(priced.assumptions.memoryGb, 4);
  assert.equal(priced.estimateKind, "upper-bound-active-cpu-plus-memory-and-creation");
  assert.match(priced.networkCost, /excluded/);
  assert.ok(priced.estimatedIncrementalUsd > 0);
});

test("Hetzner estimate uses the pinned beast-class ceiling and hourly rounding", () => {
  const priced = priceProviderUsage(
    config,
    remote("implementRemote", "hetzner")
  );

  assert.equal(priced.complete, true);
  assert.equal(priced.provider, "hetzner");
  assert.equal(priced.assumptions.billableHours, 1);
  assert.equal(priced.estimatedIncrementalUsd, 1.6148);
  assert.match(priced.storageCost, /included/);
  assert.match(priced.networkCost, /excluded/);
});

test("terminal failures retain priced provider timing and fail the cost gate", () => {
  const failedRemote = {
    ...remote("reviewRemote"),
    ok: false,
    remoteCommandStarted: true,
    timing: {
      ...remote("reviewRemote").timing,
      exitCode: 1,
      runStatus: "failed"
    }
  };
  assert.throws(
    () => validateRemoteRecord(config, failedRemote, "reviewRemote"),
    /Crabbox cost provenance is invalid/
  );

  const failed = buildCostRecord(config, {
    lane: "review",
    headSha,
    remoteRecord: failedRemote,
    remoteLane: "reviewRemote",
    retryReason: "review workflow failure",
    effect: "none",
    githubActions: {
      runId: "43",
      observedJobMinutes: 2,
      billing: "included-public-repository",
      estimatedUsd: 0
    },
    terminalFailure: true,
    model: "gpt-5.4-mini",
    effort: "medium",
    now: new Date("2026-07-24T10:01:00Z")
  });

  assert.equal(failed.complete, false);
  assert.equal(failed.terminalFailure, true);
  assert.equal(failed.model.attempted, false);
  assert.equal(failed.model.effort, "medium");
  assert.equal(failed.provider.outcome, "failed");
  assert.equal(failed.provider.leaseId, failedRemote.leaseId);
  assert.ok(failed.provider.estimatedIncrementalUsd > 0);
});

test("terminal cost reporting survives provider acquisition without timing", () => {
  const acquisitionFailure = {
    ok: false,
    attempted: true,
    lane: "reviewRemote",
    provider: "vercel-sandbox",
    leaseId: "",
    timing: null,
    remoteCommandStarted: false,
    reason: "provider acquisition failed"
  };
  const failed = buildCostRecord(config, {
    lane: "review",
    headSha,
    remoteRecord: acquisitionFailure,
    remoteLane: "reviewRemote",
    retryReason: "review workflow failure",
    effect: "none",
    githubActions: {
      runId: "44",
      observedJobMinutes: 1,
      billing: "included-public-repository",
      estimatedUsd: 0
    },
    terminalFailure: true,
    now: new Date("2026-07-24T10:02:00Z")
  });

  assert.equal(failed.complete, false);
  assert.equal(failed.provider.attempted, true);
  assert.equal(failed.provider.complete, false);
  assert.equal(failed.provider.estimatedIncrementalUsd, null);
  assert.equal(
    failed.provider.estimateKind,
    "terminal-failure-provenance-incomplete"
  );
});

test("proof cost accepts only a passing terminal outcome and actual provider provenance", () => {
  const outcome = {
    terminal: true,
    result: {
      proofKind: "GIF",
      status: "passed",
      provider: "local-container",
      leaseId: "local_123"
    },
    timing: {
      provider: "local-container",
      leaseId: "local_123",
      totalMs: 12_000,
      exitCode: 0
    }
  };
  const encoded = Buffer.from(JSON.stringify(outcome)).toString("base64");
  const value = proofRemoteRecord(encoded, "");

  assert.equal(value.lane, "gifProof");
  assert.equal(value.record.provider, "local-container");
  assert.deepEqual(proofOutcomeRecord(outcome), value);
  assert.throws(
    () =>
      proofRemoteRecord(
        Buffer.from(JSON.stringify({ terminal: true, result: { status: "failed" } })).toString("base64"),
        ""
      ),
    /no passing proof outcome/
  );
});

test("cost state requires one complete record per policy lane on the exact head", () => {
  let ledger = { version: 1, records: [] };
  for (const lane of ["implement", "review"]) ledger = mergeCostRecord(ledger, record(lane));
  const pull = { head: { sha: headSha }, labels: [], body: "" };
  const metadata = { automergeEligible: true };
  const pending = costState(config, ledger, {
    pull,
    metadata,
    pullLabels: [],
    sourceLabels: []
  });
  assert.equal(pending.state, "pending");
  assert.deepEqual(pending.missing, ["no-mistakes"]);

  ledger = mergeCostRecord(ledger, record("no-mistakes"));
  const ready = costState(config, ledger, {
    pull,
    metadata,
    pullLabels: [],
    sourceLabels: []
  });
  assert.equal(ready.state, "success");
  assert.equal(costTotals(ready.records).actionsObservedJobMinutes, 9);
  assert.match(costCommentBody(ledger, ready), /Manual comparison: not claimed/);

  const repairedHead = "b".repeat(40);
  const stale = costState(config, ledger, {
    pull: { head: { sha: repairedHead }, labels: [], body: "" },
    metadata,
    pullLabels: [],
    sourceLabels: []
  });
  assert.equal(stale.state, "pending");
  assert.deepEqual(stale.missing, ["review", "no-mistakes"]);
  assert.equal(stale.records.some((item) => item.lane === "implement"), true);

  ledger = mergeCostRecord(ledger, record("proof"));
  const staleProof = costState(config, ledger, {
    pull: { head: { sha: repairedHead }, labels: [], body: "" },
    metadata,
    pullLabels: ["agent:proof"],
    sourceLabels: []
  });
  assert.deepEqual(staleProof.missing, ["review", "no-mistakes", "proof"]);
});

test("proof label adds a separate provider or model cost lane", () => {
  let ledger = { version: 1, records: [] };
  for (const lane of ["implement", "review", "no-mistakes"]) {
    ledger = mergeCostRecord(ledger, record(lane));
  }
  const state = costState(config, ledger, {
    pull: { head: { sha: headSha } },
    metadata: { automergeEligible: true },
    pullLabels: ["agent:proof"],
    sourceLabels: []
  });

  assert.equal(state.state, "pending");
  assert.deepEqual(state.missing, ["proof"]);
});

test("managed cost ledger is strict, idempotent, and bounded", () => {
  const value = mergeCostRecord({ version: 1, records: [] }, record("implement"));
  const comment = {
    body: `${config.comments.cost}\nStructured:\n\`\`\`json\n${JSON.stringify(value)}\n\`\`\``
  };

  assert.deepEqual(parseCostLedger(comment, config.comments.cost), value);
  assert.equal(mergeCostRecord(value, value.records[0]).records.length, 1);
  assert.throws(
    () => parseCostLedger({ body: `${config.comments.cost}\n{"version":2,"records":[]}` }, config.comments.cost),
    /cost ledger is invalid/
  );
});

test("recordCost reconciles one source issue comment and exact-head status", () => {
  const implementation = record("implement");
  const pull = {
    head: { sha: headSha },
    labels: [],
    body: `<!-- agent-implementation:v1 -->
Agent implementation metadata:
\`\`\`json
${JSON.stringify({
      sourceIssue: 12,
      issueSnapshotSha256: "b".repeat(64),
      intentDigest: "c".repeat(64),
      implementationAddendumDigest: "d".repeat(64),
      automergeEligible: true,
      sourceLabels: []
    })}
\`\`\``
  };
  let comment;
  let status;
  const result = recordCost(config, {
    prNumber: 7,
    pull,
    pullIssue: pull,
    sourceIssue: { number: 12, labels: [] },
    record: implementation
  }, {
    getIssueComments() {
      return [];
    },
    upsertManagedComment(value) {
      comment = value;
      return { ok: true };
    },
    setCommitStatus(value) {
      status = value;
      return { ok: true };
    }
  });

  assert.equal(result.sourceIssue, 12);
  assert.equal(comment.number, 12);
  assert.equal(status.sha, headSha);
  assert.equal(status.context, "agent-cost");
  assert.equal(status.state, "pending");
});
