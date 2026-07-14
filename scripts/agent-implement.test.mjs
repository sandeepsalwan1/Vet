import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  applyPatchIdempotently,
  chooseAgentBranch,
  dispatchWorkflowAtRef,
  implementationPullLabels,
  preferredBranchName,
  selectExistingPull,
  upsertPullRequest
} from "./agent-implement.mjs";

const config = {
  repo: { owner: "owner", name: "repo", defaultBranch: "main" },
  labels: {}
};

const issue = { number: 42, title: "Fix duplicate intake" };
const metadata = { sourceIssue: 42, automergeEligible: true };

test("upsertPullRequest creates a draft PR through the REST API", () => {
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
      ghJson(args) {
        apiArgs = args;
        return { number: 9, html_url: "https://example.test/pull/9" };
      }
    }
  );

  assert.deepEqual(apiArgs, ["api", "repos/owner/repo/pulls", "-X", "POST", "--input", "/tmp/pr.json"]);
  assert.equal(apiArgs.includes("--json"), false);
  assert.equal(payload.head, "agent/issue-42-fix-duplicate-intake");
  assert.equal(payload.base, "main");
  assert.equal(payload.draft, true);
  assert.match(payload.body, /Closes #42/);
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
      existingPull: { number: 9 }
    },
    {
      withTempJson(value, callback) {
        payload = value;
        return callback("/tmp/pr.json");
      },
      ghJson(args) {
        apiArgs = args;
        return { number: 9, html_url: "https://example.test/pull/9" };
      }
    }
  );

  assert.deepEqual(apiArgs, ["api", "repos/owner/repo/pulls/9", "-X", "PATCH", "--input", "/tmp/pr.json"]);
  assert.equal("head" in payload, false);
  assert.equal("draft" in payload, false);
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

test("dispatchWorkflowAtRef runs CI on the exact agent branch", () => {
  let invocation;
  const result = dispatchWorkflowAtRef(config, "ci.yml", "agent/issue-42-fix-duplicate-intake", {
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
      "agent/issue-42-fix-duplicate-intake"
    ]
  });
  assert.deepEqual(result, {
    ok: true,
    workflow: "ci.yml",
    ref: "agent/issue-42-fix-duplicate-intake"
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
