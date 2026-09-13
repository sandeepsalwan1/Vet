import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { parseImplementationMetadata } from "./agent-lib.mjs";
import { finalizeNativeFixPublication } from "./agent-no-mistakes-gate.mjs";
import {
  applyNativeFixPatch,
  assertNativeFixPatchExcludesSecrets,
  createNativeFixPatch,
} from "./agent-no-mistakes-native-fix.mjs";
import {
  gateRepairDecision,
  normalizeGateArtifact,
  sanitizedGateArtifact,
} from "./agent-no-mistakes-result.mjs";

const config = {
  repo: { owner: "owner", name: "repo", defaultBranch: "main" },
  comments: { gate: "<!-- agent-gate:v1 -->" },
  crabbox: { nonVisualProviders: ["vercel-sandbox", "hetzner"] },
};

function gitAt(cwd, ...args) {
  return execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
  }).trim();
}

function nativeFixPull(overrides = {}) {
  return {
    number: 42,
    body: `<!-- agent-implementation:v1 -->
Agent implementation metadata:
\`\`\`json
{"sourceIssue":42,"sourceLabels":["agent:automerge"],"automergeEligible":true,"issueSnapshotSha256":"${"a".repeat(64)}"}
\`\`\``,
    head: {
      ref: "agent/issue-42-native-fix",
      sha: "1".repeat(40),
    },
    ...overrides,
  };
}

