import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  AgentError,
  implementationCommitMessage,
  parseImplementationMetadata,
  privilegedCandidatePaths,
  publisherEnvironment,
  runCommand,
} from "./agent-lib.mjs";
import { gateRepairDecision } from "./agent-no-mistakes-result.mjs";

const MAX_NATIVE_FIX_PATCH_BYTES = 2_000_000;
const SECRET_ENV_NAME = /(key|secret|token|password|credential)/i;
const MIN_SCANNED_SECRET_LENGTH = 12;

function writePrivateFile(path, content, mode = 0o600) {
  const target = resolve(path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content, { mode });
  chmodSync(target, mode);
  return target;
}

function gateGit(execute, gateDir, args, options = {}) {
  return execute("git", ["--git-dir", gateDir, ...args], options);
}

export function assertNativeFixPatchExcludesSecrets(
  patch,
  environment = process.env,
) {
  const content = Buffer.isBuffer(patch)
    ? patch
    : Buffer.from(String(patch ?? ""));
  if (content.includes(Buffer.from("\nGIT binary patch\n"))) {
    throw new AgentError(
      "native no-mistakes fixes cannot contain binary changes",
      1,
    );
  }
  for (const [name, rawValue] of Object.entries(environment ?? {})) {
    const value = String(rawValue ?? "");
    if (
      SECRET_ENV_NAME.test(name) &&
      value.length >= MIN_SCANNED_SECRET_LENGTH &&
      content.includes(Buffer.from(value))
    ) {
      throw new AgentError(
        "native no-mistakes fix patch contains a credential value",
        1,
      );
    }
  }
  return true;
}

export function createNativeFixPatch(
  gate,
  expectedHead,
  patchPath,
  {
    nmHome = process.env.NM_HOME,
    environment = process.env,
    execute = runCommand,
    readDirectory = readdirSync,
    publishedHead = expectedHead,
  } = {},
) {
  if (gate?.status !== "passed" || !gate?.run?.head) return null;
  const home = String(nmHome ?? "").trim();
  if (!home) {
    throw new AgentError("missing no-mistakes home for native fixes", 1);
  }
  const reposDir = resolve(home, "repos");
  let entries;
  try {
    entries = readDirectory(reposDir, { withFileTypes: true });
  } catch {
    throw new AgentError("no-mistakes gate repository is unavailable", 1);
  }

  // Resolve exactly one bare gate repository containing both immutable commits.
  const matches = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.endsWith(".git")) continue;
    const gateDir = join(reposDir, entry.name);
    const base = gateGit(
      execute,
      gateDir,
      ["rev-parse", `${expectedHead}^{commit}`],
      { check: false },
    );
    const fixed = gateGit(
      execute,
      gateDir,
      ["rev-parse", `${gate.run.head}^{commit}`],
      { check: false },
    );
    if (base.status === 0 && fixed.status === 0) {
      matches.push({
        gateDir,
        baseHead: base.stdout.trim(),
        fixedHead: fixed.stdout.trim(),
      });
    }
  }
  if (matches.length !== 1) {
    throw new AgentError(
      "could not uniquely resolve the no-mistakes fix repository",
      1,
    );
  }
  const match = matches[0];
  if (match.baseHead !== expectedHead) {
    throw new AgentError(
      "no-mistakes fix base does not match the prepared head",
      1,
    );
  }
  if (match.fixedHead === expectedHead) return null;
  const ancestry = gateGit(
    execute,
    match.gateDir,
    ["merge-base", "--is-ancestor", expectedHead, match.fixedHead],
    { check: false },
  );
  if (ancestry.status !== 0) {
    throw new AgentError(
      "no-mistakes fixes are not based on the prepared head",
      1,
    );
  }
  const paths = gateGit(execute, match.gateDir, [
    "diff",
    "--name-only",
    "--no-renames",
    "-z",
    expectedHead,
    match.fixedHead,
    "--",
    ".",
  ]).stdout
    .split("\0")
    .filter(Boolean);
  if (!paths.length) {
    throw new AgentError("no-mistakes fix commit has no effective changes", 1);
  }
  const privileged = privilegedCandidatePaths(paths);
  if (privileged.length) {
    throw new AgentError(
      "no-mistakes fix touched privileged candidate paths",
      1,
      { paths: privileged },
    );
  }
  const patch = gateGit(execute, match.gateDir, [
    "diff",
    "--binary",
    "--no-ext-diff",
    expectedHead,
    match.fixedHead,
    "--",
    ".",
  ]).stdout;
  if (!patch.trim()) {
    throw new AgentError("no-mistakes fix patch is empty", 1);
  }
  if (Buffer.byteLength(patch) > MAX_NATIVE_FIX_PATCH_BYTES) {
    throw new AgentError(
      "no-mistakes fix patch exceeds the trusted size limit",
      1,
    );
  }
  assertNativeFixPatchExcludesSecrets(patch, environment);
  const fixedTree = gateGit(execute, match.gateDir, [
    "rev-parse",
    `${match.fixedHead}^{tree}`,
  ]).stdout.trim();
  writePrivateFile(patchPath, patch);
  return {
    baseHead: publishedHead,
    fixedHead: match.fixedHead,
    fixedTree,
    patchSha256: createHash("sha256").update(patch).digest("hex"),
    paths,
  };
}

