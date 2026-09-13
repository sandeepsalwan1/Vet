import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  implementationCommitMessage,
  issueSnapshotSha256,
  parseImplementationMetadata,
} from "./agent-lib.mjs";

import {
  assertTrustedAgentPull,
  assertTrustedIntentSource,
  composeEffectiveIntent,
  gateEnvironment,
  gateLabelChanges,
  gateCommentBody,
  noMistakesReplayState,
  noMistakesConfig,
  parseNoMistakesUsageStats,
  noMistakesCommentMarker,
  resolvePullMergeBase,
  resolveTrustedDefaultCommit,
  repairLedgerOutcome,
  runNoMistakesGate,
  selectTrustedManagedTriageComment,
  setupFailureRecoveryEligible,
  setupFailureArtifact,
  terminalHeadBinding,
  validateNoMistakesRemoteRecord,
  writeCodexTurnMarkerWrapper,
  writeSetupFailureResult,
} from "./agent-no-mistakes-gate.mjs";
import {
  gateRepairDecision,
  isReattachableAxiError,
  isRetryableInvalidOutput,
  isRetryableReviewEnvironmentBlock,
  isRetryableTechnicalFailure,
  isRetryableTestEnvironmentBlock,
  normalizeGateArtifact,
  parseAxiResult,
  sanitizedGateArtifact,
  validatedHeadMatches,
} from "./agent-no-mistakes-result.mjs";

const HEAD = "abcdef1234567890abcdef1234567890abcdef12";
const config = {
  repo: { owner: "owner", name: "repo", defaultBranch: "main" },
  comments: { gate: "<!-- agent-gate:v1 -->" },
  crabbox: { nonVisualProviders: ["vercel-sandbox", "hetzner"] },
};
const safeFiles = [{ filename: "apps/internal/src/app/page.tsx" }];

