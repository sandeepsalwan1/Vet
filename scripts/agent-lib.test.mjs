import assert from "node:assert/strict";
import test from "node:test";

import {
  AgentError,
  actionsRunUrl,
  assertTrustedAgentPull,
  candidatePaths,
  commentHasManagedMarker,
  dispatchWorkflow,
  ghApiJson,
  ghReadJson,
  getIssueComments,
  getIssueNodeId,
  getPullDiff,
  getPullFiles,
  getPullRequest,
  getPullSnapshot,
  implementationCommitMessage,
  issueSnapshotSha256,
  isTransientGitHubReadError,
  newestManagedComment,
  parseImplementationMetadata,
  privilegedCandidatePaths,
  runCommand,
  skipsNoMistakesForCost,
  trustedManagedComment,
  upsertManagedComment
} from "./agent-lib.mjs";

const marker = "<!-- agent-triage:v1 -->";
const config = { repo: { owner: "repo-owner", name: "repo" } };

test("runCommand accepts an explicit capture limit for bounded delegated output", () => {
  const result = runCommand(process.execPath, ["-e", "process.stdout.write('x'.repeat(1_500_000))"], {
    maxBuffer: 2 * 1024 * 1024
  });

  assert.equal(result.status, 0);
  assert.equal(result.stdout.length, 1_500_000);
});

function comment(id, login, body = `${marker}\nbody`, updatedAt = `2026-07-13T00:00:0${id}Z`) {
  return { id, body, updated_at: updatedAt, user: { login } };
}

function treeEntry(path, sha = "c".repeat(40)) {
  return { path, mode: "100644", sha, type: "blob" };
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
  let apiPayload;
  let patchCalled = false;
  const result = upsertManagedComment(
    { config, number: 9, marker, body: "managed body" },
    {
      getIssueComments: () => [comment(7, "someone")],
      getIssueNodeId: () => "I_issue_9",
      withTempJson: (payload, callback) => {
        apiPayload = payload;
        return callback("/tmp/comment.json");
      },
      gh: () => {
        patchCalled = true;
      },
      ghJson: (args) => {
        apiArgs = args;
        return { data: { addComment: { commentEdge: { node: { id: "IC_8" } } } } };
      }
    }
  );

  assert.equal(patchCalled, false);
  assert.deepEqual(apiArgs, ["api", "graphql", "--input", "/tmp/comment.json"]);
  assert.deepEqual(apiPayload.variables, {
    subjectId: "I_issue_9",
    body: `${marker}\nmanaged body\n`
  });
  assert.match(apiPayload.query, /addComment/);
  assert.deepEqual(result, { ok: true, action: "created", commentId: "IC_8" });
});

test("issue comments use paginated GraphQL and normalize Actions identity", () => {
  let graphqlArgs;
  const comments = getIssueComments(config, 9, {
    ghApiJson: () => assert.fail("healthy GraphQL comments need no REST request"),
    ghReadJson: (args) => {
      graphqlArgs = args;
      return [
        {
          data: {
            repository: {
              issueOrPullRequest: {
                comments: {
                  nodes: [
                    {
                      id: "IC_7",
                      databaseId: 7,
                      body: `${marker}\nbody`,
                      createdAt: "2026-07-13T00:00:01Z",
                      updatedAt: null,
                      author: { login: "github-actions" }
                    }
                  ]
                }
              }
            }
          }
        },
        {
          data: {
            repository: {
              issueOrPullRequest: {
                comments: {
                  nodes: [
                    {
                      id: "IC_8",
                      databaseId: 8,
                      body: "second page",
                      createdAt: "2026-07-13T00:00:02Z",
                      updatedAt: "2026-07-13T00:00:03Z",
                      author: { login: "repo-owner" }
                    }
                  ]
                }
              }
            }
          }
        }
      ];
    }
  });

  assert.deepEqual(graphqlArgs.slice(0, 4), ["api", "graphql", "--paginate", "--slurp"]);
  assert.equal(graphqlArgs.includes("owner=repo-owner"), true);
  assert.equal(graphqlArgs.includes("name=repo"), true);
  assert.equal(graphqlArgs.includes("number=9"), true);
  assert.match(graphqlArgs.at(-1), /comments\(first:100,after:\$endCursor\)/);
  assert.equal(comments.length, 2);
  assert.equal(comments[0].user.login, "github-actions[bot]");
  assert.equal(comments[0].updated_at, "2026-07-13T00:00:01Z");
  assert.equal(trustedManagedComment(comments[0], marker, "repo-owner"), true);
});