function sortedUnique(values) {
  return [...new Set(values)].sort();
}

export function applyNativeFixPatch(
  { artifact, patchPath, pull, repairAttempt = 0, dryRun = false },
  dependencies = {},
) {
  const decision = gateRepairDecision(artifact, repairAttempt);
  if (decision.state !== "native-fix") {
    throw new AgentError(
      "native no-mistakes fix is not eligible for publication",
      1,
    );
  }
  const execute = dependencies.runCommand ?? runCommand;
  const readFile = dependencies.readFileSync ?? readFileSync;
  const patch = readFile(resolve(patchPath));
  const patchSha256 = createHash("sha256").update(patch).digest("hex");
  if (patchSha256 !== artifact.nativeFix.patchSha256) {
    throw new AgentError(
      "native no-mistakes fix patch digest does not match",
      1,
    );
  }
  const expectedHead = artifact.expectedHead;
  if (pull.head.sha !== expectedHead) {
    throw new AgentError(
      "PR head changed before native no-mistakes fixes could publish",
      1,
    );
  }
  const headRef = String(pull.head.ref ?? "");
  if (!/^agent\/issue-\d+-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(headRef)) {
    throw new AgentError(
      "native no-mistakes fix target branch is invalid",
      1,
    );
  }

  // Dry-run proves the sealed bytes and target head without authenticating or mutating Git.
  if (dryRun) {
    return {
      nextHead: "",
      nextRepairAttempt: decision.nextAttempt,
      paths: artifact.nativeFix.paths,
      dryRun: true,
    };
  }
  const publishEnv = (
    dependencies.publisherEnvironment ?? publisherEnvironment
  )(dependencies.env ?? process.env);
  execute("gh", ["auth", "setup-git", "--hostname", "github.com"], {
    env: publishEnv,
  });
  execute(
    "git",
    [
      "fetch",
      "--no-tags",
      "origin",
      `+refs/heads/${headRef}:refs/remotes/origin/${headRef}`,
    ],
    { env: publishEnv },
  );
  const fetchedHead = execute("git", [
    "rev-parse",
    `refs/remotes/origin/${headRef}^{commit}`,
  ]).stdout.trim();
  if (fetchedHead !== expectedHead) {
    throw new AgentError(
      "remote PR head changed before native no-mistakes fix application",
      1,
    );
  }
  execute("git", ["switch", "--detach", expectedHead]);
  execute("git", ["apply", "--index", "--binary", resolve(patchPath)]);
  const stagedPaths = execute("git", [
    "diff",
    "--cached",
    "--name-only",
    "--no-renames",
    "-z",
  ]).stdout
    .split("\0")
    .filter(Boolean);
  if (
    JSON.stringify(sortedUnique(stagedPaths)) !==
    JSON.stringify(sortedUnique(artifact.nativeFix.paths))
  ) {
    throw new AgentError(
      "native no-mistakes fix patch paths do not match its manifest",
      1,
    );
  }
  const privileged = privilegedCandidatePaths(stagedPaths);
  if (privileged.length) {
    throw new AgentError(
      "native no-mistakes fix patch touched privileged candidate paths",
      1,
      { paths: privileged },
    );
  }
  const stagedTree = execute("git", ["write-tree"]).stdout.trim();
  if (stagedTree !== artifact.nativeFix.fixedTree) {
    throw new AgentError(
      "native no-mistakes fix tree does not match its isolated result",
      1,
    );
  }
  execute("git", ["config", "user.name", "github-actions[bot]"]);
  execute("git", [
    "config",
    "user.email",
    "41898282+github-actions[bot]@users.noreply.github.com",
  ]);
  execute("git", [
    "commit",
    "-m",
    implementationCommitMessage(
      "fix: apply no-mistakes review fixes",
      parseImplementationMetadata(pull.body),
    ),
  ]);
  const nextHead = execute("git", ["rev-parse", "HEAD"]).stdout.trim();
  execute(
    "git",
    [
      "push",
      "origin",
      `HEAD:refs/heads/${headRef}`,
      `--force-with-lease=refs/heads/${headRef}:${expectedHead}`,
    ],
    { env: publishEnv },
  );
  const remoteHead = execute(
    "git",
    ["ls-remote", "origin", `refs/heads/${headRef}`],
    { env: publishEnv },
  ).stdout
    .trim()
    .split(/\s+/)[0];
  if (remoteHead !== nextHead) {
    throw new AgentError(
      "published no-mistakes fix does not match the remote PR head",
      1,
    );
  }
  return {
    nextHead,
    nextRepairAttempt: decision.nextAttempt,
    paths: stagedPaths,
  };
}