test("no-mistakes runs in Crabbox and publishes only a sealed trusted handoff", () => {
  const workflow = readFileSync(new URL("../.github/workflows/agent-no-mistakes.yml", import.meta.url), "utf8");
  const automergeWorkflow = readFileSync(new URL("../.github/workflows/agent-automerge.yml", import.meta.url), "utf8");
  const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const gate = readFileSync(new URL("./agent-no-mistakes-gate.mjs", import.meta.url), "utf8");
  const nativeFix = readFileSync(
    new URL("./agent-no-mistakes-native-fix.mjs", import.meta.url),
    "utf8",
  );
  const review = readFileSync(new URL("./agent-review.mjs", import.meta.url), "utf8");

  assert.match(workflow, /--validate-backend --lane no-mistakes --json/);
  assert.match(workflow, /--lane noMistakesRemote/);
  assert.match(
    workflow,
    /prepare:\n[\s\S]*?permissions:\n[\s\S]*?issues: write/,
  );
  assert.match(workflow, /--stage-input-lane noMistakesRemote/);
  assert.match(
    workflow,
    /--prepare-delegated-workspace "\$RUNNER_TEMP\/agent-no-mistakes-workspace"/
  );
  assert.match(workflow, /--restore-input-lane noMistakesRemote/);
  assert.ok(
    workflow.indexOf("--restore-input-lane noMistakesRemote") <
      workflow.indexOf("cd candidate;")
  );
  assert.match(workflow, /uses: \.\/trusted\/\.github\/actions\/setup-crabbox/);
  assert.match(workflow, /node trusted\/scripts\/agent-crabbox-run\.mjs/);
  assert.match(workflow, /export AGENT_TARGET_ROOT="\$PWD"/);
  assert.match(workflow, /node \.\.\/trusted\/scripts\/agent-no-mistakes-gate\.mjs/);
  assert.match(workflow, /node \.\.\/trusted\/scripts\/agent-crabbox-run\.mjs/);
  assert.match(
    workflow,
    /--workdir "\$RUNNER_TEMP\/agent-no-mistakes-workspace"/
  );
  assert.match(
    workflow,
    /--delegated-workdir "\$RUNNER_TEMP\/agent-no-mistakes-workspace\/candidate"/
  );
  assert.match(workflow, /--remote-harness trusted\/scripts\/agent-crabbox-run\.mjs/);
  assert.match(
    workflow,
    /--record-file "\$RUNNER_TEMP\/agent-no-mistakes-workspace\/candidate\/\.agent-output\/no-mistakes-remote\.json"/
  );
  assert.match(
    workflow,
    /merge_base_sha: \$\{\{ steps\.prepare\.outputs\.merge_base_sha \}\}/,
  );
  assert.match(
    workflow,
    /merge_base_tree: \$\{\{ steps\.prepare\.outputs\.merge_base_tree \}\}/,
  );
  assert.match(
    workflow,
    /default_tree: \$\{\{ steps\.prepare\.outputs\.default_tree \}\}/,
  );
  assert.match(workflow, /head_tree: \$\{\{ steps\.prepare\.outputs\.head_tree \}\}/);
  assert.match(workflow, /--create-exact-parent-bundle/);
  assert.match(
    workflow,
    /--parent-sha "\$\{\{ needs\.prepare\.outputs\.merge_base_sha \}\}"/,
  );
  assert.match(
    workflow,
    /--default-sha "\$\{\{ needs\.prepare\.outputs\.default_sha \}\}"/,
  );
  assert.match(
    workflow,
    /--seed-exact-repository[\s\S]*?--expected-tree "\$expected_tree"[\s\S]*?--branch "\$head_ref"/,
  );
  assert.match(workflow, /--origin-bundle "\$origin_bundle"/);
  assert.match(workflow, /--expected-parent-tree "\$expected_parent_tree"/);
  assert.match(workflow, /--expected-default-tree "\$expected_default_tree"/);
  assert.match(workflow, /--default-branch "\$default_branch"/);
  assert.doesNotMatch(workflow, /https:\/\/github\.com\/\$\{\{ github\.repository \}\}\.git/);
  assert.match(workflow, /--expected-source-tree "\$expected_tree"/);
  assert.match(workflow, /--intent-file \.agent-output\/no-mistakes-intent/);
  assert.match(workflow, /--model-started-file "\$model_started_file"/);
  assert.match(workflow, /--write-codex-wrapper/);
  assert.match(
    workflow,
    /--agent-path \/tmp\/no-mistakes-home\/codex-turn-marker/,
  );
  assert.match(workflow, /trap preserve_setup_failure EXIT/);
  assert.match(workflow, /--write-setup-failure/);
  assert.doesNotMatch(workflow, /\n\s+--write-setup-failure/);
  assert.doesNotMatch(workflow, /\n\s+--emit-output-lane noMistakesRemote/);
  assert.match(
    workflow,
    /if node \.\.\/trusted\/scripts\/agent-no-mistakes-gate\.mjs[\s\S]*?--write-setup-failure[\s\S]*?--emit-output-lane noMistakesRemote; then[\s\S]*?exit 0;/,
  );
  assert.match(
    workflow,
    /name: Classify isolated setup[\s\S]*?setup-failed\|model-interrupted\) exit 1/,
  );
  assert.match(
    workflow,
    /steps\.gate\.outcome != 'success' \|\|[\s\S]*?steps\.classify-setup\.outcome != 'success'/,
  );
  assert.match(workflow, /--approval-state "\$\{\{ inputs\.approval \}\}"/);
  assert.match(
    workflow,
    /needs\.prepare\.outputs\.skip_model == 'true'[\s\S]*?needs\.prepare\.outputs\.replay_passed == 'true'/,
  );
  assert.match(
    workflow,
    /approval:\n\s+description: User approved unattended gate decisions for this exact head/,
  );
  assert.match(
    workflow,
    /if \[ "\$\{\{ inputs\.approval \}\}" = "true" \]; then approval_flag="--user-approved"; fi/,
  );
  assert.match(workflow, /export CODEX_API_KEY="\$agent_key";/);
  assert.match(workflow, /export NM_HOME=\/tmp\/no-mistakes-home;/);
  assert.match(
    workflow,
    /name: Validate approval authority\n\s+if: \$\{\{ inputs\.approval \}\}[\s\S]*?test "\$\{APPROVAL_ACTOR,,\}" = "\$\{REPOSITORY_OWNER,,\}"/,
  );
  assert.match(workflow, /@openai\/codex@0\.144\.1/);
  assert.match(workflow, /v1\.40\.0\/no-mistakes-v1\.40\.0-linux-amd64\.tar\.gz/);
  assert.match(workflow, /--write-config \/tmp\/no-mistakes-home\/config\.yaml/);
  assert.match(workflow, /npm run typecheck &&\n\s+npm run build &&\n\s+npm run test:scenarios/);
  assert.ok(
    workflow.indexOf("npm run test:scenarios") <
      workflow.indexOf('CODEX_API_KEY="$agent_key"'),
  );
  assert.match(
    workflow,
    /path: \|\n\s+\$\{\{ runner\.temp \}\}\/agent-no-mistakes-workspace\/candidate\/\.agent-output\/result\.json\n\s+\$\{\{ runner\.temp \}\}\/agent-no-mistakes-workspace\/candidate\/\.agent-output\/fix\.patch\n\s+\$\{\{ runner\.temp \}\}\/agent-no-mistakes-workspace\/candidate\/\.agent-output\/model-usage\.json\n\s+\$\{\{ runner\.temp \}\}\/agent-no-mistakes-workspace\/candidate\/\.agent-output\/no-mistakes-remote\.json/,
  );
  assert.match(workflow, /--remote-record "\$RUNNER_TEMP\/no-mistakes-result\/no-mistakes-remote\.json"/);
  assert.match(gate, /"--skip",\s+"rebase,test,document,lint,push,pr,ci"/);
  assert.doesNotMatch(workflow, /git config --global user\./);
  assert.match(workflow, /--fix-patch "\$RUNNER_TEMP\/no-mistakes-result\/fix\.patch"/);
  assert.match(nativeFix, /--force-with-lease/);
  assert.match(workflow, /dispatch-native-fix:/);
  assert.match(workflow, /gh workflow run agent-automerge\.yml/);
  assert.match(workflow, /--repo "\$GITHUB_REPOSITORY"/);
  assert.match(workflow, /-f pr-number="\$\{\{ inputs\.pr-number \}\}"/);
  assert.match(workflow, /-f expected-head-sha="\$\{\{ needs\.prepare\.outputs\.head_sha \}\}"/);
  assert.doesNotMatch(workflow, /gh workflow run agent-proof\.yml/);
  assert.match(review, /const proofRequested =/);
  assert.match(review, /sourceLabels\.includes\(config\.labels\.proof\)/);
  assert.match(review, /cycle\.state === "ready" && proofRequested && !dryRun/);
  assert.match(workflow, /dispatch-automerge:\n[\s\S]*?needs:\n\s+- prepare\n\s+- finalize/);
  assert.match(workflow, /repair-attempt:/);
  assert.match(workflow, /dispatch-repair:\n[\s\S]*?gh workflow run agent-review\.yml/);
  assert.match(
    workflow,
    /-f repair-attempt="\$\{\{ needs\.finalize\.outputs\.next-repair-attempt \}\}"/,
  );
  assert.match(workflow, /group: agent-semantic-\$\{\{ inputs\.pr-number \}\}/);
  assert.match(workflow, /needs\.finalize\.outputs\.repair-action == 'retry'/);
  assert.doesNotMatch(workflow, /retry-infrastructure:/);
  assert.doesNotMatch(workflow, /-f infrastructure-retry=1/);
  assert.match(workflow, /test "\$current_head" = "\$HEAD_SHA"/);
  assert.match(workflow, /--expected-head "\$\{\{ inputs\.expected-head-sha \}\}"/);
  assert.match(workflow, /--repair-attempt "\$\{\{ inputs\.repair-attempt \}\}"/);
  assert.doesNotMatch(automergeWorkflow, /- Agent no-mistakes/);
  assert.equal(packageJson.scripts["lint:dead"], "knip --treat-config-hints-as-errors");
  assert.equal(packageJson.scripts["lint:duplicates"], "jscpd");
  assert.equal(packageJson.devDependencies.knip, "^6.26.0");
  assert.equal(packageJson.devDependencies.jscpd, "^5.0.12");
  assert.match(gate, /"--untracked-files=all"/);
  assert.match(gate, /createNativeFixPatch/);
});

test("remote synthetic parent is the immutable pull-request merge base", () => {
  const baseTip = "1".repeat(40);
  const mergeBase = "2".repeat(40);
  const head = "3".repeat(40);
  const mergeBaseTree = "4".repeat(40);
  const requestedPaths = [];
  const resolved = resolvePullMergeBase(
    config,
    { base: { sha: baseTip }, head: { sha: head } },
    {
      ghApiJson: (path) => {
        requestedPaths.push(path);
        if (path.includes("/compare/")) {
          return { merge_base_commit: { sha: mergeBase } };
        }
        return { sha: mergeBase, tree: { sha: mergeBaseTree } };
      },
    },
  );

  assert.deepEqual(resolved, { sha: mergeBase, tree: mergeBaseTree });
  assert.deepEqual(requestedPaths, [
    `repos/owner/repo/compare/${baseTip}...${head}`,
    `repos/owner/repo/git/commits/${mergeBase}`,
  ]);
  assert.throws(
    () =>
      resolvePullMergeBase(
        config,
        { base: { sha: baseTip }, head: { sha: head } },
        { ghApiJson: () => ({ merge_base_commit: { sha: "invalid" } }) },
      ),
    /no exact merge base/,
  );
});

