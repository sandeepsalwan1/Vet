import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AgentError } from "./agent-lib.mjs";
import {
  alignRecoveredAgentBranch,
  applyPatchIdempotently,
  assertImplementationSource,
  assertIssueMatchesTriageSnapshot,
  chooseAgentBranch,
  dispatchCandidateCi,
  finalizePatchValidation,
  getRepositoryNodeId,
  implementationPullLabels,
  listPulls,
  preparePatchValidation,
  preferredBranchName,
  privilegedPatchPaths,
  runPatchValidationChecks,
  selectExistingPull,
  upsertPullRequest,
  verifyValidatedArtifactBase
} from "./agent-implement.mjs";

const config = {
  repo: { owner: "owner", name: "repo", defaultBranch: "main" },
  labels: { blocked: "agent:blocked" },
  commands: { defaultImplementChecks: [] }
};

const issue = { number: 42, title: "Fix duplicate intake" };
const metadata = { sourceIssue: 42, automergeEligible: true };

test("upsertPullRequest creates a draft PR through GraphQL", () => {
  let payload;
  let apiArgs;
  const result = upsertPullRequest(
    {
      config,
      issue,
      branch: "agent/issue-42-fix-duplicate-intake",
      codexOutput: "Implemented and tested.",
      metadata,
      existingPull: null
    },
    {
      withTempJson(value, callback) {
        payload = value;
        return callback("/tmp/pr.json");
      },
      getRepositoryNodeId: () => "R_repo",
      ghJson(args) {
        apiArgs = args;
        return { data: { createPullRequest: { pullRequest: { number: 9, url: "https://example.test/pull/9" } } } };
      }
    }
  );

  assert.deepEqual(apiArgs, ["api", "graphql", "--input", "/tmp/pr.json"]);
  assert.match(payload.query, /createPullRequest/);
  assert.equal(payload.variables.repositoryId, "R_repo");
  assert.equal(payload.variables.headRefName, "agent/issue-42-fix-duplicate-intake");
  assert.equal(payload.variables.baseRefName, "main");
  assert.match(payload.variables.body, /Closes #42/);
  assert.deepEqual(result, { action: "created", number: 9, url: "https://example.test/pull/9" });
});

test("upsertPullRequest updates an existing PR instead of creating a duplicate", () => {
  let payload;
  let apiArgs;
  const result = upsertPullRequest(
    {
      config,
      issue,
      branch: "agent/issue-42-old-title",
      codexOutput: "Retry output.",
      metadata,
      existingPull: { number: 9, node_id: "PR_9" }
    },
    {
      withTempJson(value, callback) {
        payload = value;
        return callback("/tmp/pr.json");
      },
      ghJson(args) {
        apiArgs = args;
        return { data: { updatePullRequest: { pullRequest: { number: 9, url: "https://example.test/pull/9" } } } };
      }
    }
  );

  assert.deepEqual(apiArgs, ["api", "graphql", "--input", "/tmp/pr.json"]);
  assert.match(payload.query, /updatePullRequest/);
  assert.deepEqual(payload.variables.id, "PR_9");
  assert.deepEqual(result, { action: "updated", number: 9, url: "https://example.test/pull/9" });
});

test("existing open PR and orphan branch names survive issue title changes", () => {
  const preferred = preferredBranchName(42, "New title");
  const pulls = [
    {
      number: 8,
      state: "closed",
      merged_at: "2026-07-01T00:00:00Z",
      head: { ref: preferred, repo: { full_name: "owner/repo" } },
      base: { ref: "main" }
    },
    {
      number: 9,
      state: "open",
      merged_at: null,
      head: { ref: "agent/issue-42-old-title", repo: { full_name: "owner/repo" } },
      base: { ref: "main" }
    }
  ];
  const existing = selectExistingPull(pulls, config, 42, preferred);

  assert.equal(existing.number, 9);
  assert.equal(chooseAgentBranch(preferred, existing, []), "agent/issue-42-old-title");
  assert.equal(chooseAgentBranch(preferred, null, ["agent/issue-42-orphan"]), "agent/issue-42-orphan");
});

test("pull discovery uses paginated GraphQL and normalizes REST-shaped fields", () => {
  let graphqlArgs;
  const pulls = listPulls(config, {
    ghApiJson: () => assert.fail("healthy GraphQL pull discovery needs no REST request"),
    ghReadJson: (args) => {
      graphqlArgs = args;
      return [
        {
          data: {
            repository: {
              pullRequests: {
                nodes: [
                  {
                    number: 7,
                    id: "PR_7",
                    state: "OPEN",
                    mergedAt: null,
                    url: "https://github.com/repo-owner/repo/pull/7",
                    baseRefName: "main",
                    headRefName: "agent/issue-42-fix",
                    headRepository: { nameWithOwner: "repo-owner/repo" }
                  }
                ]
              }
            }
          }
        },
        {
          data: {
            repository: {
              pullRequests: {
                nodes: [
                  {
                    number: 6,
                    id: "PR_6",
                    state: "MERGED",
                    mergedAt: "2026-07-13T00:00:00Z",
                    url: "https://github.com/repo-owner/repo/pull/6",
                    baseRefName: "main",
                    headRefName: "agent/issue-41-fix",
                    headRepository: { nameWithOwner: "repo-owner/repo" }
                  }
                ]
              }
            }
          }
        }
      ];
    }
  });

  assert.deepEqual(graphqlArgs.slice(0, 4), ["api", "graphql", "--paginate", "--slurp"]);
  assert.match(graphqlArgs.at(-1), /pullRequests\(first:100,after:\$endCursor/);
  assert.deepEqual(pulls[0], {
    number: 7,
    node_id: "PR_7",
    state: "open",
    merged_at: null,
    html_url: "https://github.com/repo-owner/repo/pull/7",
    base: { ref: "main" },
    head: { ref: "agent/issue-42-fix", repo: { full_name: "repo-owner/repo" } }
  });
  assert.equal(pulls[1].state, "closed");
  assert.equal(pulls[1].merged_at, "2026-07-13T00:00:00Z");
});

test("pull discovery falls back to REST after a transient GraphQL outage", () => {
  const rest = [{ number: 7, node_id: "PR_rest_7" }];
  const pulls = listPulls(config, {
    ghReadJson: () => {
      throw new AgentError("gh: HTTP 503", 1);
    },
    ghApiJson: (path, options) => {
      assert.equal(path, "repos/owner/repo/pulls?state=all&base=main&per_page=100");
      assert.deepEqual(options, { paginate: true });
      return rest;
    }
  });

  assert.equal(pulls, rest);
  assert.equal(pulls[0].node_id, "PR_rest_7");
});

test("repository node id uses GraphQL with REST fallback", () => {
  assert.equal(
    getRepositoryNodeId(config, {
      ghApiJson: () => assert.fail("healthy GraphQL needs no REST request"),
      ghReadJson: (args) => {
        assert.deepEqual(args, ["repo", "view", "owner/repo", "--json", "id"]);
        return { id: "R_repo" };
      }
    }),
    "R_repo"
  );

  assert.equal(
    getRepositoryNodeId(config, {
      ghReadJson: () => {
        throw new AgentError("gh: HTTP 503", 1);
      },
      ghApiJson: (path) => {
        assert.equal(path, "repos/owner/repo");
        return { node_id: "R_rest" };
      }
    }),
    "R_rest"
  );
});

test("dispatchCandidateCi runs trusted CI for an immutable PR head", () => {
  let invocation;
  const headSha = "a".repeat(40);
  const result = dispatchCandidateCi(config, 9, headSha, {
    runCommand(command, args) {
      invocation = { command, args };
      return { status: 0 };
    }
  });

  assert.deepEqual(invocation, {
    command: "gh",
    args: [
      "workflow",
      "run",
      "ci.yml",
      "--repo",
      "owner/repo",
      "--ref",
      "main",
      "-f",
      "pr-number=9",
      "-f",
      `expected-head-sha=${headSha}`
    ]
  });
  assert.deepEqual(result, {
    ok: true,
    workflow: "ci.yml",
    prNumber: 9,
    headSha
  });
});

test("implementation PR inherits automerge and proof policy labels", () => {
  const policyConfig = {
    labels: {
      review: "agent:review",
      automerge: "agent:automerge",
      priorityHigh: "priority:high",
      priorityLow: "priority:low",
      proof: "agent:proof"
    }
  };

  assert.deepEqual(
    implementationPullLabels(policyConfig, ["agent:automerge", "agent:proof"]),
    ["agent:review", "agent:automerge", "agent:proof"]
  );
});

test("blocked source issues cannot enter implementation", () => {
  assert.throws(
    () => assertImplementationSource(config, { number: 42, labels: [{ name: "agent:blocked" }] }),
    (error) => error.code === 1 && /source issue #42 is blocked/.test(error.message)
  );
});

test("automation control-plane files are privileged patch paths", () => {
  assert.deepEqual(
    privilegedPatchPaths([
      "src/safe.ts",
      ".no-mistakes.yaml",
      "scripts/agent-automerge.mjs",
      "packages/agents/AGENTS.md",
      "packages/client/package.json",
      ".claude/skills/local/SKILL.md"
    ]),
    [
      ".no-mistakes.yaml",
      "scripts/agent-automerge.mjs",
      "packages/agents/AGENTS.md",
      "packages/client/package.json",
      ".claude/skills/local/SKILL.md"
    ]
  );
});

test("implementation refuses a source issue changed after triage", () => {
  const snapshot = "f".repeat(64);
  const triage = {
    body: `<!-- agent-triage:v1 -->\n\`\`\`json\n${JSON.stringify({ issueSnapshotSha256: snapshot })}\n\`\`\``
  };

  assert.throws(
    () => assertIssueMatchesTriageSnapshot(issue, triage, "<!-- agent-triage:v1 -->"),
    /changed after trusted triage/
  );
});

test("isolated validation binds patch, output, base, and result tree", (t) => {
  const root = mkdtempSync(join(tmpdir(), "vet-agent-manifest-test-"));
  const cwd = join(root, "repo");
  const candidateDir = join(root, "candidate");
  const preparedPath = join(root, "prepared.json");
  mkdirSync(cwd);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", args, { cwd, encoding: "utf8" });

  git("init", "-q", "-b", "main");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.test");
  writeFileSync(join(cwd, "file.txt"), "before\n");
  git("add", "file.txt");
  git("commit", "-qm", "initial");
  git("update-ref", "refs/remotes/origin/main", "HEAD");
  writeFileSync(join(cwd, "file.txt"), "after\n");
  const patchPath = join(cwd, "change.patch");
  writeFileSync(patchPath, git("diff", "--binary", "HEAD", "--", "file.txt"));
  git("restore", "file.txt");
  const outputPath = join(cwd, "implementation.md");
  const manifestPath = join(cwd, "integrity.json");
  const snapshotSha256 = "b".repeat(64);
  writeFileSync(outputPath, "Implemented safely.\n");
  writeFileSync(
    join(cwd, "implementation-intent.json"),
    `${JSON.stringify({ version: 1, issueNumber: 42, issueSnapshotSha256: snapshotSha256 })}\n`
  );

  assert.throws(
    () =>
      preparePatchValidation(config, 42, patchPath, outputPath, preparedPath, join(cwd, "candidate"), cwd),
    /candidate directory must be isolated/
  );
  assert.throws(
    () =>
      preparePatchValidation(
        config,
        42,
        patchPath,
        outputPath,
        join(candidateDir, "prepared.json"),
        candidateDir,
        cwd
      ),
    /prepared metadata must be isolated/
  );

  const prepared = preparePatchValidation(
    config,
    42,
    patchPath,
    outputPath,
    preparedPath,
    candidateDir,
    cwd
  );
  const manifest = finalizePatchValidation(config, 42, patchPath, outputPath, preparedPath, manifestPath, cwd);
  const verified = verifyValidatedArtifactBase(
    config,
    42,
    patchPath,
    outputPath,
    manifestPath,
    cwd,
    snapshotSha256
  );

  assert.equal(prepared.baseSha, git("rev-parse", "HEAD").trim());
  assert.equal(readFileSync(join(candidateDir, "file.txt"), "utf8"), "after\n");
  assert.equal(manifest.baseSha, prepared.baseSha);
  assert.equal(manifest.resultTree, git("write-tree").trim());
  assert.deepEqual(manifest.changedPaths, ["file.txt"]);
  assert.deepEqual(verified, manifest);

  writeFileSync(patchPath, `${readFileSync(patchPath, "utf8")}\n# tampered\n`);
  assert.throws(
    () => verifyValidatedArtifactBase(config, 42, patchPath, outputPath, manifestPath, cwd, snapshotSha256),
    /patch integrity check failed/
  );
});

test("final validation seal rejects changes to the prepared host tree", (t) => {
  const root = mkdtempSync(join(tmpdir(), "vet-agent-seal-test-"));
  const cwd = join(root, "repo");
  mkdirSync(cwd);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", args, { cwd, encoding: "utf8" });

  git("init", "-q", "-b", "main");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.test");
  writeFileSync(join(cwd, "file.txt"), "before\n");
  git("add", "file.txt");
  git("commit", "-qm", "initial");
  git("update-ref", "refs/remotes/origin/main", "HEAD");
  writeFileSync(join(cwd, "file.txt"), "after\n");
  const patchPath = join(cwd, "change.patch");
  writeFileSync(patchPath, git("diff", "--binary", "HEAD", "--", "file.txt"));
  git("restore", "file.txt");
  const outputPath = join(cwd, "implementation.md");
  writeFileSync(outputPath, "Implemented safely.\n");
  writeFileSync(
    join(cwd, "implementation-intent.json"),
    `${JSON.stringify({ version: 1, issueNumber: 42, issueSnapshotSha256: "d".repeat(64) })}\n`
  );
  const preparedPath = join(root, "prepared.json");
  preparePatchValidation(config, 42, patchPath, outputPath, preparedPath, join(root, "candidate"), cwd);

  writeFileSync(join(cwd, "file.txt"), "tampered\n");
  git("add", "file.txt");
  assert.throws(
    () => finalizePatchValidation(config, 42, patchPath, outputPath, preparedPath, join(root, "manifest.json"), cwd),
    /prepared validation tree changed/
  );
});

test("isolated validation command environment removes credentials and workflow channels", (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "vet-agent-env-test-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const outputPath = join(cwd, "environment.json");
  const names = [
    "AGENT_VALIDATION_CONTAINER",
    "GITHUB_ENV",
    "GITHUB_OUTPUT",
    "ACTIONS_RUNTIME_TOKEN",
    "VERCEL_TOKEN",
    "HCLOUD_TOKEN"
  ];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  for (const name of names) process.env[name] = name === "AGENT_VALIDATION_CONTAINER" ? "1" : "must-not-cross";
  t.after(() => {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  });
  const script = `require("node:fs").writeFileSync(${JSON.stringify(outputPath)}, JSON.stringify({GITHUB_ENV:process.env.GITHUB_ENV,GITHUB_OUTPUT:process.env.GITHUB_OUTPUT,ACTIONS_RUNTIME_TOKEN:process.env.ACTIONS_RUNTIME_TOKEN,VERCEL_TOKEN:process.env.VERCEL_TOKEN,HCLOUD_TOKEN:process.env.HCLOUD_TOKEN}))`;

  runPatchValidationChecks({ commands: { defaultImplementChecks: [`node -e ${JSON.stringify(script)}`] } }, cwd);

  assert.deepEqual(JSON.parse(readFileSync(outputPath, "utf8")), {});
});

test("implementation workflow isolates candidate checks from credentials, artifacts, and command channels", () => {
  const workflow = readFileSync(join(process.cwd(), ".github/workflows/agent-implement.yml"), "utf8");
  const prepare = workflow.slice(workflow.indexOf("  prepare-prompt:"), workflow.indexOf("  generate-patch-remote:"));
  const remote = workflow.slice(workflow.indexOf("  generate-patch-remote:"), workflow.indexOf("  generate-patch:"));
  const fallback = workflow.slice(workflow.indexOf("  generate-patch:"), workflow.indexOf("  validate-patch:"));
  const validation = workflow.slice(workflow.indexOf("  validate-patch:"), workflow.indexOf("  open-pr:"));
  const openPr = workflow.slice(workflow.indexOf("  open-pr:"), workflow.indexOf("  report-failure:"));

  assert.match(workflow, /codex-version: "0\.144\.1"/);
  assert.match(prepare, /concurrency-group: \$\{\{ steps\.concurrency\.outputs\.group \}\}/);
  assert.match(prepare, /agent-concurrency-slot\.mjs --lane implement --key "\$CONCURRENCY_KEY" --json/);
  assert.match(prepare, /id: backend\n\s+run: node scripts\/agent-worker\.mjs --validate-backend --lane implement --json/);
  for (const generator of [remote, fallback]) {
    assert.match(generator, /concurrency:\n      group: \$\{\{ needs\.prepare-prompt\.outputs\.concurrency-group \}\}/);
    assert.match(generator, /cancel-in-progress: false/);
    assert.match(generator, /queue: max/);
  }
  assert.match(fallback, /sandbox: \$\{\{ needs\.prepare-prompt\.outputs\.backend-sandbox \}\}/);
  assert.match(fallback, /model: \$\{\{ needs\.prepare-prompt\.outputs\.backend-model \}\}/);
  assert.match(fallback, /effort: \$\{\{ needs\.prepare-prompt\.outputs\.backend-effort \}\}/);
  assert.doesNotMatch(fallback, /^    env:\n(?:      .+\n)*      (?:OPENAI|CODEX)_API_KEY:/m);
  assert.match(validation, /node:22-bookworm@sha256:[a-f0-9]{64}/);
  assert.match(validation, /npm ci --ignore-scripts/);
  assert.match(validation, /npm rebuild --offline/);
  assert.doesNotMatch(validation, /tar -C \/source/);
  assert.match(validation, /npm_config_nodedir=\/usr\/local/);
  assert.match(validation, /--network none/);
  assert.match(validation, /--user "\$\(id -u\):\$\(id -g\)"/);
  assert.match(validation, /src=\$PWD,dst=\/workspace,readonly/);
  assert.match(validation, /--read-only/);
  assert.match(validation, /node_modules,dst=\/workspace\/node_modules,readonly/);
  assert.match(validation, /::stop-commands::/);
  assert.match(validation, /--prepare-validation/);
  assert.match(validation, /--run-validation-checks/);
  assert.match(validation, /--env AGENT_VALIDATION_CONTAINER=1/);
  assert.match(validation, /--finalize-validation/);
  assert.doesNotMatch(validation, /\$\{\{ secrets\./);
  assert.ok(validation.indexOf("npm ci --ignore-scripts") < validation.indexOf("actions/download-artifact"));
  assert.ok(validation.indexOf("--run-validation-checks") < validation.indexOf("--finalize-validation"));
  assert.ok(validation.indexOf("--finalize-validation") < validation.indexOf("actions/upload-artifact"));
  assert.match(openPr, /if: always\(\) && needs\.validate-patch\.result == 'success'/);
});

test("applyPatchIdempotently applies once and recognizes the same committed intent on retry", (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "vet-agent-implement-test-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", args, { cwd, encoding: "utf8" });

  git("init", "-q");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.test");
  writeFileSync(join(cwd, "file.txt"), "before\n");
  git("add", "file.txt");
  git("commit", "-qm", "initial");
  writeFileSync(join(cwd, "file.txt"), "after\n");
  const patch = git("diff", "--binary", "HEAD", "--", "file.txt");
  const patchPath = join(cwd, "change.patch");
  writeFileSync(patchPath, patch);
  git("restore", "file.txt");

  assert.equal(applyPatchIdempotently(patchPath, cwd), "applied");
  assert.equal(readFileSync(join(cwd, "file.txt"), "utf8"), "after\n");
  assert.equal(applyPatchIdempotently(patchPath, cwd), "already-applied");
});

test("alignRecoveredAgentBranch advances only a recovered zero-diff branch", (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "vet-agent-align-test-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

  git("init", "-q", "-b", "main");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.test");
  writeFileSync(join(cwd, "README.md"), "base\n");
  git("add", ".");
  git("commit", "-qm", "base");
  git("switch", "-qc", "agent/issue-42-test");
  git("commit", "--allow-empty", "-qm", "recovered agent head");
  git("switch", "-q", "main");
  writeFileSync(join(cwd, "automation.txt"), "new base\n");
  git("add", ".");
  git("commit", "-qm", "advance base");
  const baseSha = git("rev-parse", "HEAD");
  const baseTree = git("rev-parse", "HEAD^{tree}");
  git("switch", "-q", "agent/issue-42-test");

  const result = alignRecoveredAgentBranch({ baseSha, resultTree: "0".repeat(40) }, cwd);

  assert.equal(result.action, "merged-validated-base");
  assert.equal(git("rev-parse", "HEAD^{tree}"), baseTree);
  assert.doesNotThrow(() => git("merge-base", "--is-ancestor", baseSha, "HEAD"));
});

test("alignRecoveredAgentBranch rejects a divergent implementation tree", (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "vet-agent-align-reject-test-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

  git("init", "-q", "-b", "main");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.test");
  writeFileSync(join(cwd, "README.md"), "base\n");
  git("add", ".");
  git("commit", "-qm", "base");
  git("switch", "-qc", "agent/issue-42-test");
  writeFileSync(join(cwd, "README.md"), "unvalidated\n");
  git("commit", "-qam", "divergent agent change");
  git("switch", "-q", "main");
  writeFileSync(join(cwd, "automation.txt"), "new base\n");
  git("add", ".");
  git("commit", "-qm", "advance base");
  const baseSha = git("rev-parse", "HEAD");
  git("switch", "-q", "agent/issue-42-test");

  assert.throws(
    () => alignRecoveredAgentBranch({ baseSha, resultTree: "0".repeat(40) }, cwd),
    /does not match the validated base or result tree/
  );
});

test("prepared validation checks both sides of a privileged rename", (t) => {
  const root = mkdtempSync(join(tmpdir(), "vet-agent-rename-test-"));
  const cwd = join(root, "repo");
  mkdirSync(cwd);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", args, { cwd, encoding: "utf8" });

  git("init", "-q", "-b", "main");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.test");
  writeFileSync(join(cwd, "AGENTS.md"), "trusted instructions\n");
  git("add", "AGENTS.md");
  git("commit", "-qm", "initial");
  git("update-ref", "refs/remotes/origin/main", "HEAD");
  git("mv", "AGENTS.md", "notes.md");
  const patchPath = join(cwd, "rename.patch");
  writeFileSync(patchPath, git("diff", "--cached", "--binary", "HEAD"));
  git("restore", "--staged", ".");
  git("restore", ".");
  rmSync(join(cwd, "notes.md"));
  const outputPath = join(cwd, "implementation.md");
  writeFileSync(outputPath, "Renamed safely.\n");
  writeFileSync(
    join(cwd, "implementation-intent.json"),
    `${JSON.stringify({ version: 1, issueNumber: 42, issueSnapshotSha256: "c".repeat(64) })}\n`
  );

  assert.throws(
    () =>
      preparePatchValidation(
        config,
        42,
        patchPath,
        outputPath,
        join(root, "prepared.json"),
        join(root, "candidate"),
        cwd
      ),
    (error) => error.code === 1 && error.details.paths.includes("AGENTS.md")
  );
});
