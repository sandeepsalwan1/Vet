import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  applyNativeFixPatch,
  assertNativeFixPatchExcludesSecrets,
  assertTrustedAgentPull,
  composeEffectiveIntent,
  createNativeFixPatch,
  finalizeNativeFixPublication,
  gateEnvironment,
  gateLabelChanges,
  gateRepairDecision,
  gateCommentBody,
  isRetryableInvalidOutput,
  isReattachableAxiError,
  isRetryableReviewEnvironmentBlock,
  isRetryableTestEnvironmentBlock,
  isRetryableTechnicalFailure,
  noMistakesCommentMarker,
  normalizeGateArtifact,
  parseAxiResult,
  runNoMistakesGate,
  sanitizedGateArtifact,
  selectTrustedManagedTriageComment,
  terminalHeadBinding,
  validatedHeadMatches,
} from "./agent-no-mistakes-gate.mjs";

const HEAD = "abcdef1234567890abcdef1234567890abcdef12";
const config = {
  repo: { owner: "owner", name: "repo", defaultBranch: "main" },
  comments: { gate: "<!-- agent-gate:v1 -->" },
};
const safeFiles = [{ filename: "apps/internal/src/app/page.tsx" }];

function gitAt(cwd, ...args) {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
}

function nativeFixFixture(relativePath = "apps/internal/native-fix.txt") {
  const root = mkdtempSync(join(tmpdir(), "vet-native-fix-"));
  const source = join(root, "source");
  const origin = join(root, "origin.git");
  const nmHome = join(root, "nm-home");
  const gate = join(nmHome, "repos", "vet.git");
  const patchPath = join(root, "artifact", "fix.patch");
  const branch = "agent/issue-42-native-fix";
  mkdirSync(dirname(join(source, relativePath)), { recursive: true });
  gitAt(root, "init", "-b", "main", source);
  gitAt(source, "config", "user.name", "Test Bot");
  gitAt(source, "config", "user.email", "test@example.com");
  writeFileSync(join(source, relativePath), "before\n");
  gitAt(source, "add", "-A");
  gitAt(source, "commit", "-m", "test: base");
  const baseHead = gitAt(source, "rev-parse", "HEAD");
  gitAt(root, "clone", "--bare", source, origin);
  gitAt(source, "branch", branch, baseHead);
  gitAt(source, "remote", "add", "origin", origin);
  gitAt(source, "push", "origin", `${branch}:refs/heads/${branch}`);
  writeFileSync(join(source, relativePath), "after\n");
  gitAt(source, "add", "-A");
  gitAt(source, "commit", "-m", "fix: native review finding");
  const fixedHead = gitAt(source, "rev-parse", "HEAD");
  mkdirSync(dirname(gate), { recursive: true });
  gitAt(root, "clone", "--bare", source, gate);
  const parsed = {
    status: "passed",
    outcome: "passed",
    run: { id: "native-run", head: fixedHead.slice(0, 12) },
    findings: [],
  };
  const nativeFix = createNativeFixPatch(parsed, baseHead, patchPath, { nmHome });
  const artifact = sanitizedGateArtifact(parsed, baseHead, { nativeFix });
  return { artifact, baseHead, branch, fixedHead, gate, origin, patchPath, root };
}