test("remote bundle trusts the current exact default-branch tree", () => {
  const sha = "5".repeat(40);
  const tree = "6".repeat(40);
  const requestedPaths = [];
  const resolved = resolveTrustedDefaultCommit(config, {
    ghApiJson: (path) => {
      requestedPaths.push(path);
      if (path.endsWith("/commits/main")) return { sha };
      return { sha, tree: { sha: tree } };
    },
  });

  assert.deepEqual(resolved, { branch: "main", sha, tree });
  assert.deepEqual(requestedPaths, [
    "repos/owner/repo/commits/main",
    `repos/owner/repo/git/commits/${sha}`,
  ]);
});

test("cached no-mistakes results resume only a passing gate", () => {
  assert.deepEqual(noMistakesReplayState(null), {
    skipModel: false,
    replayPassed: false,
  });
  assert.deepEqual(noMistakesReplayState({ outcome: "passed-proven" }), {
    skipModel: true,
    replayPassed: true,
  });
  assert.deepEqual(noMistakesReplayState({ outcome: "checks-passed" }), {
    skipModel: false,
    replayPassed: false,
  });
  assert.deepEqual(noMistakesReplayState({ outcome: "ask-user" }), {
    skipModel: true,
    replayPassed: false,
  });
  assert.deepEqual(noMistakesReplayState({ outcome: "setup-failed" }), {
    skipModel: false,
    replayPassed: false,
  });
  assert.deepEqual(noMistakesReplayState({ outcome: "passed-recovered" }), {
    skipModel: true,
    replayPassed: true,
  });
  assert.equal(
    repairLedgerOutcome({ status: "passed", outcome: "passed" }),
    "passed-proven",
  );
  assert.equal(
    repairLedgerOutcome({ status: "failed", outcome: "passed" }),
    "failed",
  );
});

test("same-head setup recovery restores only inherited automerge once", () => {
  const head = "7".repeat(40);
  const inputDigest = "8".repeat(64);
  const findingDigest = "9".repeat(64);
  const ledger = {
    version: 1,
    intentDigest: "a".repeat(64),
    revisionCount: 0,
    revisions: [],
    evaluations: [{
      lane: "no-mistakes",
      head,
      inputDigest,
      findingDigest,
      outcome: "setup-failed",
    }],
    findings: [],
  };
  const recoveryConfig = {
    labels: { automerge: "agent:automerge" },
  };
  const sourceIssue = { labels: [{ name: "agent:automerge" }] };
  const eligible = (currentLedger) =>
    setupFailureRecoveryEligible({
      config: recoveryConfig,
      ledger: currentLedger,
      head,
      inputDigest,
      passProven: true,
      sourceIssue,
    });

  assert.equal(eligible(ledger), true);
  assert.equal(
    setupFailureRecoveryEligible({
      config: recoveryConfig,
      ledger,
      head,
      inputDigest,
      passProven: false,
      sourceIssue,
    }),
    false,
  );
  ledger.evaluations.push({
    lane: "no-mistakes",
    head,
    inputDigest,
    findingDigest,
    outcome: "passed",
  });
  assert.equal(eligible(ledger), true);
  ledger.evaluations.push({
    lane: "no-mistakes",
    head,
    inputDigest,
    findingDigest,
    outcome: "passed-recovered",
  });
  assert.equal(eligible(ledger), false);
  assert.equal(
    setupFailureRecoveryEligible({
      config: recoveryConfig,
      ledger: { ...ledger, evaluations: ledger.evaluations.slice(0, 2) },
      head,
      inputDigest,
      passProven: true,
      sourceIssue: { labels: [] },
    }),
    false,
  );
});

test("early no-mistakes setup failures produce terminal sanitized artifacts", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "vet-no-mistakes-setup-"));
  const resultFile = join(dir, "result.json");
  const usageFile = join(dir, "usage.json");
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const written = writeSetupFailureResult({
    expectedHead: HEAD,
    resultFile,
    usageFile,
    model: "gpt-5.4-mini",
    effort: "medium",
  });
  assert.deepEqual(written.artifact, setupFailureArtifact(HEAD));
  assert.equal(JSON.parse(readFileSync(resultFile)).outcome, "setup-failed");
  assert.deepEqual(JSON.parse(readFileSync(usageFile)).calls, []);
});

test("interrupted started model is terminal and usage-incomplete", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "vet-no-mistakes-interrupted-"));
  const resultFile = join(dir, "result.json");
  const usageFile = join(dir, "usage.json");
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const written = writeSetupFailureResult({
    expectedHead: HEAD,
    resultFile,
    usageFile,
    model: "gpt-5.4-mini",
    effort: "medium",
    modelStarted: true,
  });
  assert.equal(written.artifact.outcome, "model-interrupted");
  assert.equal(
    normalizeGateArtifact(written.artifact, HEAD).outcome,
    "model-interrupted",
  );
  assert.equal(JSON.parse(readFileSync(usageFile)).complete, false);
  assert.deepEqual(noMistakesReplayState({ outcome: "model-interrupted" }), {
    skipModel: true,
    replayPassed: false,
  });
});

test("model start marker follows Codex turn start, not process startup", { timeout: 5_000 }, async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "vet-codex-turn-marker-"));
  const codexPath = join(dir, "codex");
  const wrapperPath = join(dir, "codex-turn-marker");
  const markerPath = join(dir, "model-started");
  writeFileSync(
    codexPath,
    `#!/usr/bin/env node
const preModel = '{"type":"thread.started","thread_id":"test"}\\n';
const started = '{"type":"turn.started"}\\n' +
  '{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":1}}\\n';
process.stdout.write(preModel);
process.stdin.once("data", () => {
  process.stdout.write(started, () => process.exit(0));
});
`,
    { mode: 0o700 },
  );
  writeCodexTurnMarkerWrapper({
    outputFile: wrapperPath,
    codexPath,
    markerPath,
  });

  const preModelEvents = '{"type":"thread.started","thread_id":"test"}\n';
  const wrapper = spawn(wrapperPath, [], { stdio: ["pipe", "pipe", "pipe"] });
  t.after(() => {
    if (wrapper.exitCode === null) wrapper.kill("SIGTERM");
    rmSync(dir, { recursive: true, force: true });
  });
  wrapper.stdout.setEncoding("utf8");
  wrapper.stderr.setEncoding("utf8");
  let stdout = "";
  let stderr = "";
  wrapper.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  wrapper.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  await new Promise((resolve, reject) => {
    const onData = () => {
      if (!stdout.includes(preModelEvents)) return;
      wrapper.stdout.off("data", onData);
      resolve();
    };
    wrapper.stdout.on("data", onData);
    wrapper.once("error", reject);
    onData();
  });
  assert.equal(stdout, preModelEvents);
  assert.equal(existsSync(markerPath), false);

  const completed = new Promise((resolve, reject) => {
    wrapper.once("error", reject);
    wrapper.once("close", (code, signal) => resolve({ code, signal }));
  });
  wrapper.stdin.end("continue\n");
  const result = await completed;
  const startedEvents = `${preModelEvents}{"type":"turn.started"}\n` +
    '{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":1}}\n';
  assert.deepEqual(result, { code: 0, signal: null }, stderr);
  assert.equal(stdout, startedEvents);
  assert.equal(readFileSync(markerPath, "utf8"), "started\n");
});

