import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const GITHUB_READ_RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 16000];
const SYNC_SLEEP_BUFFER = new Int32Array(new SharedArrayBuffer(4));

export class AgentError extends Error {
  constructor(message, code = 1, details = undefined) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

export function repoRoot() {
  return ROOT;
}

export function parseArgs(argv = process.argv.slice(2)) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      args._.push(token);
      continue;
    }
    const raw = token.slice(2);
    const eq = raw.indexOf("=");
    if (eq !== -1) {
      args[raw.slice(0, eq)] = raw.slice(eq + 1);
      continue;
    }
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      args[raw] = next;
      i += 1;
    } else {
      args[raw] = true;
    }
  }
  return args;
}

export function loadConfig() {
  return readJson(join(ROOT, ".agent/config.json"));
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function readText(path) {
  return readFileSync(path, "utf8");
}

export function printResult(result, json = false) {
  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  if (result.message) process.stdout.write(`${result.message}\n`);
  if (Array.isArray(result.lines)) {
    for (const line of result.lines) process.stdout.write(`${line}\n`);
  }
}

export function finish(result, json = false, code = 0) {
  printResult(result, json);
  process.exitCode = code;
}

export function fail(error, json = false) {
  const code = Number.isInteger(error?.code) ? error.code : 1;
  const result = {
    ok: false,
    error: error?.message ?? String(error)
  };
  if (error?.details !== undefined) result.details = error.details;
  printResult(result, json);
  process.exit(code);
}

export function requireValue(value, name) {
  if (value === undefined || value === null || value === "") {
    throw new AgentError(`missing ${name}`, 2);
  }
  return value;
}

export function runCommand(command, args = [], options = {}) {
  const dryRun = Boolean(options.dryRun);
  const display = [command, ...args].join(" ");
  if (dryRun) {
    return { ok: true, dryRun: true, command: display, stdout: "", stderr: "", status: 0 };
  }
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? ROOT,
    env: options.env ?? process.env,
    encoding: "utf8",
    input: options.input,
    stdio: options.stdio ?? "pipe"
  });
  if (result.error) {
    throw new AgentError(`${display} failed: ${result.error.message}`, 1);
  }
  if (result.status !== 0 && options.check !== false) {
    throw new AgentError(`${display} exited ${result.status}`, result.status || 1, {
      stdout: result.stdout,
      stderr: result.stderr
    });
  }
  return {
    ok: result.status === 0,
    command: display,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    status: result.status ?? 0
  };
}

export function runShell(command, options = {}) {
  return runCommand("sh", ["-c", command], options);
}

export function gh(args, options = {}) {
  return runCommand("gh", args, options);
}

function parseGitHubJson(stdout) {
  const text = String(stdout ?? "").trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (error) {
    if (/^\s*(?:<!doctype\s+html|<html\b)/i.test(text)) {
      throw new AgentError("GitHub returned a transient HTML response instead of JSON", 1, {
        stderr: "transient GitHub HTML response"
      });
    }
    throw error;
  }
}

export function ghJson(args, options = {}) {
  const result = gh(args, options);
  return parseGitHubJson(result.stdout);
}

function sleepSync(milliseconds) {
  Atomics.wait(SYNC_SLEEP_BUFFER, 0, 0, milliseconds);
}

export function isTransientGitHubReadError(error) {
  const text = [error?.message, error?.details?.stdout, error?.details?.stderr]
    .filter(Boolean)
    .join("\n");
  return (
    /\b(?:HTTP\s*)?(?:429|500|502|503|504)\b/i.test(text) ||
    /(?:^|\n)\s*(?:<!doctype\s+html|<html\b)/i.test(text) ||
    /(?:bad gateway|connection reset|connection refused|connection timed out|temporary failure|tls handshake timeout|transient github html response|unexpected eof)/i.test(
      text
    )
  );
}

export function retryGitHubRead(operation, options = {}) {
  const delays = options.delays ?? GITHUB_READ_RETRY_DELAYS_MS;
  const sleep = options.sleep ?? sleepSync;
  const onRetry = options.onRetry ?? ((attempt, delay) => {
    process.stderr.write(`GitHub API read unavailable; retry ${attempt}/${delays.length} in ${delay}ms\n`);
  });

  for (let attempt = 0; ; attempt += 1) {
    try {
      return operation();
    } catch (error) {
      if (!isTransientGitHubReadError(error) || attempt >= delays.length) {
        if (isTransientGitHubReadError(error)) {
          throw new AgentError(`GitHub API read failed after ${attempt + 1} attempts`, 1, {
            stderr: String(error?.details?.stderr ?? error?.message ?? "transient GitHub API failure").trim()
          });
        }
        throw error;
      }
      const delay = delays[attempt];
      onRetry(attempt + 1, delay);
      sleep(delay);
    }
  }
}

