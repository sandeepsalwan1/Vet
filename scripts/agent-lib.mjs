import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

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

export function ghJson(args, options = {}) {
  const result = gh(args, options);
  const text = result.stdout.trim();
  return text ? JSON.parse(text) : null;
}

export function ghApiJson(path, options = {}) {
  const result = ghJson(["api", path, ...(options.paginate ? ["--paginate", "--slurp"] : [])], options);
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

export function getIssueComments(config, number) {
  const path = `repos/${config.repo.owner}/${config.repo.name}/issues/${number}/comments`;
  return ghApiJson(path, { paginate: true }) ?? [];
}

export function upsertManagedComment({ config, number, marker, body, dryRun = false }) {
  const fullBody = `${marker}\n${body.trim()}\n`;
  if (dryRun) {
    return { ok: true, dryRun: true, number, marker, body: fullBody };
  }
  const comments = getIssueComments(config, number);
  const existing = comments.find((comment) => typeof comment.body === "string" && comment.body.includes(marker));
  return withTempJson({ body: fullBody }, (path) => {
    if (existing) {
      gh(["api", `repos/${config.repo.owner}/${config.repo.name}/issues/comments/${existing.id}`, "-X", "PATCH", "--input", path]);
      return { ok: true, action: "updated", commentId: existing.id };
    }
    const created = ghJson(["api", `repos/${config.repo.owner}/${config.repo.name}/issues/${number}/comments`, "-X", "POST", "--input", path]);
    return { ok: true, action: "created", commentId: created?.id };
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

export function setCommitStatus({ config, sha, state, context, description, targetUrl, dryRun = false }) {
  const payload = {
    state,
    context,
    description: String(description ?? "").slice(0, 140)
  };
  if (targetUrl) payload.target_url = targetUrl;
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

export function dispatchWorkflow(config, workflow, fields = {}, dryRun = false) {
  const args = ["workflow", "run", workflow, "--repo", repoSlug(config)];
  for (const [key, value] of Object.entries(fields)) {
    args.push("-f", `${key}=${value}`);
  }
  if (dryRun) return { ok: true, dryRun: true, workflow, fields };
  gh(args);
  return { ok: true, workflow, fields };
}