function nativeFixFixture(t) {
  const root = mkdtempSync(join(tmpdir(), "vet-native-fix-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = join(root, "source");
  const origin = join(root, "origin.git");
  const nmHome = join(root, "nm-home");
  const gate = join(nmHome, "repos", "vet.git");
  const patchPath = join(root, "artifact", "fix.patch");
  const branch = "agent/issue-42-native-fix";
  const relativePath = "apps/internal/native-fix.txt";
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
  const nativeFix = createNativeFixPatch(parsed, baseHead, patchPath, {
    nmHome,
  });
  const artifact = sanitizedGateArtifact(parsed, baseHead, { nativeFix });
  return { artifact, baseHead, branch, fixedHead, origin, patchPath, root };
}

function nativeFixArtifactFixture(t) {
  const root = mkdtempSync(join(tmpdir(), "vet-native-fix-artifact-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const baseHead = "1".repeat(40);
  const fixedHead = "2".repeat(40);
  const patchPath = join(root, "fix.patch");
  const patch =
    "diff --git a/app.txt b/app.txt\n--- a/app.txt\n+++ b/app.txt\n@@ -1 +1 @@\n-before\n+after\n";
  writeFileSync(patchPath, patch);
  const nativeFix = {
    baseHead,
    fixedHead,
    fixedTree: "3".repeat(40),
    patchSha256: createHash("sha256").update(patch).digest("hex"),
    paths: ["apps/internal/native-fix.txt"],
  };
  const artifact = sanitizedGateArtifact(
    {
      status: "passed",
      outcome: "passed",
      run: { id: "native-run", head: fixedHead.slice(0, 12) },
      findings: [],
    },
    baseHead,
    { nativeFix },
  );
  return {
    artifact,
    baseHead,
    branch: "agent/issue-42-native-fix",
    fixedHead,
    patchPath,
  };
}

// Policy tests need the Git protocol, not filesystem and process startup.
// Creation and publication contracts below still use real repositories.
function nativeFixGitAdapter({ baseHead, fixedHead, paths }) {
  return {
    nmHome: "/tmp/vet-no-mistakes-test",
    readDirectory: () => [
      { name: "vet.git", isDirectory: () => true },
    ],
    execute: (_command, args) => {
      const gitArgs = args.slice(2);
      if (gitArgs[0] === "rev-parse") {
        return {
          status: 0,
          stdout: `${gitArgs[1].startsWith(baseHead) ? baseHead : fixedHead}\n`,
          stderr: "",
        };
      }
      if (gitArgs[0] === "merge-base") {
        return { status: 0, stdout: "", stderr: "" };
      }
      if (gitArgs[0] === "diff" && gitArgs.includes("--name-only")) {
        return { status: 0, stdout: `${paths.join("\0")}\0`, stderr: "" };
      }
      throw new Error(
        `unexpected native-fix Git command: ${gitArgs.join(" ")}`,
      );
    },
  };
}

test("native no-mistakes fixes become a sealed non-privileged patch", (t) => {
  const fixture = nativeFixFixture(t);

  assert.equal(fixture.artifact.status, "blocked");
  assert.equal(fixture.artifact.outcome, "native-fix");
  assert.equal(fixture.artifact.nativeFix.baseHead, fixture.baseHead);
  assert.equal(fixture.artifact.nativeFix.fixedHead, fixture.fixedHead);
  assert.deepEqual(fixture.artifact.nativeFix.paths, [
    "apps/internal/native-fix.txt",
  ]);
  assert.match(readFileSync(fixture.patchPath, "utf8"), /-before\n\+after/);
  assert.deepEqual(gateRepairDecision(fixture.artifact, 0), {
    state: "native-fix",
    nextAttempt: 1,
  });
  assert.deepEqual(gateRepairDecision(fixture.artifact, 2), {
    state: "native-fix",
    nextAttempt: 3,
  });
  assert.deepEqual(gateRepairDecision(fixture.artifact, 3), {
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

test("trusted publication reapplies the sealed tree with an exact-head lease", (t) => {
  const fixture = nativeFixFixture(t);
  const checkout = join(fixture.root, "apply");
  gitAt(fixture.root, "clone", fixture.origin, checkout);
  const commands = [];
  const execute = (command, args, options = {}) => {
    commands.push([command, args, options]);
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

  const pull = nativeFixPull({
    head: { ref: fixture.branch, sha: fixture.baseHead },
  });
  const published = applyNativeFixPatch(
    {
      artifact: fixture.artifact,
      patchPath: fixture.patchPath,
      pull,
      repairAttempt: 0,
    },
    {
      runCommand: execute,
      publisherEnvironment: () => ({
        GH_TOKEN: "publisher-token",
        GITHUB_TOKEN: "publisher-token",
      }),
    },
  );

  const remoteTree = gitAt(
    fixture.origin,
    "rev-parse",
    `refs/heads/${fixture.branch}^{tree}`,
  );
  assert.equal(remoteTree, fixture.artifact.nativeFix.fixedTree);
  assert.equal(published.nextRepairAttempt, 1);
  assert.match(published.nextHead, /^[0-9a-f]{40}$/);
  assert.deepEqual(
    parseImplementationMetadata(
      gitAt(
        fixture.origin,
        "log",
        "-1",
        "--format=%B",
        `refs/heads/${fixture.branch}`,
      ),
    ),
    parseImplementationMetadata(pull.body),
  );
  assert.ok(
    commands.some(
      ([command, args]) =>
        command === "git" &&
        args.includes(
          `--force-with-lease=refs/heads/${fixture.branch}:${fixture.baseHead}`,
        ),
    ),
  );
  for (const [command, args, options] of commands.filter(
    ([command, args]) =>
      command === "gh" ||
      (command === "git" &&
        ["fetch", "push", "ls-remote"].includes(args[0])),
  )) {
    assert.equal(
      options.env.GH_TOKEN,
      "publisher-token",
      `${command} ${args[0]}`,
    );
  }
});

test("native fix publication fails closed on publish errors", (t) => {
  const fixture = nativeFixArtifactFixture(t);
  const events = [];
  assert.throws(
    () =>
      finalizeNativeFixPublication({
        artifact: fixture.artifact,
        config,
        pull: nativeFixPull({
          head: { ref: fixture.branch, sha: fixture.baseHead },
        }),
        repairAttempt: 0,
        patchPath: fixture.patchPath,
        applyPatch: () => {
          events.push("apply");
          return {
            nextHead: fixture.fixedHead,
            nextRepairAttempt: 1,
            paths: fixture.artifact.nativeFix.paths,
          };
        },
        recordFix: () => {
          events.push("record");
          throw new Error("publish failed");
        },
        setOutput: () => {
          events.push("output");
        },
      }),
    /publish failed/,
  );
  assert.deepEqual(events, ["apply", "record"]);
});

test("native fix publication dry-run validates without mutating git or GitHub", (t) => {
  const fixture = nativeFixArtifactFixture(t);
  const commands = [];
  const published = applyNativeFixPatch(
    {
      artifact: fixture.artifact,
      patchPath: fixture.patchPath,
      pull: nativeFixPull({
        head: { ref: fixture.branch, sha: fixture.baseHead },
      }),
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
  assert.match(readFileSync(fixture.patchPath, "utf8"), /-before\n\+after/);
});

test("native no-mistakes patches cannot modify automation control files", (t) => {
  const root = mkdtempSync(join(tmpdir(), "vet-native-fix-policy-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const baseHead = "4".repeat(40);
  const fixedHead = "5".repeat(40);
  assert.throws(
    () =>
      createNativeFixPatch(
        {
          status: "passed",
          outcome: "passed",
          run: { id: "native-run", head: fixedHead.slice(0, 12) },
          findings: [],
        },
        baseHead,
        join(root, "fix.patch"),
        nativeFixGitAdapter({
          baseHead,
          fixedHead,
          paths: ["scripts/agent-danger.mjs"],
        }),
      ),
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