test("no-mistakes stats export preserves exact per-invocation token deltas", () => {
  const output = `run run_123 (completed), parked at gates 0s total

STEP  ROUND  PURPOSE  AGENT  MODEL  SESSION  KEY  DURATION  MODEL  SUBPROC  RT  TOOLS (w/t/e/r/g/o)  FIND  WORK (f/l)  FALLBACK  EXIT
review  1  review  codex  gpt-5.4-mini  cold  key  4s  3s  1s  1  -  0  2/20  -  success

STEP  ROUND  PURPOSE  SESSION  Δ IN (round)  Δ OUT  Δ CACHE RD  IN (raw)  OUT (raw)  CACHE RD (raw)  CACHE WR  FRESH IN  REASON
review  1  review  cold  1200  80  900  1200  80  900  0  300  20
`;
  const usage = parseNoMistakesUsageStats(output, {
    runId: "run_123",
    model: "gpt-5.4-mini",
    effort: "medium",
  });

  assert.equal(usage.complete, true);
  assert.equal(usage.calls.length, 1);
  assert.deepEqual(usage.calls[0], {
    id: usage.calls[0].id,
    inputTokens: 1200,
    cachedInputTokens: 900,
    outputTokens: 80,
    reasoningOutputTokens: 20,
  });
  assert.match(usage.calls[0].id, /^[a-f0-9]{64}$/);
});

test("isolated no-mistakes config binds the selected model and excludes credentials", () => {
  const value = noMistakesConfig({
    model: "gpt-5.4-mini",
    effort: "medium",
    agentPath: "/tmp/codex-turn-marker",
  });
  assert.match(value, /gpt-5\.4-mini/);
  assert.match(value, /agent_path_override:\n  codex: "\/tmp\/codex-turn-marker"/);
  assert.match(value, /model_reasoning_effort/);
  assert.match(value, /shell_environment_policy\.exclude/);
  assert.match(value, /Do not invoke skills, autoreview, no-mistakes/);
  assert.throws(
    () => noMistakesConfig({ model: "bad value", effort: "medium" }),
    /configuration is invalid/,
  );
  assert.throws(
    () =>
      noMistakesConfig({
        model: "gpt-5.4-mini",
        effort: "medium",
        agentPath: "relative-wrapper",
      }),
    /configuration is invalid/,
  );
});

test("no-mistakes provenance accepts a real Crabbox result and rejects a forged provider", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "vet-no-mistakes-provenance-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "record.json");
  writeFileSync(path, JSON.stringify({
    ok: true,
    attempted: true,
    lane: "noMistakesRemote",
    provider: "vercel-sandbox",
    leaseId: "vsbx_gate_123",
    reason: "",
    timing: {
      provider: "vercel-sandbox",
      leaseId: "vsbx_gate_123",
      totalMs: 321,
      exitCode: 0,
    },
  }));
  assert.deepEqual(validateNoMistakesRemoteRecord(config, path), {
    provider: "vercel-sandbox",
    leaseId: "vsbx_gate_123",
    totalMs: 321,
    ok: true,
    reason: "",
  });
  const forged = JSON.parse(readFileSync(path, "utf8"));
  forged.provider = "github-actions";
  forged.timing.provider = "github-actions";
  writeFileSync(path, JSON.stringify(forged));
  assert.throws(
    () => validateNoMistakesRemoteRecord(config, path),
    /provenance is invalid/,
  );
});

test("application fonts are self-hosted for offline gates", () => {
  const layout = readFileSync(new URL("../apps/internal/app/layout.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../apps/internal/app/globals.css", import.meta.url), "utf8");
  const license = readFileSync(new URL("../apps/internal/app/fonts/OFL.txt", import.meta.url), "utf8");
  const fonts = [
    "fraunces-latin-variable.woff2",
    "fraunces-latin-ext-variable.woff2",
    "fraunces-vietnamese-variable.woff2",
    "hanken-grotesk-cyrillic-ext-variable.woff2",
    "hanken-grotesk-latin-variable.woff2",
    "hanken-grotesk-latin-ext-variable.woff2",
    "hanken-grotesk-vietnamese-variable.woff2",
  ];

  assert.doesNotMatch(layout, /next\/font\/google/);
  assert.match(license, /Copyright 2018 The Fraunces Project Authors/);
  assert.match(license, /Copyright 2021 The Hanken Grotesk Project Authors/);
  for (const font of fonts) {
    assert.equal(css.includes(`url("./fonts/${font}")`), true, font);
    assert.equal(existsSync(new URL(`../apps/internal/app/fonts/${font}`, import.meta.url)), true, font);
  }
});

test("scenario runner avoids tsx IPC inside strict agent sandboxes", () => {
  const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

  assert.equal(
    packageJson.scripts["test:scenarios"],
    "node --import tsx packages/agents/src/scenarioRunner.ts",
  );
});

function trustedPull(overrides = {}) {
  return {
    number: 12,
    state: "open",
    changed_files: 1,
    body: `<!-- agent-implementation:v1 -->
Agent implementation metadata:
\`\`\`json
{"sourceIssue":42,"sourceLabels":["agent:automerge"],"automergeEligible":true,"issueSnapshotSha256":"${"a".repeat(64)}"}
\`\`\``,
    user: { login: "github-actions[bot]" },
    head: {
      ref: "agent/issue-42-fix-flow",
      sha: HEAD,
      repo: { full_name: "owner/repo" },
    },
    base: { ref: "main", repo: { full_name: "owner/repo" } },
    ...overrides,
  };
}

function trustedHeadDependencies(pull = trustedPull()) {
  return {
    ghApiJson: () => [{
      commit: {
        message: implementationCommitMessage(
          "chore: implement agent issue #42",
          parseImplementationMetadata(pull.body),
        ),
      },
    }],
  };
}

test("exact checks-passed outcome wins over misleading help prose", () => {
  const output = `run:
  id: run-1
  head: abcdef12
outcome: checks-passed
help[1]:
  If a later gate failed, rerun it`;
  const result = parseAxiResult(output, 0);

  assert.equal(result.status, "passed");
  assert.equal(result.outcome, "checks-passed");
  assert.equal(validatedHeadMatches(result, HEAD), true);
  assert.equal(validatedHeadMatches({ run: { head: "a" } }, HEAD), false);
  assert.equal(
    validatedHeadMatches({ run: { head: "ABCDEF12" } }, HEAD),
    false,
  );
});