test("newest managed comment uses GraphQL database ids when timestamps tie", () => {
  const timestamp = "2026-07-13T00:00:01Z";
  const selected = newestManagedComment(
    [
      { ...comment("IC_z", "github-actions[bot]", undefined, timestamp), database_id: 7 },
      { ...comment("IC_a", "github-actions[bot]", undefined, timestamp), database_id: 8 }
    ],
    marker,
    "repo-owner"
  );

  assert.equal(selected.id, "IC_a");
});

test("issue comments fall back to REST after a transient GraphQL outage", () => {
  const rest = [comment(7, "github-actions[bot]", `${marker}\nbody`, "2026-07-13T00:00:01Z")];
  const comments = getIssueComments(config, 9, {
    ghReadJson: () => {
      throw new AgentError("GitHub API read failed after 4 attempts", 1, {
        stderr: "gh: HTTP 503"
      });
    },
    ghApiJson: (path, options) => {
      assert.equal(path, "repos/repo-owner/repo/issues/9/comments");
      assert.deepEqual(options, { paginate: true });
      return rest;
    }
  });

  assert.equal(comments, rest);
});

test("managed GraphQL comments update in place", () => {
  let payload;
  const result = upsertManagedComment(
    { config, number: 9, marker, body: "new body" },
    {
      getIssueComments: () => [
        comment("IC_7", "github-actions[bot]", `${marker}\nold body`, "2026-07-13T00:00:01Z")
      ],
      getIssueNodeId: () => assert.fail("an existing comment needs no issue lookup"),
      withTempJson: (value, callback) => {
        payload = value;
        return callback("/tmp/comment.json");
      },
      gh: () => assert.fail("GraphQL comments must not use REST patching"),
      ghJson: (args) => {
        assert.deepEqual(args, ["api", "graphql", "--input", "/tmp/comment.json"]);
        return { data: { updateIssueComment: { issueComment: { id: "IC_7" } } } };
      }
    }
  );

  assert.match(payload.query, /updateIssueComment/);
  assert.deepEqual(payload.variables, { id: "IC_7", body: `${marker}\nnew body\n` });
  assert.deepEqual(result, { ok: true, action: "updated", commentId: "IC_7" });
});

test("issue node id uses GraphQL with REST fallback", () => {
  assert.equal(
    getIssueNodeId(config, 9, {
      ghApiJson: () => assert.fail("healthy GraphQL needs no REST request"),
      ghReadJson: (args) => {
        assert.deepEqual(args, ["issue", "view", "9", "--repo", "repo-owner/repo", "--json", "id"]);
        return { id: "I_issue_9" };
      }
    }),
    "I_issue_9"
  );

  assert.equal(
    getIssueNodeId(config, 9, {
      ghReadJson: () => {
        throw new AgentError("gh: HTTP 503", 1);
      },
      ghApiJson: (path) => {
        assert.equal(path, "repos/repo-owner/repo/issues/9");
        return { node_id: "I_issue_rest_9" };
      }
    }),
    "I_issue_rest_9"
  );
});

test("issue node id fails closed on malformed GraphQL metadata", () => {
  assert.throws(
    () => getIssueNodeId(config, 9, {
      ghReadJson: () => ({ id: null }),
      ghApiJson: () => assert.fail("malformed GraphQL metadata must not fall back")
    }),
    /GraphQL node id response is invalid/
  );
});