test("authenticated reviewer auto-fixes only inside the credential-free sealed handoff", () => {
  const workflow = readFileSync(new URL("../.github/workflows/agent-no-mistakes.yml", import.meta.url), "utf8");
  const automergeWorkflow = readFileSync(new URL("../.github/workflows/agent-automerge.yml", import.meta.url), "utf8");
  const repoConfig = readFileSync(new URL("../.no-mistakes.yaml", import.meta.url), "utf8");
  const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const gate = readFileSync(new URL("./agent-no-mistakes-gate.mjs", import.meta.url), "utf8");

  assert.match(workflow, /- --sandbox\s+- workspace-write/);
  assert.match(workflow, /auto_fix:\n\s+review: 2/);
  assert.match(
    workflow,
    /Treat test-only assertion changes as documentation-complete/,
  );
  assert.match(workflow, /--validate-backend --lane no-mistakes --json/);
  assert.match(workflow, /- --model\s+- \$\{\{ needs\.prepare\.outputs\.backend_model \}\}/);
  assert.match(
    workflow,
    /model_reasoning_effort="\$\{\{ needs\.prepare\.outputs\.backend_effort \}\}"/,
  );
  assert.match(workflow, /- 'approval_policy="never"'/);
  assert.match(
    workflow,
    /shell_environment_policy\.exclude=\["\*KEY\*","\*SECRET\*","\*TOKEN\*","\*PASSWORD\*","\*CREDENTIAL\*"\]/,
  );
  assert.doesNotMatch(workflow, /- --ask-for-approval/);
  assert.match(workflow, /codex exec \\\n\s+--sandbox read-only/);
  assert.match(workflow, /NM_TEST_START_DAEMON: "1"/);
  assert.match(
    workflow,
    /approval:\n\s+description: User approved unattended gate decisions for this exact head/,
  );
  assert.match(
    workflow,
    /if \[ "\$USER_APPROVED" = "true" \]; then\n\s+args\+=\(--user-approved\)/,
  );
  assert.match(
    workflow,
    /name: Validate approval authority\n\s+if: \$\{\{ inputs\.approval \}\}[\s\S]*?test "\$\{APPROVAL_ACTOR,,\}" = "\$\{REPOSITORY_OWNER,,\}"/,
  );
  assert.match(workflow, /session_reuse: false/);
  assert.match(
    workflow,
    /Do not invoke skills, autoreview, no-mistakes, external reviewers, or nested agents/,
  );
  assert.match(
    workflow,
    /trusted credential-free steps provide deterministic validation/,
  );
  assert.match(gate, /"--skip",\s+"rebase,test,document,lint,push,pr,ci"/);
  assert.doesNotMatch(workflow, /git config --global user\./);
  assert.match(workflow, /if: \$\{\{ always\(\) \}\}\n\s+continue-on-error: true\n[\s\S]*?run: no-mistakes daemon stop --force/);
  assert.match(workflow, /Never modify AGENTS\.md, package manifests or lockfiles, agent scripts\/configuration/);
  assert.match(workflow, /v1\.40\.0\/no-mistakes-v1\.40\.0-linux-amd64\.tar\.gz/);
  assert.match(workflow, /--fix-patch "\$RUNNER_TEMP\/no-mistakes-result\/fix\.patch"/);
  assert.match(gate, /--force-with-lease/);
  assert.match(workflow, /dispatch-native-fix:/);
  const baseline = workflow.indexOf("- name: Run trusted offline test baseline before agent auth");
  const modelAuth = workflow.indexOf("CODEX_API_KEY: ${{ secrets.OPENAI_API_KEY }}");
  assert.ok(baseline > 0 && modelAuth > baseline);
  assert.match(workflow, /npm run typecheck && npm run build && npm run test:scenarios/);
  assert.match(workflow, /tar -C \/source --exclude=\.\/node_modules --exclude=\.\/\.git/);
  assert.match(workflow, /npm rebuild --offline/);
  assert.match(workflow, /npm_config_nodedir=\/usr\/local/);
  assert.match(workflow, /--user "\$\(id -u\):\$\(id -g\)"/);
  assert.match(workflow, /src=\$PWD,dst=\/workspace,readonly/);
  assert.match(workflow, /--read-only/);
  assert.match(workflow, /gh workflow run agent-automerge\.yml/);
  assert.match(workflow, /--repo "\$GITHUB_REPOSITORY"/);
  assert.match(workflow, /-f pr-number="\$\{\{ inputs\.pr-number \}\}"/);
  assert.match(workflow, /-f expected-head-sha="\$\{\{ needs\.prepare\.outputs\.head_sha \}\}"/);
  assert.match(workflow, /gh workflow run agent-proof\.yml/);
  assert.match(workflow, /source_issue="\$\(/);
  assert.match(workflow, /gh issue view "\$source_issue" --repo "\$GITHUB_REPOSITORY" --json labels/);
  assert.match(workflow, /dispatch-automerge:\n[\s\S]*?needs:\n\s+- prepare\n\s+- finalize/);
  assert.match(workflow, /repair-attempt:/);
  assert.match(workflow, /dispatch-repair:\n[\s\S]*?gh workflow run agent-review\.yml/);
  assert.match(workflow, /-f repair-attempt=0/);
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
  assert.equal([...repoConfig.matchAll(/tar --no-same-owner -xf/g)].length, 2);
  assert.match(repoConfig, /review: 2/);
  assert.match(gate, /"--untracked-files=all"/);
  assert.match(gate, /createNativeFixPatch/);
});

test("native no-mistakes fixes become a sealed non-privileged patch", () => {
  const fixture = nativeFixFixture();

  assert.equal(fixture.artifact.status, "blocked");
  assert.equal(fixture.artifact.outcome, "native-fix");
  assert.equal(fixture.artifact.nativeFix.baseHead, fixture.baseHead);
  assert.equal(fixture.artifact.nativeFix.fixedHead, fixture.fixedHead);
  assert.deepEqual(fixture.artifact.nativeFix.paths, ["apps/internal/native-fix.txt"]);
  assert.match(readFileSync(fixture.patchPath, "utf8"), /-before\n\+after/);
  assert.deepEqual(gateRepairDecision(fixture.artifact, 0), {
    state: "native-fix",
    nextAttempt: 1,
  });
  assert.deepEqual(gateRepairDecision(fixture.artifact, 2), {
    state: "exhausted",
    nextAttempt: null,
  });

  const dirtyArtifact = sanitizedGateArtifact(
    {
      status: "passed",
      outcome: "passed",
      run: { id: "native-run", head: fixture.fixedHead.slice(0, 12) },
      findings: [],
    },
    fixture.baseHead,
    { nativeFix: fixture.artifact.nativeFix, unpublishedChanges: true },
  );
  assert.equal(dirtyArtifact.status, "failed");
  assert.equal(dirtyArtifact.outcome, "unpublished-changes");
  assert.equal(dirtyArtifact.nativeFix, null);
  assert.equal(
    normalizeGateArtifact(dirtyArtifact, fixture.baseHead).outcome,
    "unpublished-changes",
  );
});

test("trusted publication reapplies the sealed tree with an exact-head lease", () => {
  const fixture = nativeFixFixture();
  const checkout = join(fixture.root, "apply");
  gitAt(fixture.root, "clone", fixture.origin, checkout);
  const commands = [];
  const execute = (command, args, options = {}) => {
    commands.push([command, args]);
    if (command === "gh") return { status: 0, stdout: "", stderr: "" };
    const result = spawnSync(command, args, {
      cwd: checkout,
      encoding: "utf8",
      stdio: "pipe",
    });
    if (result.status !== 0 && options.check !== false) {
      throw new Error(`${command} ${args.join(" ")} failed: ${result.stderr}`);
    }
    return {
      status: result.status ?? 1,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
  };

  const published = applyNativeFixPatch(
    {
      artifact: fixture.artifact,
      config,
      patchPath: fixture.patchPath,
      pull: { number: 42, head: { ref: fixture.branch, sha: fixture.baseHead } },
      repairAttempt: 0,
    },
    { runCommand: execute },
  );

  const remoteTree = gitAt(
    fixture.origin,
    "rev-parse",
    `refs/heads/${fixture.branch}^{tree}`,
  );
  assert.equal(remoteTree, fixture.artifact.nativeFix.fixedTree);
  assert.equal(published.nextRepairAttempt, 1);
  assert.match(published.nextHead, /^[0-9a-f]{40}$/);
  assert.ok(
    commands.some(
      ([command, args]) =>
        command === "git" &&
        args.includes(
          `--force-with-lease=refs/heads/${fixture.branch}:${fixture.baseHead}`,
        ),
    ),
  );
});

test("native fix publication fails closed on publish errors", () => {
  const fixture = nativeFixFixture();
  assert.throws(
    () =>
      finalizeNativeFixPublication({
        artifact: fixture.artifact,
        config,
        pull: { number: 42, head: { ref: fixture.branch, sha: fixture.baseHead } },
        repairAttempt: 0,
        patchPath: fixture.patchPath,
        applyPatch: () => ({ nextHead: fixture.fixedHead, nextRepairAttempt: 1, paths: fixture.artifact.nativeFix.paths }),
        recordFix: () => {
          throw new Error("publish failed");
        },
        setOutput: () => {},
      }),
    /publish failed/,
  );
});

test("native fix publication dry-run validates without mutating git or GitHub", () => {
  const fixture = nativeFixFixture();
  const commands = [];
  const published = applyNativeFixPatch(
    {
      artifact: fixture.artifact,
      config,
      patchPath: fixture.patchPath,
      pull: { number: 42, head: { ref: fixture.branch, sha: fixture.baseHead } },
      repairAttempt: 0,
      dryRun: true,
    },
    {
      runCommand: (command, args) => {
        commands.push([command, args]);
        throw new Error("dry-run must not execute a mutating command");
      },
    },
  );

  assert.deepEqual(commands, []);
  assert.deepEqual(published, {
    nextHead: "",
    nextRepairAttempt: 1,
    paths: ["apps/internal/native-fix.txt"],
    dryRun: true,
  });
  assert.equal(
    gitAt(fixture.origin, "rev-parse", `refs/heads/${fixture.branch}`),
    fixture.baseHead,
  );
});

test("native no-mistakes patches cannot modify automation control files", () => {
  assert.throws(
    () => nativeFixFixture("scripts/agent-danger.mjs"),
    /privileged candidate paths/,
  );
});

test("native fix artifacts reject exact credentials without exposing their value", () => {
  const credential = "sk-test-native-fix-credential-123456789";
  assert.equal(
    assertNativeFixPatchExcludesSecrets("+safe replacement\n", {
      CODEX_API_KEY: credential,
    }),
    true,
  );
  assert.throws(
    () =>
      assertNativeFixPatchExcludesSecrets(`+${credential}\n`, {
        CODEX_API_KEY: credential,
      }),
    (error) => {
      assert.match(error.message, /contains a credential value/);
      assert.doesNotMatch(error.message, new RegExp(credential));
      return true;
    },
  );
  assert.throws(
    () =>
      assertNativeFixPatchExcludesSecrets(
        "diff --git a/image.png b/image.png\nGIT binary patch\nliteral 1\nA\n",
        {},
      ),
    /cannot contain binary changes/,
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

test("effective intent includes caller policy, full source issue, and managed triage", () => {
  const intent = composeEffectiveIntent({
    callerIntent: "Require every automated gate to pass.",
    sourceIssue: {
      number: 42,
      title: "Preserve the complete user request",
      body: "Acceptance criterion one.\n\nAcceptance criterion two.",
    },
    triageComment: {
      body: "<!-- agent-triage:v1 -->\nRisk: medium\nDo not remove the fallback.",
    },
  });

  assert.match(intent, /Require every automated gate to pass/);
  assert.match(intent, /deterministic scenario, API, or CLI checks count as direct product evidence/);
  assert.match(intent, /Agent Proof owns browser, visual, and live-provider evidence/);
  assert.match(intent, /Authoritative source issue #42/);
  assert.match(
    intent,
    /Acceptance criterion one\.\n\nAcceptance criterion two\./,
  );
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
    nextAttempt: 1,
  });
  assert.deepEqual(gateRepairDecision(artifact, 2), {
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
    add: ["agent:blocked"],
    remove: ["agent:automerge"],
  });
});

test("trusted gate scope rejects forks, manual branches, and policy changes", () => {
  const trust = assertTrustedAgentPull(trustedPull(), config, safeFiles);
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

test("no-mistakes refuses non-bot agent PR authors", () => {
  assert.throws(
    () => assertTrustedAgentPull({ ...trustedPull(), user: { login: "contributor" } }, config, safeFiles),
    /author must be github-actions\[bot\]/,
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