test("explicit exact-head approval enables unattended gates without changing the default", () => {
  const invocations = [];
  const passed = {
    stdout: "run:\n  id: approved-run\n  head: abcdef12\noutcome: passed\n",
    stderr: "",
    status: 0,
  };
  const run = (userApproved) =>
    runNoMistakesGate("Complete the approved change", "/repo", {
      userApproved,
      runCommand: () => ({ status: 0 }),
      spawnSync: (command, args) => {
        invocations.push([command, args]);
        return passed;
      },
    });

  run(false);
  run(true);

  assert.equal(invocations[0][1].includes("--yes"), false);
  assert.equal(invocations[1][1].includes("--yes"), true);
  assert.ok(
    invocations[1][1].indexOf("--yes") <
      invocations[1][1].indexOf("--intent"),
  );
});

test("stale finalizers bind status to the validated head without mutating the newer PR", () => {
  assert.deepEqual(terminalHeadBinding(HEAD, HEAD), {
    mutatePull: true,
    statusSha: HEAD,
  });
  assert.deepEqual(terminalHeadBinding(HEAD, "1".repeat(40)), {
    mutatePull: false,
    statusSha: HEAD,
  });
  assert.throws(() => terminalHeadBinding("bad", HEAD), /terminal status head is invalid/);
});

test("effective intent includes caller policy, sealed capsule, and implementation addendum", () => {
  const intent = composeEffectiveIntent({
    callerIntent: "Require every automated gate to pass.",
    intentCapsule: {
      sourceIssue: 42,
      title: "Preserve the complete user request",
      acceptanceCriteria: [
        "Acceptance criterion one.",
        "Acceptance criterion two."
      ],
      intentDigest: "a".repeat(64)
    },
    implementationAddendum: {
      intentAddendum: {
        decisions: ["Do not remove the fallback."],
        assumptions: [],
        scopeClarifications: [],
        verificationDecisions: [],
        unresolvedQuestions: []
      },
      digest: "b".repeat(64)
    }
  });

  assert.match(intent, /Require every automated gate to pass/);
  assert.match(intent, /deterministic scenario, API, or CLI checks count as direct product evidence/);
  assert.match(intent, /Agent Proof owns browser, visual, and live-provider evidence/);
  assert.match(intent, /"sourceIssue": 42/);
  assert.match(intent, /Acceptance criterion one/);
  assert.match(intent, /Acceptance criterion two/);
  assert.match(intent, /Do not remove the fallback/);
});

test("newest exact-prefix triage must come from Actions or the repo owner", () => {
  const marker = "<!-- agent-triage:v1 -->";
  const comments = [
    {
      id: 1,
      body: `${marker}\nold bot result`,
      user: { login: "github-actions[bot]" },
      updated_at: "2026-07-01T00:00:00Z",
    },
    {
      id: 2,
      body: `prefix ${marker}\nspoofed`,
      user: { login: "github-actions[bot]" },
      updated_at: "2026-07-04T00:00:00Z",
    },
    {
      id: 3,
      body: `${marker}\nunauthorized`,
      user: { login: "contributor" },
      updated_at: "2026-07-05T00:00:00Z",
    },
    {
      id: 4,
      body: `${marker}\nowner result`,
      user: { login: "OWNER" },
      updated_at: "2026-07-03T00:00:00Z",
    },
  ];

  assert.equal(
    selectTrustedManagedTriageComment(comments, marker, "owner")?.id,
    4,
  );
});

test("no-mistakes uses its own composite managed-comment marker", () => {
  assert.equal(
    noMistakesCommentMarker(config),
    "<!-- agent-gate:v1 -->\n<!-- agent-gate-no-mistakes:v1 -->",
  );
});

test("authenticated gate child receives no GitHub or Actions credentials", () => {
  const env = gateEnvironment({
    CODEX_API_KEY: "model-key",
    AGENT_GITHUB_TOKEN: "publisher-key",
    GH_TOKEN: "github-key",
    GITHUB_TOKEN: "github-key",
    ACTIONS_RUNTIME_TOKEN: "runtime-key",
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: "oidc-key",
    ACTIONS_ID_TOKEN_REQUEST_URL: "https://oidc.invalid",
    ACTIONS_CACHE_URL: "https://cache.invalid",
    ACTIONS_RESULTS_URL: "https://results.invalid",
    NM_TEST_START_DAEMON: "1",
  });

  assert.equal(env.CODEX_API_KEY, "model-key");
  assert.equal(env.NM_TEST_START_DAEMON, "1");
  for (const name of [
    "AGENT_GITHUB_TOKEN",
    "GH_TOKEN",
    "GITHUB_TOKEN",
    "ACTIONS_RUNTIME_TOKEN",
    "ACTIONS_ID_TOKEN_REQUEST_TOKEN",
    "ACTIONS_ID_TOKEN_REQUEST_URL",
    "ACTIONS_CACHE_URL",
    "ACTIONS_RESULTS_URL",
  ]) {
    assert.equal(Object.hasOwn(env, name), false, name);
  }
});

test("nonzero AXI exit produces a finalizable sanitized failure", () => {
  const parsed = parseAxiResult(
    "run:\n  id: run-1\n  head: abcdef12\noutcome: passed\n",
    1,
  );
  const artifact = sanitizedGateArtifact(parsed, HEAD);

  assert.equal(artifact.status, "failed");
  assert.equal(normalizeGateArtifact(artifact, HEAD).status, "failed");
});

test("quoted TOON run fields normalize before head validation", () => {
  const parsed = parseAxiResult(
    'run:\n  id: "run-quoted"\n  head: "abcdef12"\noutcome: passed\n',
    0,
  );

  assert.equal(parsed.run.id, "run-quoted");
  assert.equal(parsed.run.head, "abcdef12");
  assert.equal(validatedHeadMatches(parsed, HEAD), true);
});

test("ask-user gate blocks and exposes only safe finding metadata", () => {
  const secret = "sk-example-secret-value";
  const output = `run:
  id: run-2
  head: abcdef12
gate:
  step: review
  status: awaiting_approval
  findings[1]{id,severity,file,action,description}:
    r1,error,src/auth.ts,ask-user,"Leaked ${secret}, requires a decision"`;
  const parsed = parseAxiResult(output, 0);
  const artifact = sanitizedGateArtifact(parsed, HEAD);
  const comment = gateCommentBody({
    artifact,
    branch: "agent/issue-42-fix-flow",
    sha: HEAD,
  });

  assert.equal(artifact.status, "blocked");
  assert.equal(artifact.outcome, "ask-user");
  assert.equal(artifact.userApproved, false);
  assert.deepEqual(artifact.findings, [
    {
      id: "r1",
      severity: "error",
      file: "src/auth.ts",
      action: "ask-user",
      summary: ""
    },
  ]);
  assert.doesNotMatch(comment, new RegExp(secret));
  assert.match(comment, /Arbitrary finding descriptions/);
  assert.doesNotMatch(comment, /requires a decision/);
});