test("pull metadata uses GraphQL and normalizes the trusted REST shape", () => {
  const pull = getPullRequest(config, 9, {
    ghApiJson: () => assert.fail("healthy GraphQL pull metadata needs no REST request"),
    ghReadJson: (args) => {
      assert.deepEqual(args.slice(0, 6), ["pr", "view", "9", "--repo", "repo-owner/repo", "--json"]);
      return {
        number: 9,
        id: "PR_9",
        state: "OPEN",
        mergedAt: null,
        mergeCommit: null,
        mergeable: "MERGEABLE",
        mergeStateStatus: "CLEAN",
        isDraft: true,
        autoMergeRequest: null,
        changedFiles: 1,
        title: "Agent PR",
        body: "body",
        url: "https://example.test/pull/9",
        author: { login: "app/github-actions" },
        mergedBy: { login: "github-actions" },
        baseRefName: "main",
        baseRefOid: "a".repeat(40),
        headRefName: "agent/issue-9-fix",
        headRefOid: "b".repeat(40),
        headRepository: { nameWithOwner: "repo-owner/repo" }
      };
    }
  });

  assert.equal(pull.state, "open");
  assert.equal(pull.user.login, "github-actions[bot]");
  assert.equal(pull.merged_by.login, "github-actions[bot]");
  assert.equal(pull.head.repo.full_name, "repo-owner/repo");
  assert.equal(pull.base.repo.full_name, "repo-owner/repo");
  assert.equal(pull.mergeable_state, "clean");
  assert.equal(pull.draft, true);
});

test("pull metadata falls back to REST after a transient GraphQL outage", () => {
  const rest = { number: 9, head: { sha: "b".repeat(40) } };
  assert.equal(
    getPullRequest(config, 9, {
      ghReadJson: () => {
        throw new AgentError("gh: HTTP 503", 1);
      },
      ghApiJson: (path) => {
        assert.equal(path, "repos/repo-owner/repo/pulls/9");
        return rest;
      }
    }),
    rest
  );
});

test("pull files use complete head-bound GraphQL pagination beyond the compare limit", () => {
  const pull = {
    number: 9,
    changed_files: 301,
    base: { sha: "a".repeat(40) },
    head: { sha: "b".repeat(40) }
  };
  const nodes = Array.from({ length: 301 }, (_, index) => ({
    path: `docs/file-${index}.md`,
    additions: 1,
    deletions: 0,
    changeType: "MODIFIED"
  }));
  nodes[300] = {
    path: "docs/renamed.md",
    additions: 0,
    deletions: 0,
    changeType: "RENAMED"
  };
  const pages = [nodes.slice(0, 100), nodes.slice(100, 200), nodes.slice(200, 300), nodes.slice(300)].map(
    (pageNodes) => ({
      data: {
        repository: {
          pullRequest: {
            number: 9,
            changedFiles: 301,
            baseRefOid: "a".repeat(40),
            headRefOid: "b".repeat(40),
            files: { nodes: pageNodes }
          }
        }
      }
    })
  );
  const files = getPullFiles(config, pull, {
    ghApiJson: (path) => {
      const unchanged = nodes.slice(0, 300).map((node) => treeEntry(node.path));
      if (path.endsWith(`${"a".repeat(40)}?recursive=1`)) {
        return {
          truncated: false,
          tree: [...unchanged, treeEntry("docs/original.md")]
        };
      }
      if (path.endsWith(`${"b".repeat(40)}?recursive=1`)) {
        return {
          truncated: false,
          tree: [...unchanged, treeEntry("docs/renamed.md")]
        };
      }
      return assert.fail(`unexpected immutable tree request: ${path}`);
    },
    ghReadJson: (args) => {
      assert.ok(args.includes("--paginate"));
      assert.ok(args.includes("number=9"));
      return pages;
    }
  });

  assert.equal(files.length, 301);
  assert.deepEqual(files[300], {
    filename: "docs/renamed.md",
    status: "renamed",
    additions: 0,
    deletions: 0,
    changes: 0,
    previous_filename: "docs/original.md"
  });
});

