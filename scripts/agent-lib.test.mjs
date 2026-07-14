import assert from "node:assert/strict";
import test from "node:test";

import {
  actionsRunUrl,
  assertTrustedAgentPull,
  candidatePaths,
  commentHasManagedMarker,
  dispatchWorkflow,
  issueSnapshotSha256,
  newestManagedComment,
  parseImplementationMetadata,
  privilegedCandidatePaths,
  trustedManagedComment,
  upsertManagedComment
} from "./agent-lib.mjs";

const marker = "<!-- agent-triage:v1 -->";
const config = { repo: { owner: "repo-owner", name: "repo" } };

function comment(id, login, body = `${marker}\nbody`, updatedAt = `2026-07-13T00:00:0${id}Z`) {
  return { id, body, updated_at: updatedAt, user: { login } };
}

test("managed comment markers match exact stage prefixes only", () => {
  const base = "<!-- agent-gate:v1 -->";
  const implement = `${base}\n<!-- agent-gate-implement:v1 -->`;
  const noMistakes = `${base}\n<!-- agent-gate-no-mistakes:v1 -->`;

  assert.equal(commentHasManagedMarker(`${implement}\nbody`, implement), true);
  assert.equal(commentHasManagedMarker(`${noMistakes}\nbody`, implement), false);
  assert.equal(commentHasManagedMarker(`prefix ${implement}\nbody`, implement), false);
});

test("workflow dispatch can target an exact branch", () => {
  const dispatchConfig = { repo: { owner: "owner", name: "repo" } };
  assert.deepEqual(dispatchWorkflow(dispatchConfig, "ci.yml", {}, true, "agent/issue-42-fix"), {
    ok: true,
    dryRun: true,
    workflow: "ci.yml",
    fields: {},
    ref: "agent/issue-42-fix"
  });
});

test("managed comments require an exact prefix and trusted author", () => {
  assert.equal(trustedManagedComment(comment(1, "github-actions[bot]"), marker, "repo-owner"), true);
  assert.equal(trustedManagedComment(comment(2, "repo-owner"), marker, "repo-owner"), true);
  assert.equal(trustedManagedComment(comment(3, "someone"), marker, "repo-owner"), false);
  assert.equal(trustedManagedComment({ body: `${marker}\nbody` }, marker, ""), false);
  assert.equal(
    trustedManagedComment(comment(4, "github-actions[bot]", `text before ${marker}\nbody`), marker, "repo-owner"),
    false
  );
});

test("newest trusted managed comment wins over a newer marker squatter", () => {
  const selected = newestManagedComment(
    [
      comment(1, "github-actions[bot]", undefined, "2026-07-13T00:00:01Z"),
      comment(2, "repo-owner", undefined, "2026-07-13T00:00:02Z"),
      comment(3, "someone", undefined, "2026-07-13T00:00:03Z")
    ],
    marker,
    "repo-owner"
  );

  assert.equal(selected.id, 2);
});

test("upsert creates a new comment instead of patching an untrusted marker squatter", () => {
  let apiArgs;
  let patchCalled = false;
  const result = upsertManagedComment(
    { config, number: 9, marker, body: "managed body" },
    {
      getIssueComments: () => [comment(7, "someone")],
      withTempJson: (_payload, callback) => callback("/tmp/comment.json"),
      gh: () => {
        patchCalled = true;
      },
      ghJson: (args) => {
        apiArgs = args;
        return { id: 8 };
      }
    }
  );

  assert.equal(patchCalled, false);
  assert.deepEqual(apiArgs, ["api", "repos/repo-owner/repo/issues/9/comments", "-X", "POST", "--input", "/tmp/comment.json"]);
  assert.deepEqual(result, { ok: true, action: "created", commentId: 8 });
});

test("privileged candidate policy covers nested instructions, agent roots, package controls, and rename sources", () => {
  const files = [
    { filename: "src/safe.ts" },
    { filename: "docs/old.md", previous_filename: "docs/AGENTS.md" },
    { filename: "packages/client/.codex/config.toml" },
    { filename: "packages/widget/package.json" },
    { filename: "skills/local/SKILL.md" },
    { filename: "scripts/agent-new.mjs" }
  ];

  assert.deepEqual(candidatePaths(files), [
    "src/safe.ts",
    "docs/old.md",
    "docs/AGENTS.md",
    "packages/client/.codex/config.toml",
    "packages/widget/package.json",
    "skills/local/SKILL.md",
    "scripts/agent-new.mjs"
  ]);
  assert.deepEqual(privilegedCandidatePaths(files), [
    "docs/AGENTS.md",
    "packages/client/.codex/config.toml",
    "packages/widget/package.json",
    "skills/local/SKILL.md",
    "scripts/agent-new.mjs"
  ]);
});

test("trusted agent pull requires exact bot-authored implementation provenance", () => {
  const sourceIssue = { number: 42, state: "open", title: "Fix flow", body: "Do the work" };
  const metadata = {
    sourceIssue: 42,
    sourceLabels: ["agent:automerge"],
    automergeEligible: true,
    issueSnapshotSha256: issueSnapshotSha256(sourceIssue)
  };
  const pull = {
    state: "open",
    merged: false,
    merged_at: null,
    changed_files: 1,
    user: { login: "github-actions[bot]" },
    body: `<!-- agent-implementation:v1 -->\nAgent implementation metadata:\n\`\`\`json\n${JSON.stringify(metadata)}\n\`\`\``,
    head: {
      ref: "agent/issue-42-fix-flow",
      sha: "a".repeat(40),
      repo: { full_name: "repo-owner/repo" }
    },
    base: { ref: "main", repo: { full_name: "repo-owner/repo" } }
  };
  const trustConfig = { repo: { owner: "repo-owner", name: "repo", defaultBranch: "main" } };

  assert.deepEqual(
    assertTrustedAgentPull(pull, trustConfig, { files: [{ filename: "src/safe.ts" }], sourceIssue }),
    { metadata, sourceIssue: 42 }
  );
  assert.deepEqual(parseImplementationMetadata(pull.body), metadata);
  assert.throws(
    () => assertTrustedAgentPull({ ...pull, user: { login: "contributor" } }, trustConfig),
    /author must be github-actions\[bot\]/
  );
  assert.throws(
    () => assertTrustedAgentPull(pull, trustConfig, { files: [{ filename: "src/CLAUDE.md" }] }),
    /privileged candidate paths/
  );
});

test("Actions run URLs bind statuses to this repository", () => {
  const runConfig = { repo: { owner: "repo-owner", name: "repo" } };
  assert.equal(
    actionsRunUrl(runConfig, {
      GITHUB_SERVER_URL: "https://github.com",
      GITHUB_REPOSITORY: "repo-owner/repo",
      GITHUB_RUN_ID: "123"
    }),
    "https://github.com/repo-owner/repo/actions/runs/123"
  );
  assert.equal(
    actionsRunUrl(runConfig, {
      GITHUB_SERVER_URL: "https://github.com",
      GITHUB_REPOSITORY: "attacker/repo",
      GITHUB_RUN_ID: "123"
    }),
    ""
  );
});