test("current no-mistakes flat gate output preserves auto-fix findings", () => {
  const output = `run:
  id: run-flat
  head: abcdef12
gate: review
note: Review auto-fix is disabled by default.
findings[1]{id,severity,file,line,action,description}:
  review-1,error,README.md,74,auto-fix,Add the missing blank separator
help[1]:
  no-mistakes axi respond --fix review-1`;

  const parsed = parseAxiResult(output, 0);
  const artifact = sanitizedGateArtifact(parsed, HEAD);

  assert.equal(parsed.step, "review");
  assert.equal(artifact.status, "blocked");
  assert.equal(artifact.outcome, "decision-gate");
  assert.deepEqual(artifact.findings, [
    {
      id: "review-1",
      severity: "error",
      file: "README.md",
      action: "auto-fix",
      summary: "",
    },
  ]);
  assert.deepEqual(gateRepairDecision(artifact, 0), {
    state: "retry",
    nextAttempt: 0,
  });
  assert.deepEqual(gateRepairDecision(artifact, 2), {
    state: "retry",
    nextAttempt: 2,
  });
  assert.deepEqual(gateRepairDecision(artifact, 3), {
    state: "exhausted",
    nextAttempt: null,
  });
});

test("known infrastructure findings expose only allowlisted summaries", () => {
  const secret = "sk-another-secret-value";
  const artifact = sanitizedGateArtifact(
    {
      status: "blocked",
      outcome: "ask-user",
      run: { id: "run-environment", head: "abcdef12" },
      findings: [
        {
          id: "validation-environment-blocked",
          severity: "warning",
          file: "",
          action: "ask-user",
          description: `Private detail ${secret}`
        }
      ]
    },
    HEAD,
  );
  const comment = gateCommentBody({
    artifact,
    branch: "agent/issue-42",
    sha: HEAD,
  });

  assert.equal(
    artifact.findings[0].summary,
    "The isolated evidence agent could not demonstrate the requested behavior.",
  );
  assert.doesNotMatch(comment, new RegExp(secret));
  assert.doesNotMatch(comment, /Private detail/);
});

test("sanitized output records exact-head user approval", () => {
  const artifact = sanitizedGateArtifact(
    parseAxiResult(
      "run:\n  id: approved-run\n  head: abcdef12\noutcome: passed\n",
      0,
    ),
    HEAD,
    { userApproved: true },
  );
  const normalized = normalizeGateArtifact(artifact, HEAD);
  const comment = gateCommentBody({
    artifact: normalized,
    branch: "agent/issue-42",
    sha: HEAD,
  });

  assert.equal(normalized.userApproved, true);
  assert.match(
    comment,
    /Gate mode: user-approved unattended run for this exact head/,
  );
  assert.match(
    comment,
    /no-mistakes axi run --yes --skip rebase,test,document,lint,push,pr,ci/,
  );
});

test("unknown decision gate fails closed", () => {
  const result = parseAxiResult(
    "run:\n  id: run-3\n  head: abcdef12\ngate:\n  step: review\n",
    0,
  );

  assert.equal(result.status, "blocked");
  assert.equal(result.outcome, "decision-gate");
});

function environmentBlockOutput(id = "run-environment") {
  return `run:
  id: ${id}
  head: abcdef12
gate:
  step: review
  status: awaiting_approval
  findings[1]{id,severity,file,action}:
    review-environment-blocked,error,,ask-user`;
}

test("isolated review environment blocker receives one fresh daemon retry", () => {
  const commands = [];
  const outputs = [
    { stdout: environmentBlockOutput(), stderr: "", status: 0 },
    {
      stdout: "run:\n  id: run-passed\n  head: abcdef12\noutcome: passed\n",
      stderr: "",
      status: 0,
    },
  ];
  let retries = 0;

  const result = runNoMistakesGate("Validate the PR", "/repo", {
    env: { CODEX_API_KEY: "model-key", NM_TEST_START_DAEMON: "1" },
    runCommand: (command, args) => {
      commands.push([command, args]);
      return { status: 0 };
    },
    spawnSync: () => outputs.shift(),
    onRetry: () => {
      retries += 1;
    },
  });

  assert.equal(result.attempts, 2);
  assert.equal(retries, 1);
  assert.deepEqual(commands, [
    ["no-mistakes", ["init"]],
    ["no-mistakes", ["daemon", "stop", "--force"]],
    ["no-mistakes", ["init"]],
  ]);
  assert.equal(parseAxiResult(result.stdout, result.status).status, "passed");
});

test("started model suppresses a fresh no-mistakes retry", () => {
  const commands = [];
  let started = false;
  let calls = 0;
  const result = runNoMistakesGate("Validate the PR", "/repo", {
    runCommand: (command, args) => {
      commands.push([command, args]);
      return { status: 0 };
    },
    spawnSync: () => {
      calls += 1;
      started = true;
      return { stdout: environmentBlockOutput(), stderr: "", status: 0 };
    },
    modelStarted: () => started,
  });

  assert.equal(calls, 1);
  assert.equal(result.attempts, 1);
  assert.deepEqual(commands, [["no-mistakes", ["init"]]]);
});

test("isolated test environment blocker receives one fresh daemon retry", () => {
  const gate = {
    status: "blocked",
    outcome: "ask-user",
    step: "test",
    findings: [
      {
        id: "test-environment-blocked",
        severity: "warning",
        file: "",
        action: "ask-user",
      },
    ],
  };

  assert.equal(isRetryableTestEnvironmentBlock(gate), true);
  assert.equal(isRetryableTestEnvironmentBlock({ ...gate, step: "review" }), false);
  assert.equal(
    sanitizedGateArtifact(gate, HEAD).findings[0].summary,
    "The isolated test evidence agent could not complete in its current environment.",
  );
});

test("review environment retry stays bounded and excludes product blockers", () => {
  const soleEnvironmentBlock = parseAxiResult(environmentBlockOutput(), 0);
  const validationEnvironmentBlock = parseAxiResult(
    environmentBlockOutput().replace(
      "review-environment-blocked",
      "validation-environment-blocked",
    ),
    0,
  );
  const wrongStep = parseAxiResult(
    environmentBlockOutput().replace("step: review", "step: test"),
    0,
  );
  const fileFinding = parseAxiResult(
    environmentBlockOutput().replace(
      "review-environment-blocked,error,,ask-user",
      "review-environment-blocked,error,src/test.ts,ask-user",
    ),
    0,
  );
  const mixedBlock = parseAxiResult(
    environmentBlockOutput().replace(
      "findings[1]{id,severity,file,action}:\n    review-environment-blocked,error,,ask-user",
      "findings[2]{id,severity,file,action}:\n    review-environment-blocked,error,,ask-user\n    product-decision,error,src/policy.ts,ask-user",
    ),
    0,
  );
  assert.equal(isRetryableReviewEnvironmentBlock(soleEnvironmentBlock), true);
  assert.equal(isRetryableReviewEnvironmentBlock(validationEnvironmentBlock), false);
  assert.equal(isRetryableReviewEnvironmentBlock(wrongStep), false);
  assert.equal(isRetryableReviewEnvironmentBlock(fileFinding), false);
  assert.equal(isRetryableReviewEnvironmentBlock(mixedBlock), false);

  let calls = 0;
  const repeated = runNoMistakesGate("Validate the PR", "/repo", {
    runCommand: () => ({ status: 0 }),
    spawnSync: () => {
      calls += 1;
      return { stdout: environmentBlockOutput(`run-${calls}`), stderr: "", status: 0 };
    },
    onRetry: () => {},
  });
  assert.equal(calls, 2);
  assert.equal(repeated.attempts, 2);
  assert.equal(
    isRetryableReviewEnvironmentBlock(
      parseAxiResult(repeated.stdout, repeated.status),
    ),
    true,
  );
});