test("pull file renames preserve immutable source paths", () => {
  const pull = {
    number: 9,
    changed_files: 1,
    base: { sha: "a".repeat(40) },
    head: { sha: "b".repeat(40) }
  };
  const compared = [{
    filename: "docs/new.md",
    previous_filename: ".github/workflows/old.yml",
    status: "renamed"
  }];
  const files = getPullFiles(config, pull, {
    ghReadJson: () => [{
      data: {
        repository: {
          pullRequest: {
            number: 9,
            changedFiles: 1,
            baseRefOid: "a".repeat(40),
            headRefOid: "b".repeat(40),
            files: {
              nodes: [{ path: "docs/new.md", additions: 0, deletions: 0, changeType: "RENAMED" }]
            }
          }
        }
      }
    }],
    ghApiJson: (path) => {
      if (path.endsWith(`${"a".repeat(40)}?recursive=1`)) {
        return {
          truncated: false,
          tree: [treeEntry(compared[0].previous_filename)]
        };
      }
      if (path.endsWith(`${"b".repeat(40)}?recursive=1`)) {
        return {
          truncated: false,
          tree: [treeEntry(compared[0].filename)]
        };
      }
      return assert.fail(`unexpected immutable tree request: ${path}`);
    }
  });

  assert.equal(files[0].previous_filename, ".github/workflows/old.yml");
  assert.deepEqual(privilegedCandidatePaths(files), [".github/workflows/old.yml"]);
});

test("small pull file reads fall back to the immutable comparison after a transient GraphQL outage", () => {
  const pull = {
    number: 9,
    changed_files: 1,
    base: { sha: "a".repeat(40) },
    head: { sha: "b".repeat(40) }
  };
  const files = [{ filename: "docs/readme.md", status: "modified" }];
  assert.equal(
    getPullFiles(config, pull, {
      ghReadJson: () => {
        throw new AgentError("gh: HTTP 503", 1);
      },
      ghApiJson: (path) => {
        assert.equal(path, `repos/repo-owner/repo/compare/${"a".repeat(40)}...${"b".repeat(40)}`);
        return { files };
      }
    }),
    files
  );
});

test("large pull file reads fall back to a complete immutable tree diff", () => {
  const pull = {
    number: 9,
    changed_files: 301,
    base: { sha: "a".repeat(40) },
    head: { sha: "b".repeat(40) }
  };
  const paths = Array.from({ length: 301 }, (_, index) => `docs/file-${index}.md`);
  const files = getPullFiles(config, pull, {
    ghReadJson: () => {
      throw new AgentError("gh: HTTP 503", 1);
    },
    ghApiJson: (path) => {
      if (path.endsWith(`${"a".repeat(40)}?recursive=1`)) {
        return { truncated: true, sha: "e".repeat(40), tree: [] };
      }
      if (path.endsWith(`${"b".repeat(40)}?recursive=1`)) {
        return { truncated: true, sha: "f".repeat(40), tree: [] };
      }
      if (path.endsWith("e".repeat(40))) {
        return {
          truncated: false,
          tree: [{ path: "docs", mode: "040000", sha: "1".repeat(40), type: "tree" }]
        };
      }
      if (path.endsWith("f".repeat(40))) {
        return {
          truncated: false,
          tree: [{ path: "docs", mode: "040000", sha: "2".repeat(40), type: "tree" }]
        };
      }
      if (path.endsWith("1".repeat(40))) {
        return {
          truncated: false,
          tree: paths.map((value) => treeEntry(value.replace("docs/", ""), "c".repeat(40)))
        };
      }
      if (path.endsWith("2".repeat(40))) {
        return {
          truncated: false,
          tree: paths.map((value) => treeEntry(value.replace("docs/", ""), "d".repeat(40)))
        };
      }
      return assert.fail(`unexpected immutable tree request: ${path}`);
    }
  });

  assert.equal(files.length, 301);
  assert.ok(files.every((file) => file.status === "modified"));
});