export function ghRead(args, options = {}, dependencies = {}) {
  const execute = dependencies.gh ?? gh;
  return retryGitHubRead(() => execute(args, options), dependencies);
}

export function ghReadJson(args, options = {}, dependencies = {}) {
  const execute = dependencies.gh ?? gh;
  return retryGitHubRead(() => parseGitHubJson(execute(args, options).stdout), dependencies);
}

export function ghApiJson(path, options = {}, dependencies = {}) {
  const args = ["api", path, ...(options.paginate ? ["--paginate", "--slurp"] : [])];
  const execute = dependencies.ghJson ?? ghJson;
  const result = retryGitHubRead(() => execute(args, options), dependencies);
  if (options.paginate && Array.isArray(result) && result.every((page) => Array.isArray(page))) {
    return result.flat();
  }
  return result;
}

export function withTempJson(data, callback) {
  const dir = mkdtempSync(join(tmpdir(), "vet-agent-"));
  const path = join(dir, "body.json");
  writeFileSync(path, JSON.stringify(data, null, 2));
  try {
    return callback(path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function withTempText(text, suffix, callback) {
  const dir = mkdtempSync(join(tmpdir(), "vet-agent-"));
  const path = join(dir, `body${suffix}`);
  writeFileSync(path, text);
  try {
    return callback(path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function repoSlug(config = loadConfig()) {
  return `${config.repo.owner}/${config.repo.name}`;
}

const IMPLEMENTATION_MARKER = "<!-- agent-implementation:v1 -->";
const PRIVILEGED_AGENT_DIRECTORIES = new Set([
  ".agent",
  ".agents",
  ".claude",
  ".codex",
  ".github",
  "skills"
]);
const PRIVILEGED_PACKAGE_FILES = new Set([
  ".npmrc",
  ".yarnrc",
  ".yarnrc.yml",
  "bun.lock",
  "bun.lockb",
  "npm-shrinkwrap.json",
  "package-lock.json",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "yarn.lock"
]);

function candidatePathValues(candidate) {
  if (typeof candidate === "string") return [candidate];
  if (!candidate || typeof candidate !== "object") return [];
  const prior = Array.isArray(candidate.previous_filenames) ? candidate.previous_filenames : [];
  return [candidate.filename, candidate.previous_filename, ...prior]
    .filter((value) => typeof value === "string");
}

export function candidatePaths(candidates) {
  return [...new Set((candidates ?? []).flatMap(candidatePathValues).filter(Boolean))];
}

export function privilegedCandidatePaths(candidates) {
  return candidatePaths(candidates).filter((candidate) => {
    const path = candidate.replaceAll("\\", "/").replace(/^\.\//, "");
    const segments = path.split("/").filter(Boolean);
    const basename = segments.at(-1) ?? "";
    return (
      basename === "AGENTS.md" ||
      basename === "CLAUDE.md" ||
      basename === ".no-mistakes.yaml" ||
      basename === ".no-mistakes.yml" ||
      PRIVILEGED_PACKAGE_FILES.has(basename) ||
      segments.some((segment) => PRIVILEGED_AGENT_DIRECTORIES.has(segment)) ||
      path.startsWith("scripts/agent-")
    );
  });
}

export function issueSnapshotSha256(issue) {
  const snapshot = {
    number: Number(issue?.number),
    title: String(issue?.title ?? ""),
    body: String(issue?.body ?? "")
  };
  return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
}

export function parseImplementationMetadata(body) {
  const text = String(body ?? "");
  if (text.split(IMPLEMENTATION_MARKER).length !== 2) {
    throw new AgentError("PR must contain exactly one agent implementation marker", 1);
  }
  const afterMarker = text.slice(text.indexOf(IMPLEMENTATION_MARKER) + IMPLEMENTATION_MARKER.length);
  const match = afterMarker.match(/^\s*Agent implementation metadata:\s*```json\s*([\s\S]*?)```/i);
  if (!match) throw new AgentError("agent implementation metadata JSON is missing", 1);
  const metadata = extractJson(match[1]);
  const keys = Object.keys(metadata ?? {}).sort();
  const expectedKeys = ["automergeEligible", "issueSnapshotSha256", "sourceIssue", "sourceLabels"];
  if (
    !metadata ||
    Array.isArray(metadata) ||
    JSON.stringify(keys) !== JSON.stringify(expectedKeys) ||
    !Number.isInteger(metadata.sourceIssue) ||
    metadata.sourceIssue <= 0 ||
    !Array.isArray(metadata.sourceLabels) ||
    !metadata.sourceLabels.every((label) => typeof label === "string" && label.length > 0) ||
    new Set(metadata.sourceLabels).size !== metadata.sourceLabels.length ||
    typeof metadata.automergeEligible !== "boolean" ||
    !/^[a-f0-9]{64}$/.test(metadata.issueSnapshotSha256)
  ) {
    throw new AgentError("agent implementation metadata is invalid", 1);
  }
  return metadata;
}

export function assertTrustedAgentPull(pull, config, options = {}) {
  const { files, sourceIssue, rejectPrivilegedPaths = Boolean(files) } = Array.isArray(options)
    ? { files: options, rejectPrivilegedPaths: true }
    : options;
  const expectedRepo = repoSlug(config).toLowerCase();
  const headRepo = String(pull?.head?.repo?.full_name ?? "").toLowerCase();
  const baseRepo = String(pull?.base?.repo?.full_name ?? "").toLowerCase();
  if (headRepo !== expectedRepo || baseRepo !== expectedRepo) {
    throw new AgentError("agent PR must use a same-repository branch", 1);
  }
  if (pull?.state !== "open" || pull?.merged || pull?.merged_at) {
    throw new AgentError("agent PR must be open and unmerged", 1);
  }
  if (pull?.base?.ref !== config.repo.defaultBranch) {
    throw new AgentError(`agent PR base must be ${config.repo.defaultBranch}`, 1);
  }
  if (String(pull?.user?.login ?? "").toLowerCase() !== "github-actions[bot]") {
    throw new AgentError("agent PR author must be github-actions[bot]", 1);
  }
  if (!/^[a-f0-9]{40}$/.test(String(pull?.head?.sha ?? ""))) {
    throw new AgentError("agent PR head SHA is invalid", 1);
  }

  const metadata = parseImplementationMetadata(pull.body);
  const branch = String(pull?.head?.ref ?? "");
  const branchMatch = branch.match(/^agent\/issue-(\d+)-[a-z0-9]+(?:-[a-z0-9]+)*$/);
  if (!branchMatch || Number(branchMatch[1]) !== metadata.sourceIssue) {
    throw new AgentError("agent PR branch does not match implementation source issue", 1);
  }

  if (files !== undefined) {
    if (
      !Array.isArray(files) ||
      files.length === 0 ||
      (Number.isInteger(pull.changed_files) && pull.changed_files !== files.length)
    ) {
      throw new AgentError("agent PR has no complete changed-file inventory", 1);
    }
    const blocked = rejectPrivilegedPaths ? privilegedCandidatePaths(files) : [];
    if (blocked.length) {
      throw new AgentError("agent PR changes privileged candidate paths", 1, { paths: blocked });
    }
  }

  if (sourceIssue !== undefined) {
    if (
      sourceIssue?.pull_request ||
      sourceIssue?.number !== metadata.sourceIssue ||
      sourceIssue?.state !== "open"
    ) {
      throw new AgentError("implementation metadata does not match an open source issue", 1);
    }
    if (issueSnapshotSha256(sourceIssue) !== metadata.issueSnapshotSha256) {
      throw new AgentError("source issue changed after trusted triage", 1);
    }
  }
  return { metadata, sourceIssue: metadata.sourceIssue };
}

function normalizeGraphQLComment(comment) {
  if (
    typeof comment?.id !== "string" ||
    !comment.id ||
    !Number.isSafeInteger(comment?.databaseId) ||
    comment.databaseId <= 0
  ) {
    throw new AgentError("GraphQL issue comment metadata is invalid", 1);
  }
  const login = String(comment?.author?.login ?? "");
  return {
    id: comment?.id,
    database_id: comment.databaseId,
    body: comment?.body ?? "",
    created_at: comment?.createdAt ?? null,
    updated_at: comment?.updatedAt ?? comment?.createdAt ?? null,
    user: { login: login === "github-actions" ? "github-actions[bot]" : login }
  };
}

const ISSUE_COMMENTS_QUERY = `
  query($owner:String!,$name:String!,$number:Int!,$endCursor:String) {
    repository(owner:$owner,name:$name) {
      issueOrPullRequest(number:$number) {
        ... on Issue {
          comments(first:100,after:$endCursor) {
            nodes { id databaseId body createdAt updatedAt author { login } }
            pageInfo { hasNextPage endCursor }
          }
        }
        ... on PullRequest {
          comments(first:100,after:$endCursor) {
            nodes { id databaseId body createdAt updatedAt author { login } }
            pageInfo { hasNextPage endCursor }
          }
        }
      }
    }
  }
`;

export function getIssueComments(config, number, dependencies = {}) {
  const path = `repos/${config.repo.owner}/${config.repo.name}/issues/${number}/comments`;
  const args = [
    "api",
    "graphql",
    "--paginate",
    "--slurp",
    "-f",
    `owner=${config.repo.owner}`,
    "-f",
    `name=${config.repo.name}`,
    "-F",
    `number=${number}`,
    "-f",
    `query=${ISSUE_COMMENTS_QUERY}`
  ];
  const readJson = dependencies.ghReadJson ?? ghReadJson;
  try {
    const pages = readJson(args, {}, { delays: [1000, 2000, 4000] });
    if (!Array.isArray(pages) || pages.length === 0) {
      throw new AgentError(`issue #${number} GraphQL comments response is invalid`, 1);
    }
    const comments = pages.flatMap((page) => {
      const nodes = page?.data?.repository?.issueOrPullRequest?.comments?.nodes;
      if (!Array.isArray(nodes)) {
        throw new AgentError(`issue #${number} GraphQL comments response is invalid`, 1);
      }
      return nodes;
    });
    return comments.map(normalizeGraphQLComment);
  } catch (error) {
    if (!isTransientGitHubReadError(error)) throw error;
  }
  const apiJson = dependencies.ghApiJson ?? ghApiJson;
  return apiJson(path, { paginate: true }) ?? [];
}

export function getIssueNodeId(config, number, dependencies = {}) {
  const readJson = dependencies.ghReadJson ?? ghReadJson;
  try {
    const issue = readJson([
      "issue",
      "view",
      String(number),
      "--repo",
      repoSlug(config),
      "--json",
      "id"
    ]);
    if (typeof issue?.id === "string" && issue.id) return issue.id;
    throw new AgentError(`issue #${number} GraphQL node id response is invalid`, 1);
  } catch (error) {
    if (!isTransientGitHubReadError(error)) throw error;
  }
  const apiJson = dependencies.ghApiJson ?? ghApiJson;
  const issue = apiJson(`repos/${config.repo.owner}/${config.repo.name}/issues/${number}`);
  if (typeof issue?.node_id !== "string" || !issue.node_id) {
    throw new AgentError(`issue #${number} has no GraphQL node id`, 1);
  }
  return issue.node_id;
}

function normalizeGraphQLPull(pull, config) {
  const headRepo = pull?.headRepository?.nameWithOwner ?? "";
  const author = String(pull?.author?.login ?? "");
  const normalizedAuthor = ["app/github-actions", "github-actions", "github-actions[bot]"].includes(
    author.toLowerCase()
  )
    ? "github-actions[bot]"
    : author;
  return {
    number: pull?.number,
    node_id: pull?.id,
    state: String(pull?.state ?? "").toLowerCase() === "open" ? "open" : "closed",
    merged: Boolean(pull?.mergedAt),
    merged_at: pull?.mergedAt ?? null,
    merge_commit_sha: pull?.mergeCommit?.oid ?? null,
    mergeable: pull?.mergeable === "MERGEABLE",
    mergeable_state: String(pull?.mergeStateStatus ?? "unknown").toLowerCase(),
    draft: Boolean(pull?.isDraft),
    auto_merge: pull?.autoMergeRequest ?? null,
    changed_files: pull?.changedFiles,
    title: pull?.title ?? "",
    body: pull?.body ?? "",
    html_url: pull?.url,
    user: { login: normalizedAuthor },
    base: {
      ref: pull?.baseRefName ?? "",
      sha: pull?.baseRefOid ?? "",
      repo: { full_name: repoSlug(config) }
    },
    head: {
      ref: pull?.headRefName ?? "",
      sha: pull?.headRefOid ?? "",
      repo: { full_name: headRepo }
    }
  };
}

export function getPullRequest(config, number, dependencies = {}) {
  const readJson = dependencies.ghReadJson ?? ghReadJson;
  const fields = [
    "autoMergeRequest",
    "baseRefName",
    "baseRefOid",
    "body",
    "changedFiles",
    "headRefName",
    "headRefOid",
    "headRepository",
    "id",
    "isDraft",
    "mergeCommit",
    "mergeable",
    "mergedAt",
    "mergeStateStatus",
    "number",
    "state",
    "title",
    "url",
    "author"
  ].join(",");
  try {
    const pull = readJson([
      "pr",
      "view",
      String(number),
      "--repo",
      repoSlug(config),
      "--json",
      fields
    ], {}, { delays: [1000, 2000, 4000] });
    if (
      pull?.number !== Number(number) ||
      typeof pull?.id !== "string" ||
      !pull.id ||
      !/^[a-f0-9]{40}$/.test(String(pull?.headRefOid ?? "")) ||
      !/^[a-f0-9]{40}$/.test(String(pull?.baseRefOid ?? ""))
    ) {
      throw new AgentError(`PR #${number} GraphQL response is invalid`, 1);
    }
    return normalizeGraphQLPull(pull, config);
  } catch (error) {
    if (!isTransientGitHubReadError(error)) throw error;
  }
  const apiJson = dependencies.ghApiJson ?? ghApiJson;
  return apiJson(`repos/${config.repo.owner}/${config.repo.name}/pulls/${number}`);
}

const PULL_FILES_QUERY = `
  query($owner:String!,$name:String!,$number:Int!,$endCursor:String) {
    repository(owner:$owner,name:$name) {
      pullRequest(number:$number) {
        number
        baseRefOid
        headRefOid
        changedFiles
        files(first:100,after:$endCursor) {
          nodes { path additions deletions changeType }
          pageInfo { hasNextPage endCursor }
        }
      }
    }
  }
`;

function comparedPullFiles(config, pull, dependencies = {}) {
  const apiJson = dependencies.ghApiJson ?? ghApiJson;
  const comparison = apiJson(
    `repos/${config.repo.owner}/${config.repo.name}/compare/${pull.base.sha}...${pull.head.sha}`
  );
  const files = comparison?.files;
  if (!Array.isArray(files) || Number(pull.changed_files) !== files.length) {
    throw new AgentError("could not verify the complete immutable PR file inventory", 1);
  }
  return files;
}

function immutableTreeEntries(config, sha, dependencies = {}) {
  const apiJson = dependencies.ghApiJson ?? ghApiJson;
  const root = `repos/${config.repo.owner}/${config.repo.name}/git/trees`;
  const response = apiJson(
    `${root}/${sha}?recursive=1`
  );
  if (!Array.isArray(response?.tree) || typeof response?.truncated !== "boolean") {
    throw new AgentError("could not verify the complete immutable repository tree", 1);
  }
  let rawEntries = response.tree;
  if (response.truncated) {
    if (!/^[a-f0-9]{40}$/.test(String(response?.sha ?? ""))) {
      throw new AgentError("truncated immutable repository tree has no root SHA", 1);
    }
    rawEntries = [];
    const walk = (treeSha, prefix = "", depth = 0) => {
      if (depth > 128) throw new AgentError("immutable repository tree exceeds the depth limit", 1);
      const page = apiJson(`${root}/${treeSha}`);
      if (page?.truncated !== false || !Array.isArray(page?.tree)) {
        throw new AgentError("could not traverse the complete immutable repository tree", 1);
      }
      for (const entry of page.tree) {
        const name = entry?.path;
        if (typeof name !== "string" || !name || !/^[a-f0-9]{40}$/.test(String(entry?.sha ?? ""))) {
          throw new AgentError("immutable repository tree metadata is invalid", 1);
        }
        const path = prefix ? `${prefix}/${name}` : name;
        if (entry.type === "tree") {
          walk(entry.sha, path, depth + 1);
        } else {
          rawEntries.push({ ...entry, path });
        }
      }
    };
    walk(response.sha);
  }
  const entries = rawEntries
    .filter((entry) => entry?.type !== "tree")
    .map((entry) => ({
      path: entry?.path,
      mode: entry?.mode,
      oid: entry?.sha,
      type: entry?.type
    }));
  if (
    entries.some(
      (entry) =>
        typeof entry.path !== "string" ||
        !entry.path ||
        typeof entry.mode !== "string" ||
        !/^[a-f0-9]{40}$/.test(String(entry.oid ?? "")) ||
        !["blob", "commit"].includes(entry.type)
    ) ||
    new Set(entries.map((entry) => entry.path)).size !== entries.length
  ) {
    throw new AgentError("immutable repository tree metadata is invalid", 1);
  }
  return new Map(entries.map((entry) => [entry.path, entry]));
}

function treeDiffPullFiles(config, pull, dependencies = {}) {
  const base = immutableTreeEntries(config, pull.base.sha, dependencies);
  const head = immutableTreeEntries(config, pull.head.sha, dependencies);
  const removed = [...base.keys()].filter((path) => !head.has(path)).sort();
  const added = [...head.keys()].filter((path) => !base.has(path)).sort();
  const modified = [...base.keys()]
    .filter((path) => {
      const next = head.get(path);
      if (!next) return false;
      const prior = base.get(path);
      return prior.oid !== next.oid || prior.mode !== next.mode || prior.type !== next.type;
    })
    .sort();
  const renameCount = removed.length + added.length + modified.length - Number(pull.changed_files);
  if (!Number.isSafeInteger(renameCount) || renameCount < 0 || renameCount > Math.min(removed.length, added.length)) {
    throw new AgentError("immutable tree diff does not match the PR changed-file count", 1);
  }

  const files = [
    ...modified.map((filename) => ({ filename, status: "modified" })),
    ...added.slice(renameCount).map((filename) => ({ filename, status: "added" })),
    ...removed.slice(renameCount).map((filename) => ({ filename, status: "removed" })),
    ...added.slice(0, renameCount).map((filename) => ({ filename, status: "renamed" }))
  ].sort((left, right) => left.filename.localeCompare(right.filename));
  const renamed = files.filter((file) => file.status === "renamed");
  if (renamed.length === 1) renamed[0].previous_filename = removed[0];
  if (renamed.length > 1) renamed[0].previous_filenames = removed.slice(0, renameCount);
  if (files.length !== Number(pull.changed_files)) {
    throw new AgentError("could not verify the complete immutable PR file inventory", 1);
  }
  return files;
}

function normalizeGraphQLPullFile(file) {
  const status = file?.changeType === "DELETED" ? "removed" : String(file?.changeType ?? "").toLowerCase();
  if (
    typeof file?.path !== "string" ||
    !file.path ||
    !["added", "changed", "copied", "modified", "removed", "renamed"].includes(status) ||
    !Number.isSafeInteger(file?.additions) ||
    file.additions < 0 ||
    !Number.isSafeInteger(file?.deletions) ||
    file.deletions < 0
  ) {
    throw new AgentError("GraphQL pull file metadata is invalid", 1);
  }
  return {
    filename: file.path,
    status,
    additions: file.additions,
    deletions: file.deletions,
    changes: file.additions + file.deletions
  };
}

export function getPullFiles(config, pull, dependencies = {}) {
  const baseSha = String(pull?.base?.sha ?? "");
  const headSha = String(pull?.head?.sha ?? "");
  const pullNumber = Number(pull?.number);
  const changedFiles = Number(pull?.changed_files);
  if (
    !/^[a-f0-9]{40}$/.test(baseSha) ||
    !/^[a-f0-9]{40}$/.test(headSha) ||
    !Number.isSafeInteger(pullNumber) ||
    pullNumber <= 0 ||
    !Number.isSafeInteger(changedFiles) ||
    changedFiles < 0
  ) {
    throw new AgentError("pull file inventory requires exact pull metadata", 1);
  }
  const args = [
    "api",
    "graphql",
    "--paginate",
    "--slurp",
    "-f",
    `owner=${config.repo.owner}`,
    "-f",
    `name=${config.repo.name}`,
    "-F",
    `number=${pullNumber}`,
    "-f",
    `query=${PULL_FILES_QUERY}`
  ];
  const readJson = dependencies.ghReadJson ?? ghReadJson;
  let pages;
  try {
    pages = readJson(args, {}, { delays: [1000, 2000, 4000] });
  } catch (error) {
    if (!isTransientGitHubReadError(error)) throw error;
    return changedFiles <= 300
      ? comparedPullFiles(config, pull, dependencies)
      : treeDiffPullFiles(config, pull, dependencies);
  }

  if (!Array.isArray(pages) || pages.length === 0) {
    throw new AgentError(`PR #${pullNumber} GraphQL files response is invalid`, 1);
  }
  const files = pages.flatMap((page) => {
    const value = page?.data?.repository?.pullRequest;
    const nodes = value?.files?.nodes;
    if (
      value?.number !== pullNumber ||
      value?.baseRefOid !== baseSha ||
      value?.headRefOid !== headSha ||
      value?.changedFiles !== changedFiles ||
      !Array.isArray(nodes)
    ) {
      throw new AgentError(`PR #${pullNumber} GraphQL files response is invalid`, 1);
    }
    return nodes.map(normalizeGraphQLPullFile);
  });
  if (files.length !== changedFiles || new Set(files.map((file) => file.filename)).size !== files.length) {
    throw new AgentError("could not verify the complete PR file inventory", 1);
  }

  const renamed = files.filter((file) => file.status === "renamed");
  if (renamed.length) {
    const basePaths = new Set(immutableTreeEntries(config, baseSha, dependencies).keys());
    const headPaths = new Set(immutableTreeEntries(config, headSha, dependencies).keys());
    const removedPaths = new Set(
      files.filter((file) => file.status === "removed").map((file) => file.filename)
    );
    const renameSources = [...basePaths]
      .filter((path) => !headPaths.has(path) && !removedPaths.has(path))
      .sort();
    if (renameSources.length !== renamed.length) {
      throw new AgentError("could not verify every renamed PR source path", 1);
    }
    renamed.sort((left, right) => left.filename.localeCompare(right.filename));
    if (renamed.length === 1) renamed[0].previous_filename = renameSources[0];
    if (renamed.length > 1) renamed[0].previous_filenames = renameSources;
  }
  return files;
}

export function getPullSnapshot(config, number, dependencies = {}) {
  const getPull = dependencies.getPullRequest ?? getPullRequest;
  const getFiles = dependencies.getPullFiles ?? getPullFiles;
  const pull = getPull(config, number, dependencies);
  return { pull, files: getFiles(config, pull, dependencies) };
}

export function getPullDiff(config, pull, dependencies = {}) {
  const baseSha = String(pull?.base?.sha ?? "");
  const headSha = String(pull?.head?.sha ?? "");
  if (!/^[a-f0-9]{40}$/.test(baseSha) || !/^[a-f0-9]{40}$/.test(headSha)) {
    throw new AgentError("pull diff requires exact base and head SHAs", 1);
  }
  const read = dependencies.ghRead ?? ghRead;
  return read([
    "api",
    "-H",
    "Accept: application/vnd.github.v3.diff",
    `repos/${config.repo.owner}/${config.repo.name}/compare/${baseSha}...${headSha}`
  ]).stdout;
}

export function commentHasManagedMarker(body, marker) {
  const text = String(body ?? "");
  return text === marker || text.startsWith(`${marker}\n`);
}

export function trustedManagedComment(comment, marker, repoOwner) {
  if (!commentHasManagedMarker(comment?.body, marker)) return false;
  const login = String(comment?.user?.login ?? "").toLowerCase();
  const owner = String(repoOwner ?? "").toLowerCase();
  return login === "github-actions[bot]" || Boolean(owner && login === owner);
}

export function newestManagedComment(comments, marker, repoOwner) {
  return [...(comments ?? [])]
    .filter((comment) => trustedManagedComment(comment, marker, repoOwner))
    .sort((left, right) => {
      const leftTime = Date.parse(left.updated_at ?? left.created_at ?? "") || 0;
      const rightTime = Date.parse(right.updated_at ?? right.created_at ?? "") || 0;
      if (leftTime !== rightTime) return rightTime - leftTime;
      const leftId = String(left.database_id ?? left.id ?? "");
      const rightId = String(right.database_id ?? right.id ?? "");
      if (/^\d+$/.test(leftId) && /^\d+$/.test(rightId) && leftId.length !== rightId.length) {
        return rightId.length - leftId.length;
      }
      return rightId.localeCompare(leftId);
    })[0] ?? null;
}

export function upsertManagedComment({ config, number, marker, body, dryRun = false }, dependencies = {}) {
  const fullBody = `${marker}\n${body.trim()}\n`;
  if (dryRun) {
    return { ok: true, dryRun: true, number, marker, body: fullBody };
  }
  const getComments = dependencies.getIssueComments ?? getIssueComments;
  const tempJson = dependencies.withTempJson ?? withTempJson;
  const runGh = dependencies.gh ?? gh;
  const apiJson = dependencies.ghJson ?? ghJson;
  const issueNodeId = dependencies.getIssueNodeId ?? getIssueNodeId;
  const comments = getComments(config, number);
  const existing = newestManagedComment(comments, marker, config.repo.owner);
  if (existing && typeof existing.id === "string") {
    const payload = {
      query: "mutation($id:ID!,$body:String!){updateIssueComment(input:{id:$id,body:$body}){issueComment{id}}}",
      variables: { id: existing.id, body: fullBody }
    };
    return tempJson(payload, (path) => {
      const updated = apiJson(["api", "graphql", "--input", path]);
      const commentId = updated?.data?.updateIssueComment?.issueComment?.id;
      if (typeof commentId !== "string" || !commentId) {
        throw new AgentError("GraphQL managed comment update returned no comment id", 1);
      }
      return { ok: true, action: "updated", commentId };
    });
  }
  if (existing) {
    return tempJson({ body: fullBody }, (path) => {
      runGh([
        "api",
        `repos/${config.repo.owner}/${config.repo.name}/issues/comments/${existing.id}`,
        "-X",
        "PATCH",
        "--input",
        path
      ]);
      return { ok: true, action: "updated", commentId: existing.id };
    });
  }
  const payload = {
    query: "mutation($subjectId:ID!,$body:String!){addComment(input:{subjectId:$subjectId,body:$body}){commentEdge{node{id}}}}",
    variables: { subjectId: issueNodeId(config, number), body: fullBody }
  };
  return tempJson(payload, (path) => {
    const created = apiJson(["api", "graphql", "--input", path]);
    const commentId = created?.data?.addComment?.commentEdge?.node?.id;
    if (typeof commentId !== "string" || !commentId) {
      throw new AgentError("GraphQL managed comment creation returned no comment id", 1);
    }
    return { ok: true, action: "created", commentId };
  });
}

export function addLabels(config, number, labels, dryRun = false) {
  const applied = [];
  for (const label of labels.filter(Boolean)) {
    if (dryRun) {
      applied.push(label);
      continue;
    }
    gh(["issue", "edit", String(number), "--repo", repoSlug(config), "--add-label", label]);
    applied.push(label);
  }
  return applied;
}

export function removeLabels(config, number, labels, dryRun = false) {
  const removed = [];
  for (const label of labels.filter(Boolean)) {
    if (dryRun) {
      removed.push(label);
      continue;
    }
    gh(["issue", "edit", String(number), "--repo", repoSlug(config), "--remove-label", label], { check: false });
    removed.push(label);
  }
  return removed;
}

export function createOrUpdateLabel(config, label, dryRun = false) {
  const base = ["--repo", repoSlug(config), "--color", label.color, "--description", label.description];
  if (dryRun) {
    return { name: label.name, action: "dry-run" };
  }
  const create = gh(["label", "create", label.name, ...base], { check: false });
  if (create.status === 0) return { name: label.name, action: "created" };
  gh(["label", "edit", label.name, ...base]);
  return { name: label.name, action: "updated" };
}

export function extractJson(text) {
  const trimmed = text.trim();
  if (!trimmed) throw new AgentError("empty JSON input", 2);
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence ? fence[1].trim() : trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    const objectStart = candidate.search(/[\[{]/);
    if (objectStart === -1) throw new AgentError("no JSON object or array found", 2);
    for (let end = candidate.length; end > objectStart; end -= 1) {
      const slice = candidate.slice(objectStart, end).trim();
      if (!slice.endsWith("}") && !slice.endsWith("]")) continue;
      try {
        return JSON.parse(slice);
      } catch {
        // keep shrinking
      }
    }
  }
  throw new AgentError("could not parse JSON from agent output", 2);
}

export function readAgentJson(path) {
  return extractJson(readText(path));
}

export function slugify(value, fallback = "work") {
  const slug = String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || fallback;
}

export function gitOutput(args, options = {}) {
  return execFileSync("git", args, {
    cwd: options.cwd ?? ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}

export function currentBranch() {
  return gitOutput(["rev-parse", "--abbrev-ref", "HEAD"]);
}

export function assertNotMain(config = loadConfig()) {
  const branch = currentBranch();
  if (branch === config.repo.defaultBranch) {
    throw new AgentError(`refusing to run gate on ${branch}`, 1);
  }
  return branch;
}

export function commandExists(command) {
  const result = spawnSync("sh", ["-c", `command -v ${command}`], { encoding: "utf8" });
  return result.status === 0;
}

export function secretState(names, env = process.env) {
  return names.map((name) => ({ name, present: Boolean(env[name]) }));
}

export function setGitHubOutput(values) {
  const path = process.env.GITHUB_OUTPUT;
  if (!path) return;
  const lines = [];
  for (const [key, value] of Object.entries(values)) {
    lines.push(`${key}=${String(value).replace(/\n/g, "%0A")}`);
  }
  writeFileSync(path, `${lines.join("\n")}\n`, { flag: "a" });
}

export function markdownJsonBlock(value) {
  return `\n\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\`\n`;
}

export function actionsRunUrl(config, env = process.env) {
  const server = String(env.GITHUB_SERVER_URL ?? "").replace(/\/$/, "");
  const repository = String(env.GITHUB_REPOSITORY ?? "");
  const runId = String(env.GITHUB_RUN_ID ?? "");
  if (server !== "https://github.com" || repository.toLowerCase() !== repoSlug(config).toLowerCase() || !/^\d+$/.test(runId)) {
    return "";
  }
  return `${server}/${repository}/actions/runs/${runId}`;
}

export function setCommitStatus({ config, sha, state, context, description, targetUrl, dryRun = false }) {
  const payload = {
    state,
    context,
    description: String(description ?? "").slice(0, 140)
  };
  const resolvedTargetUrl = targetUrl || actionsRunUrl(config);
  if (resolvedTargetUrl) payload.target_url = resolvedTargetUrl;
  if (dryRun) return { ok: true, dryRun: true, sha, ...payload };
  return withTempJson(payload, (path) => {
    const created = ghJson([
      "api",
      `repos/${config.repo.owner}/${config.repo.name}/statuses/${sha}`,
      "-X",
      "POST",
      "--input",
      path
    ]);
    return { ok: true, id: created?.id, sha, ...payload };
  });
}

export function issueLabels(issueOrPull) {
  return (issueOrPull.labels ?? []).map((label) => (typeof label === "string" ? label : label.name)).filter(Boolean);
}

export function dispatchWorkflow(config, workflow, fields = {}, dryRun = false, ref = "") {
  const args = ["workflow", "run", workflow, "--repo", repoSlug(config)];
  if (ref) args.push("--ref", ref);
  for (const [key, value] of Object.entries(fields)) {
    args.push("-f", `${key}=${value}`);
  }
  if (dryRun) return { ok: true, dryRun: true, workflow, fields, ref };
  gh(args);
  return { ok: true, workflow, fields, ref };
}