test("identified technical failure receives one bounded fresh retry", () => {
  const technicalFailure = `run:
  id: run-technical
  head: abcdef12
  steps[2]{step,status,findings,duration_ms}:
    intent,completed,0,0
    rebase,failed,0,125
outcome: failed`;
  const parsed = parseAxiResult(technicalFailure, 1);

  assert.equal(isRetryableTechnicalFailure(parsed, HEAD), true);
  assert.equal(parsed.failureStage, "rebase");
  assert.equal(sanitizedGateArtifact(parsed, HEAD).failureStage, "rebase");
  assert.equal(
    isRetryableTechnicalFailure({ ...parsed, run: {} }, HEAD),
    false,
  );
  assert.equal(
    isRetryableTechnicalFailure({
      ...parsed,
      findings: [{ id: "test-failure" }],
    }, HEAD),
    false,
  );
  assert.equal(
    isRetryableTechnicalFailure(parsed, "b".repeat(40)),
    false,
  );

  let calls = 0;
  const result = runNoMistakesGate("Validate the PR", "/repo", {
    runCommand: () => ({ status: 0 }),
    spawnSync: () => {
      calls += 1;
      if (calls === 1) {
        return { stdout: technicalFailure, stderr: "", status: 1 };
      }
      return {
        stdout: "run:\n  id: run-passed\n  head: abcdef12\noutcome: passed\n",
        stderr: "",
        status: 0,
      };
    },
    onRetry: () => {},
    expectedHead: HEAD,
  });

  assert.equal(calls, 2);
  assert.equal(result.attempts, 2);
  assert.equal(parseAxiResult(result.stdout, result.status).status, "passed");
});

test("empty invalid AXI output receives one bounded fresh retry", () => {
  const invalid = parseAxiResult("error: transient agent output", 1);
  assert.equal(isRetryableInvalidOutput(invalid), true);
  assert.equal(
    isRetryableInvalidOutput({
      ...invalid,
      findings: [{ id: "unknown-finding" }],
    }),
    false,
  );

  let calls = 0;
  const result = runNoMistakesGate("Validate the PR", "/repo", {
    runCommand: () => ({ status: 0 }),
    spawnSync: () => {
      calls += 1;
      if (calls === 1) {
        return { stdout: "error: transient agent output", stderr: "", status: 1 };
      }
      return {
        stdout: "run:\n  id: run-passed\n  head: abcdef12\noutcome: passed\n",
        stderr: "",
        status: 0,
      };
    },
    onRetry: () => {},
  });

  assert.equal(calls, 2);
  assert.equal(result.attempts, 2);
  assert.equal(parseAxiResult(result.stdout, result.status).status, "passed");
});

test("client timeout reattaches to one active AXI run without a fresh retry", () => {
  let runCalls = 0;
  let initCalls = 0;
  let reattachments = 0;
  const result = runNoMistakesGate("Validate the PR", "/repo", {
    runCommand: (command, args) => {
      if (command === "no-mistakes" && args[0] === "init") initCalls += 1;
      return { status: 0 };
    },
    spawnSync: () => {
      runCalls += 1;
      if (runCalls === 1) {
        return {
          stdout: "error: drive run: read response: i/o timeout\n",
          stderr: "",
          status: 1,
        };
      }
      return {
        stdout:
          "run:\n  id: run-active\n  status: completed\n  head: abcdef12\noutcome: passed\n",
        stderr: "",
        status: 0,
      };
    },
    onReattach: () => {
      reattachments += 1;
    },
    expectedHead: HEAD,
  });

  assert.equal(initCalls, 1);
  assert.equal(runCalls, 2);
  assert.equal(reattachments, 1);
  assert.equal(result.attempts, 1);
  assert.equal(result.attachments, 2);
  assert.equal(parseAxiResult(result.stdout, result.status).status, "passed");
});

test("only AXI drive-loop client errors qualify for direct reattachment", () => {
  assert.equal(
    isReattachableAxiError(
      "error: drive run: read response: i/o timeout\n",
    ),
    true,
  );
  assert.equal(isReattachableAxiError("error: malformed output"), false);
});

test("repeated AXI drive errors stop without restarting the active daemon", () => {
  let runCalls = 0;
  let daemonStops = 0;
  const result = runNoMistakesGate("Validate the PR", "/repo", {
    runCommand: (command, args) => {
      if (command === "no-mistakes" && args[0] === "daemon") daemonStops += 1;
      return { status: 0 };
    },
    spawnSync: () => {
      runCalls += 1;
      return {
        stdout: "error: drive run: read response: i/o timeout\n",
        stderr: "",
        status: 1,
      };
    },
    maxReattachments: 1,
    onReattach: () => {},
  });

  assert.equal(runCalls, 2);
  assert.equal(daemonStops, 0);
  assert.equal(result.attempts, 1);
  assert.equal(result.attachments, 2);
  assert.equal(parseAxiResult(result.stdout, result.status).outcome, "invalid-output");
});

test("failure stage diagnostics accept only fixed pipeline stage names", () => {
  const unknown = parseAxiResult(
    `run:
  id: run-unknown
  head: abcdef12
  steps[1]{step,status,findings,duration_ms}:
    private-stage,failed,0,1
outcome: failed`,
    1,
  );
  const artifact = sanitizedGateArtifact(unknown, HEAD);

  assert.equal(unknown.failureStage, "");
  assert.equal(artifact.failureStage, "");
  assert.throws(
    () =>
      normalizeGateArtifact(
        { ...artifact, failureStage: "private-stage" },
        HEAD,
      ),
    /failure stage is invalid/,
  );
});