test("pull diff and snapshot stay bound to exact commits", () => {
  const pull = {
    number: 9,
    changed_files: 1,
    base: { sha: "a".repeat(40) },
    head: { sha: "b".repeat(40) }
  };
  const files = [{ filename: "docs/readme.md", status: "modified" }];
  assert.equal(
    getPullDiff(config, pull, {
      ghRead: (args) => {
        assert.deepEqual(args.slice(0, 4), ["api", "-H", "Accept: application/vnd.github.v3.diff", `repos/repo-owner/repo/compare/${"a".repeat(40)}...${"b".repeat(40)}`]);
        return { stdout: "diff --git a/docs/readme.md b/docs/readme.md\n" };
      }
    }),
    "diff --git a/docs/readme.md b/docs/readme.md\n"
  );
  assert.deepEqual(
    getPullSnapshot(config, 9, {
      getPullRequest: () => pull,
      getPullFiles: () => files
    }),
    { pull, files }
  );
});

test("GitHub API reads retry transient service failures with bounded backoff", () => {
  let calls = 0;
  const delays = [];
  const retries = [];
  const result = ghApiJson(
    "repos/repo-owner/repo/issues/9/comments",
    { paginate: true },
    {
      delays: [10, 20, 40],
      sleep: (delay) => delays.push(delay),
      onRetry: (attempt, delay) => retries.push({ attempt, delay }),
      ghJson: (args) => {
        calls += 1;
        assert.deepEqual(args, [
          "api",
          "repos/repo-owner/repo/issues/9/comments",
          "--paginate",
          "--slurp"
        ]);
        if (calls < 3) {
          throw new AgentError("gh api exited 1", 1, {
            stdout: "<!DOCTYPE html><title>Unicorn</title>",
            stderr: "gh: HTTP 503"
          });
        }
        return [[{ id: 1 }], [{ id: 2 }]];
      }
    }
  );

  assert.deepEqual(result, [{ id: 1 }, { id: 2 }]);
  assert.equal(calls, 3);
  assert.deepEqual(delays, [10, 20]);
  assert.deepEqual(retries, [
    { attempt: 1, delay: 10 },
    { attempt: 2, delay: 20 }
  ]);
});

test("read-only GitHub CLI JSON retries use the same bounded policy", () => {
  let calls = 0;
  const result = ghReadJson(
    ["pr", "view", "9", "--json", "closingIssuesReferences"],
    {},
    {
      delays: [1],
      sleep: () => {},
      onRetry: () => {},
      gh: () => {
        calls += 1;
        if (calls === 1) {
          throw new AgentError("gh pr view exited 1", 1, { stderr: "gh: HTTP 502" });
        }
        return { stdout: '{"closingIssuesReferences":[]}' };
      }
    }
  );

  assert.deepEqual(result, { closingIssuesReferences: [] });
  assert.equal(calls, 2);
});

test("GitHub JSON reads retry HTML-shaped outage responses but not malformed JSON", () => {
  let htmlCalls = 0;
  const recovered = ghReadJson(
    ["api", "repos/repo-owner/repo/issues/9"],
    {},
    {
      delays: [1],
      sleep: () => {},
      onRetry: () => {},
      gh: () => {
        htmlCalls += 1;
        return htmlCalls === 1
          ? { stdout: "<!DOCTYPE html><title>Service unavailable</title>" }
          : { stdout: '{"number":9}' };
      }
    }
  );
  assert.deepEqual(recovered, { number: 9 });
  assert.equal(htmlCalls, 2);

  let malformedCalls = 0;
  assert.throws(
    () =>
      ghReadJson(["api", "repos/repo-owner/repo/issues/9"], {}, {
        delays: [1],
        sleep: () => assert.fail("malformed JSON must not sleep"),
        onRetry: () => assert.fail("malformed JSON must not retry"),
        gh: () => {
          malformedCalls += 1;
          return { stdout: "not-json" };
        }
      }),
    SyntaxError
  );
  assert.equal(malformedCalls, 1);
});