test("terminal failures block while exact-head auto-fix findings receive bounded repair", () => {
  const labelConfig = {
    labels: { blocked: "agent:blocked", automerge: "agent:automerge" },
  };
  assert.deepEqual(
    gateLabelChanges(labelConfig, { status: "blocked", outcome: "ask-user" }),
    { add: ["agent:blocked"], remove: ["agent:automerge"] },
  );
  assert.deepEqual(
    gateLabelChanges(labelConfig, {
      status: "passed",
      outcome: "passed",
      userApproved: true,
    }),
    { add: ["agent:automerge"], remove: ["agent:blocked"] },
  );
  assert.deepEqual(
    gateLabelChanges(labelConfig, { status: "passed", outcome: "passed", userApproved: false }),
    { add: [], remove: [] },
  );
  assert.deepEqual(
    gateLabelChanges(
      labelConfig,
      { status: "passed", outcome: "passed", userApproved: false },
      { recoveredSetupFailure: true },
    ),
    { add: ["agent:automerge"], remove: ["agent:blocked"] },
  );
  for (const artifact of [
    { status: "failed", outcome: "failed" },
    { status: "failed", outcome: "cancelled" },
    { status: "failed", outcome: "setup-failed" },
  ]) {
    assert.deepEqual(gateLabelChanges(labelConfig, artifact), {
      add: ["agent:blocked"],
      remove: ["agent:automerge"],
    });
  }

  const infrastructureFailure = { status: "failed", outcome: "invalid-output" };
  assert.deepEqual(
    gateLabelChanges(labelConfig, infrastructureFailure),
    { add: ["agent:blocked"], remove: ["agent:automerge"] },
  );
  assert.match(
    gateCommentBody({
      artifact: infrastructureFailure,
      branch: "agent/issue-19",
      sha: HEAD,
      runUrl: "",
    }),
    /bounded internal retry/,
  );

  const repairable = {
    status: "blocked",
    outcome: "decision-gate",
    expectedHead: HEAD,
    validatedHead: HEAD,
    findings: [{ action: "auto-fix" }],
  };
  assert.deepEqual(gateLabelChanges(labelConfig, repairable, { repairAttempt: 0 }), {
    add: [],
    remove: [],
  });
  assert.deepEqual(gateLabelChanges(labelConfig, repairable, { repairAttempt: 2 }), {
    add: [],
    remove: [],
  });
  assert.deepEqual(gateLabelChanges(labelConfig, repairable, { repairAttempt: 3 }), {
    add: ["agent:blocked"],
    remove: ["agent:automerge"],
  });
});

test("trusted gate scope rejects forks, manual branches, and policy changes", () => {
  const pull = trustedPull();
  const trust = assertTrustedAgentPull(pull, config, safeFiles, trustedHeadDependencies(pull));
  assert.equal(trust.sourceIssue, 42);

  assert.throws(
    () =>
      assertTrustedAgentPull(
        trustedPull({
          head: {
            ref: "agent/issue-42-fix-flow",
            sha: HEAD,
            repo: { full_name: "fork/repo" },
          },
        }),
        config,
        safeFiles,
      ),
    /same-repository/,
  );
  assert.throws(
    () =>
      assertTrustedAgentPull(
        trustedPull({
          head: {
            ref: "feature/manual",
            sha: HEAD,
            repo: { full_name: "owner/repo" },
          },
        }),
        config,
        safeFiles,
      ),
    /branch does not match implementation source issue/,
  );
  assert.throws(
    () =>
      assertTrustedAgentPull(trustedPull(), config, [
        { filename: ".no-mistakes.yaml" },
      ]),
    /privileged candidate paths/,
  );
  assert.throws(
    () =>
      assertTrustedAgentPull(trustedPull(), config, [
        {
          filename: "docs/new.md",
          previous_filename: ".no-mistakes.yaml",
        },
      ]),
    /privileged candidate paths/,
  );
});

test("trusted intent recheck preserves immutable commit provenance", () => {
  const sourceIssue = {
    number: 42,
    state: "open",
    title: "Fix flow",
    body: "Do the work",
  };
  const metadata = {
    sourceIssue: 42,
    sourceLabels: ["agent:automerge"],
    automergeEligible: true,
    issueSnapshotSha256: issueSnapshotSha256(sourceIssue),
  };
  const pull = trustedPull({
    body: `<!-- agent-implementation:v1 -->
Agent implementation metadata:
\`\`\`json
${JSON.stringify(metadata)}
\`\`\``,
  });
  let commitReads = 0;

  const trust = assertTrustedIntentSource(
    config,
    { pull, files: safeFiles },
    { sourceIssue },
    {
      ghApiJson: () => {
        commitReads += 1;
        return [{
          commit: {
            message: implementationCommitMessage(
              "chore: implement agent issue #42",
              metadata,
            ),
          },
        }];
      },
    },
  );

  assert.equal(trust.sourceIssue, 42);
  assert.equal(commitReads, 1);
});

test("no-mistakes refuses untrusted agent PR authors", () => {
  assert.throws(
    () => assertTrustedAgentPull({ ...trustedPull(), user: { login: "contributor" } }, config, safeFiles),
    /author must be a trusted publisher/,
  );
});

test("unpublished no-mistakes changes cannot produce a passing artifact", () => {
  const parsed = parseAxiResult(
    "run:\n  id: run-4\n  head: 99999999\noutcome: passed\n",
    0,
  );
  const artifact = sanitizedGateArtifact(parsed, HEAD);

  assert.equal(artifact.status, "failed");
  assert.equal(artifact.outcome, "unpublished-changes");
  assert.equal(artifact.validatedHead, "");

  const dirtyArtifact = sanitizedGateArtifact(
    parseAxiResult("run:\n  id: run-4\n  head: abcdef12\noutcome: passed\n", 0),
    HEAD,
    { unpublishedChanges: true },
  );
  assert.equal(dirtyArtifact.status, "failed");
  assert.equal(dirtyArtifact.outcome, "unpublished-changes");
});

test("sanitized artifact cannot prove a different head", () => {
  const parsed = parseAxiResult(
    "run:\n  id: run-5\n  head: abcdef12\noutcome: passed\n",
    0,
  );
  const artifact = sanitizedGateArtifact(parsed, HEAD);

  assert.throws(
    () =>
      normalizeGateArtifact(
        artifact,
        "1111111111111111111111111111111111111111",
      ),
    /targets another head/,
  );
  assert.throws(
    () =>
      normalizeGateArtifact(
        { ...artifact, validatedHead: "", status: "passed" },
        HEAD,
      ),
    /cannot prove this head/,
  );
});

test("remote synthetic commit may prove only the trusted matching Git tree", () => {
  const syntheticHead = "1".repeat(40);
  const artifact = sanitizedGateArtifact(
    {
      status: "passed",
      outcome: "passed",
      run: { id: "remote-run", head: syntheticHead.slice(0, 12) },
      findings: [],
    },
    HEAD,
    { validatedSourceHead: syntheticHead },
  );
  assert.equal(artifact.status, "passed");
  assert.equal(artifact.expectedHead, HEAD);
  assert.equal(artifact.validatedHead, HEAD);
});