test("GitHub reads retry nonzero HTML outages without an HTTP status string", () => {
  let calls = 0;
  const recovered = ghReadJson(
    ["api", "repos/repo-owner/repo/issues/9/comments"],
    {},
    {
      delays: [1],
      sleep: () => {},
      onRetry: () => {},
      gh: () => {
        calls += 1;
        if (calls === 1) {
          throw new AgentError("gh api exited 1", 1, {
            stdout: "<!DOCTYPE html><title>Service unavailable</title>",
            stderr: ""
          });
        }
        return { stdout: "[]" };
      }
    }
  );

  assert.deepEqual(recovered, []);
  assert.equal(calls, 2);
});

test("GitHub API reads do not retry permanent failures", () => {
  let calls = 0;
  assert.throws(
    () =>
      ghApiJson("repos/repo-owner/repo/issues/9", {}, {
        delays: [1, 2],
        sleep: () => assert.fail("permanent errors must not sleep"),
        onRetry: () => assert.fail("permanent errors must not retry"),
        ghJson: () => {
          calls += 1;
          throw new AgentError("gh: HTTP 404", 1);
        }
      }),
    /HTTP 404/
  );
  assert.equal(calls, 1);
  assert.equal(isTransientGitHubReadError(new AgentError("gh: HTTP 503", 1)), true);
  assert.equal(isTransientGitHubReadError(new AgentError("gh: HTTP 404", 1)), false);
});

test("GitHub API read retries stop at the configured bound and redact HTML", () => {
  let calls = 0;
  assert.throws(
    () =>
      ghApiJson("repos/repo-owner/repo/issues/9", {}, {
        delays: [1, 2],
        sleep: () => {},
        onRetry: () => {},
        ghJson: () => {
          calls += 1;
          throw new AgentError("gh api exited 1", 1, {
            stdout: "<!DOCTYPE html><title>Unicorn</title>",
            stderr: "gh: HTTP 503"
          });
        }
      }),
    (error) => {
      assert.match(error.message, /failed after 3 attempts/);
      assert.doesNotMatch(JSON.stringify(error.details), /DOCTYPE|Unicorn/);
      return true;
    }
  );
  assert.equal(calls, 3);
});

test("privileged candidate policy covers nested instructions, agent roots, package controls, and rename sources", () => {
  const files = [
    { filename: "src/safe.ts" },
    { filename: "docs/old.md", previous_filenames: ["docs/AGENTS.md", ".github/workflows/old.yml"] },
    { filename: "packages/client/.codex/config.toml" },
    { filename: "packages/widget/package.json" },
    { filename: "skills/local/SKILL.md" },
    { filename: "scripts/agent-new.mjs" }
  ];

  assert.deepEqual(candidatePaths(files), [
    "src/safe.ts",
    "docs/old.md",
    "docs/AGENTS.md",
    ".github/workflows/old.yml",
    "packages/client/.codex/config.toml",
    "packages/widget/package.json",
    "skills/local/SKILL.md",
    "scripts/agent-new.mjs"
  ]);
  assert.deepEqual(privilegedCandidatePaths(files), [
    "docs/AGENTS.md",
    ".github/workflows/old.yml",
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
    number: 9,
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
  const commitMessage = implementationCommitMessage("chore: implement agent issue #42", metadata);

  assert.deepEqual(
    assertTrustedAgentPull(
      pull,
      trustConfig,
      { files: [{ filename: "src/safe.ts" }], sourceIssue },
      { ghApiJson: () => [{ commit: { message: commitMessage } }] }
    ),
    { metadata, sourceIssue: 42 }
  );
  assert.deepEqual(parseImplementationMetadata(pull.body), metadata);
  assert.deepEqual(parseImplementationMetadata(commitMessage), metadata);
  assert.deepEqual(
    assertTrustedAgentPull(
      pull,
      trustConfig,
      { files: [{ filename: "src/safe.ts" }], sourceIssue },
      {
        ghApiJson: () => [
          { commit: { message: commitMessage } },
          { commit: { message: "Merge the validated base into the agent branch" } },
        ],
      },
    ),
    { metadata, sourceIssue: 42 },
  );
  assert.deepEqual(
    assertTrustedAgentPull(
      { ...pull, changed_files: 0 },
      trustConfig,
      { files: [], sourceIssue, allowEmptyFiles: true },
      { ghApiJson: () => [{ commit: { message: commitMessage } }] }
    ),
    { metadata, sourceIssue: 42 }
  );
  assert.throws(
    () => assertTrustedAgentPull({ ...pull, changed_files: 0 }, trustConfig, { files: [] }),
    /no complete changed-file inventory/
  );
  assert.throws(
    () => assertTrustedAgentPull({ ...pull, user: { login: "contributor" } }, trustConfig),
    /author must be github-actions\[bot\]/
  );
  assert.throws(
    () =>
      assertTrustedAgentPull(
        {
          ...pull,
          body: `<!-- agent-implementation:v1 -->\nAgent implementation metadata:\n\`\`\`json\n${JSON.stringify({
            ...metadata,
            sourceLabels: [...metadata.sourceLabels, "priority:trivial"]
          })}\n\`\`\``
        },
        trustConfig,
        { files: [{ filename: "src/safe.ts" }], sourceIssue },
        { ghApiJson: () => [{ commit: { message: commitMessage } }] }
      ),
    /implementation metadata does not match the immutable PR commit seal/
  );
  assert.throws(
    () =>
      assertTrustedAgentPull(
        pull,
        trustConfig,
        { files: [{ filename: "src/safe.ts" }], sourceIssue },
        {
          ghApiJson: () => [
            { commit: { message: commitMessage } },
            {
              commit: {
                message: implementationCommitMessage("fix: forged cost lane", {
                  ...metadata,
                  sourceLabels: [...metadata.sourceLabels, "priority:trivial"],
                }),
              },
            },
          ],
        },
      ),
    /implementation metadata does not match the immutable PR commit seal/,
  );
  assert.throws(
    () => assertTrustedAgentPull(pull, trustConfig, { files: [{ filename: "src/CLAUDE.md" }] }),
    /privileged candidate paths/
  );
  assert.throws(
    () =>
      assertTrustedAgentPull(
        pull,
        trustConfig,
        { files: [{ filename: "src/safe.ts" }], sourceIssue },
      ),
    /trusted implementation commit metadata is unavailable/,
  );
});

test("cost-sensitive no-mistakes skip requires immutable and current trivial labels", () => {
  const costConfig = { labels: { priorityTrivial: "priority:trivial" } };
  const metadata = {
    automergeEligible: true,
    sourceLabels: ["agent:automerge", "priority:trivial"],
  };
  assert.equal(
    skipsNoMistakesForCost(costConfig, {
      metadata,
      pullLabels: ["priority:trivial"],
      sourceLabels: ["priority:trivial"],
    }),
    true,
  );
  assert.equal(
    skipsNoMistakesForCost(costConfig, {
      metadata,
      pullLabels: [],
      sourceLabels: ["priority:trivial"],
    }),
    false,
  );
  assert.equal(
    skipsNoMistakesForCost(costConfig, {
      metadata: { ...metadata, sourceLabels: ["agent:automerge"] },
      pullLabels: ["priority:trivial"],
      sourceLabels: ["priority:trivial"],
    }),
    false,
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
