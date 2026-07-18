#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import {
  AgentError,
  addLabels,
  dispatchWorkflow,
  extractJson,
  fail,
  finish,
  getIssueComments,
  ghApiJson,
  ghJson,
  ghReadJson,
  gitOutput,
  issueLabels,
  issueSnapshotSha256,
  isTransientGitHubReadError,
  loadConfig,
  markdownJsonBlock,
  newestManagedComment,
  parseArgs,
  privilegedCandidatePaths,
  readText,
  removeLabels,
  repoRoot,
  runCommand,
  runShell,
  slugify,
  upsertManagedComment,
  withTempJson
} from "./agent-lib.mjs";

function fetchIssue(config, issueNumber) {
  const issue = ghApiJson(`repos/${config.repo.owner}/${config.repo.name}/issues/${issueNumber}`);
  const comments = getIssueComments(config, issueNumber);
  return { issue, comments };
}

function writePrompt(config, issueNumber, outputPath) {
  const { issue, comments } = fetchIssue(config, issueNumber);
  assertImplementationSource(config, issue);
  const triage = newestManagedComment(comments, config.comments.triage, config.repo.owner);
  if (!triage) throw new AgentError(`source issue #${issueNumber} has no trusted managed triage`, 1);
  const snapshotSha256 = assertIssueMatchesTriageSnapshot(issue, triage, config.comments.triage);
  const prompt = `${readText(join(repoRoot(), ".agent/prompts/implement.md"))}

## Issue

Number: ${issue.number}
Title: ${issue.title}
Labels: ${issueLabels(issue).join(", ") || "none"}

Body:

${issue.body ?? ""}

## Agent Triage

${triage.body}
`;
  mkdirSync(join(repoRoot(), ".agent-output"), { recursive: true });
  writeFileSync(outputPath, prompt);
  const intentPath = join(dirname(outputPath), "implementation-intent.json");
  writeFileSync(
    intentPath,
    `${JSON.stringify({ version: 1, issueNumber, issueSnapshotSha256: snapshotSha256 }, null, 2)}\n`
  );
  return { issueNumber, outputPath, intentPath };
}

function createPatch(outputPath) {
  runCommand("git", ["add", "-N", "."]);
  const diff = runCommand("git", [
    "diff",
    "--binary",
    "HEAD",
    "--",
    ".",
    ":(exclude).agent-output/**",
    ":(exclude)codex.patch",
    ":(exclude)review.patch"
  ]).stdout;
  writeFileSync(outputPath, diff);
  if (!diff.trim()) throw new AgentError("agent produced no file changes", 1);
  return { outputPath, bytes: Buffer.byteLength(diff) };
}

export function prBody(issue, codexOutput, metadata) {
  return `Agent implementation for #${issue.number}.

Closes #${issue.number}

## Source Issue

${issue.title}

## Agent Output

${codexOutput?.trim() || "No final agent output captured."}

<!-- agent-implementation:v1 -->
Agent implementation metadata:
${markdownJsonBlock(metadata)}

## Gate Policy

- CI must pass.
- Agent review must pass.
- no-mistakes must pass before automerge.
- High-priority or high-risk work remains manual.
`;
}

export function preferredBranchName(issueNumber, title) {
  return `agent/issue-${issueNumber}-${slugify(title)}`;
}

export function selectExistingPull(pulls, config, issueNumber, preferredBranch) {
  const prefix = `agent/issue-${issueNumber}-`;
  const repo = `${config.repo.owner}/${config.repo.name}`;
  const candidates = pulls.filter(
    (pull) =>
      pull?.head?.repo?.full_name === repo &&
      pull?.base?.ref === config.repo.defaultBranch &&
      (pull.head.ref === preferredBranch || pull.head.ref.startsWith(prefix))
  );
  return (
    candidates
      .map((pull) => ({
        pull,
        score: (pull.state === "open" ? 4 : 0) + (pull.head.ref === preferredBranch ? 2 : 0) + (pull.merged_at ? 1 : 0)
      }))
      .sort((left, right) => right.score - left.score)[0]?.pull ?? null
  );
}

const PULLS_QUERY = `
  query($owner:String!,$name:String!,$base:String!,$endCursor:String) {
    repository(owner:$owner,name:$name) {
      pullRequests(first:100,after:$endCursor,baseRefName:$base,states:[OPEN,CLOSED,MERGED]) {
        nodes {
          number
          id
          state
          mergedAt
          url
          baseRefName
          headRefName
          headRepository { nameWithOwner }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`;

function normalizeGraphQLPull(pull) {
  return {
    number: pull?.number,
    node_id: pull?.id,
    state: pull?.state === "OPEN" ? "open" : "closed",
    merged_at: pull?.mergedAt ?? null,
    html_url: pull?.url,
    base: { ref: pull?.baseRefName ?? "" },
    head: {
      ref: pull?.headRefName ?? "",
      repo: { full_name: pull?.headRepository?.nameWithOwner ?? "" }
    }
  };
}

export function listPulls(config, dependencies = {}) {
  const endpoint = `repos/${config.repo.owner}/${config.repo.name}/pulls?state=all&base=${encodeURIComponent(config.repo.defaultBranch)}&per_page=100`;
  const args = [
    "api",
    "graphql",
    "--paginate",
    "--slurp",
    "-f",
    `owner=${config.repo.owner}`,
    "-f",
    `name=${config.repo.name}`,
    "-f",
    `base=${config.repo.defaultBranch}`,
    "-f",
    `query=${PULLS_QUERY}`
  ];
  const readJson = dependencies.ghReadJson ?? ghReadJson;
  try {
    const pages = readJson(args, {}, { delays: [1000, 2000, 4000] });
    if (!Array.isArray(pages) || pages.length === 0) {
      throw new AgentError("GraphQL pull list response is invalid", 1);
    }
    return pages.flatMap((page) => {
      const nodes = page?.data?.repository?.pullRequests?.nodes;
      if (!Array.isArray(nodes)) throw new AgentError("GraphQL pull list response is invalid", 1);
      return nodes.map(normalizeGraphQLPull);
    });
  } catch (error) {
    if (!isTransientGitHubReadError(error)) throw error;
  }
  const apiJson = dependencies.ghApiJson ?? ghApiJson;
  // GitHub's REST pull schema includes node_id, which the GraphQL update mutation reuses.
  return apiJson(endpoint, { paginate: true }) ?? [];
}

export function getRepositoryNodeId(config, dependencies = {}) {
  const readJson = dependencies.ghReadJson ?? ghReadJson;
  try {
    const repository = readJson([
      "repo",
      "view",
      `${config.repo.owner}/${config.repo.name}`,
      "--json",
      "id"
    ]);
    if (typeof repository?.id === "string" && repository.id) return repository.id;
    throw new AgentError("GraphQL repository node id response is invalid", 1);
  } catch (error) {
    if (!isTransientGitHubReadError(error)) throw error;
  }
  const apiJson = dependencies.ghApiJson ?? ghApiJson;
  const repository = apiJson(`repos/${config.repo.owner}/${config.repo.name}`);
  if (typeof repository?.node_id !== "string" || !repository.node_id) {
    throw new AgentError("repository has no GraphQL node id", 1);
  }
  return repository.node_id;
}

function remoteAgentBranches(issueNumber, cwd = repoRoot()) {
  const prefix = `refs/heads/agent/issue-${issueNumber}-*`;
  const result = runCommand("git", ["ls-remote", "--heads", "origin", prefix], { cwd, check: false });
  if (result.status !== 0) throw new AgentError("could not inspect existing agent branches", 1);
  return result.stdout
    .split("\n")
    .map((line) => line.trim().split(/\s+/).at(-1) ?? "")
    .filter((ref) => ref.startsWith("refs/heads/"))
    .map((ref) => ref.slice("refs/heads/".length));
}

export function chooseAgentBranch(preferredBranch, existingPull, remoteBranches) {
  if (existingPull?.head?.ref) return existingPull.head.ref;
  if (remoteBranches.includes(preferredBranch)) return preferredBranch;
  if (remoteBranches.length === 1) return remoteBranches[0];
  if (remoteBranches.length > 1) {
    throw new AgentError("multiple existing agent branches found for issue", 1, { branches: remoteBranches });
  }
  return preferredBranch;
}

function checkoutAgentBranch(config, branch, remoteExists, cwd = repoRoot()) {
  const baseRemoteRef = `refs/remotes/origin/${config.repo.defaultBranch}`;
  runCommand("git", [
    "fetch",
    "origin",
    `+refs/heads/${config.repo.defaultBranch}:${baseRemoteRef}`
  ], { cwd });
  if (remoteExists) {
    const branchRemoteRef = `refs/remotes/origin/${branch}`;
    runCommand("git", ["fetch", "origin", `+refs/heads/${branch}:${branchRemoteRef}`], { cwd });
    runCommand("git", ["switch", "-C", branch, branchRemoteRef], { cwd });
    return;
  }
  runCommand("git", ["switch", "-C", branch, baseRemoteRef], { cwd });
}

export function applyPatchIdempotently(patchPath, cwd = repoRoot()) {
  if (!existsSync(patchPath)) throw new AgentError(`patch not found: ${patchPath}`, 2);
  if (!readText(patchPath).trim()) throw new AgentError("patch is empty", 2);
  const forward = runCommand("git", ["apply", "--check", patchPath], { cwd, check: false });
  if (forward.status === 0) {
    runCommand("git", ["apply", "--index", patchPath], { cwd });
    return "applied";
  }
  const reverse = runCommand("git", ["apply", "--reverse", "--check", patchPath], { cwd, check: false });
  if (reverse.status === 0) return "already-applied";
  throw new AgentError("agent patch conflicts with the existing agent branch", 1);
}

export function upsertPullRequest({ config, issue, branch, codexOutput, metadata, existingPull }, dependencies = {}) {
  const apiJson = dependencies.ghJson ?? ghJson;
  const tempJson = dependencies.withTempJson ?? withTempJson;
  const repositoryNodeId = dependencies.getRepositoryNodeId ?? getRepositoryNodeId;
  const body = prBody(issue, codexOutput, metadata);
  const title = `Agent: ${issue.title}`;
  if (existingPull && (typeof existingPull.node_id !== "string" || !existingPull.node_id)) {
    throw new AgentError(`existing agent PR #${existingPull.number} has no GraphQL node id`, 1);
  }
  const payload = existingPull
    ? {
        query: "mutation($id:ID!,$title:String!,$body:String!){updatePullRequest(input:{pullRequestId:$id,title:$title,body:$body}){pullRequest{number url}}}",
        variables: { id: existingPull.node_id, title, body }
      }
    : {
        query: "mutation($repositoryId:ID!,$baseRefName:String!,$headRefName:String!,$title:String!,$body:String!){createPullRequest(input:{repositoryId:$repositoryId,baseRefName:$baseRefName,headRefName:$headRefName,title:$title,body:$body,draft:true}){pullRequest{number url}}}",
        variables: {
          repositoryId: repositoryNodeId(config),
          baseRefName: config.repo.defaultBranch,
          headRefName: branch,
          title,
          body
        }
      };
  const pull = tempJson(payload, (bodyPath) =>
    apiJson(["api", "graphql", "--input", bodyPath])
  );
  const result = existingPull
    ? pull?.data?.updatePullRequest?.pullRequest
    : pull?.data?.createPullRequest?.pullRequest;
  if (!Number.isInteger(result?.number) || typeof result?.url !== "string" || !result.url) {
    throw new AgentError("GraphQL pull-request mutation returned invalid metadata", 1);
  }
  return {
    action: existingPull ? "updated" : "created",
    number: result.number,
    url: result.url
  };
}

export function dispatchCandidateCi(config, prNumber, headSha, dependencies = {}) {
  const run = dependencies.runCommand ?? runCommand;
  if (!Number.isInteger(Number(prNumber)) || !/^[a-f0-9]{40}$/.test(String(headSha ?? ""))) {
    throw new AgentError("candidate CI dispatch requires a PR number and exact head SHA", 1);
  }
  const args = [
    "workflow",
    "run",
    "ci.yml",
    "--repo",
    `${config.repo.owner}/${config.repo.name}`,
    "--ref",
    config.repo.defaultBranch,
    "-f",
    `pr-number=${prNumber}`,
    "-f",
    `expected-head-sha=${headSha}`
  ];
  run("gh", args);
  return { ok: true, workflow: "ci.yml", prNumber: Number(prNumber), headSha };
}

function checkEnvironment() {
  const env = { ...process.env };
  for (const name of [
    "GH_TOKEN",
    "GITHUB_TOKEN",
    "AGENT_PAT",
    "OPENAI_API_KEY",
    "CODEX_API_KEY",
    "ACTIONS_RUNTIME_TOKEN",
    "ACTIONS_ID_TOKEN_REQUEST_TOKEN",
    "ACTIONS_ID_TOKEN_REQUEST_URL",
    "GITHUB_ENV",
    "GITHUB_OUTPUT",
    "GITHUB_PATH",
    "GITHUB_STEP_SUMMARY",
    "VERCEL_TOKEN",
    "VERCEL_OIDC_TOKEN",
    "HCLOUD_TOKEN",
    "HETZNER_TOKEN",
    "HETZNER_API_TOKEN"
  ]) {
    delete env[name];
  }
  return env;
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function triageSnapshotSha256(comment, marker) {
  const text = String(comment?.body ?? "");
  const afterMarker = text.slice(text.indexOf(marker) + String(marker).length);
  const fences = [...afterMarker.matchAll(/```json\s*([\s\S]*?)```/gi)];
  if (fences.length !== 1) throw new AgentError("trusted triage must contain exactly one structured decision", 1);
  const decision = extractJson(fences[0][1]);
  if (!/^[a-f0-9]{64}$/.test(String(decision?.issueSnapshotSha256 ?? ""))) {
    throw new AgentError("trusted triage issue snapshot is invalid", 1);
  }
  return decision.issueSnapshotSha256;
}

export function assertIssueMatchesTriageSnapshot(issue, triage, marker) {
  const expected = triageSnapshotSha256(triage, marker);
  const current = issueSnapshotSha256(issue);
  if (expected !== current) throw new AgentError(`source issue #${issue.number} changed after trusted triage`, 1);
  return current;
}

function exactBaseSha(config, cwd = repoRoot()) {
  const head = gitOutput(["rev-parse", "HEAD"], { cwd });
  const remote = runCommand("git", ["rev-parse", `refs/remotes/origin/${config.repo.defaultBranch}`], {
    cwd,
    check: false
  });
  if (remote.status !== 0 || remote.stdout.trim() !== head) {
    throw new AgentError(`validation base must equal origin/${config.repo.defaultBranch}`, 1);
  }
  return head;
}

function readArtifactMetadata(path, label = "integrity manifest") {
  if (!existsSync(path)) throw new AgentError(`${label} not found: ${path}`, 2);
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new AgentError(`${label} is not valid JSON`, 1);
  }
  const expectedKeys = [
    "baseSha",
    "changedPaths",
    "checks",
    "codexOutputSha256",
    "issueNumber",
    "issueSnapshotSha256",
    "patchSha256",
    "resultTree",
    "version"
  ];
  if (
    JSON.stringify(Object.keys(manifest ?? {}).sort()) !== JSON.stringify(expectedKeys) ||
    manifest?.version !== 1 ||
    !Number.isInteger(manifest.issueNumber) ||
    !/^[a-f0-9]{64}$/.test(manifest.issueSnapshotSha256 ?? "") ||
    !/^[a-f0-9]{40,64}$/.test(manifest.baseSha ?? "") ||
    !/^[a-f0-9]{40,64}$/.test(manifest.resultTree ?? "") ||
    !/^[a-f0-9]{64}$/.test(manifest.patchSha256 ?? "") ||
    !/^[a-f0-9]{64}$/.test(manifest.codexOutputSha256 ?? "") ||
    !Array.isArray(manifest.changedPaths) ||
    !manifest.changedPaths.every((path) => typeof path === "string") ||
    new Set(manifest.changedPaths).size !== manifest.changedPaths.length ||
    !Array.isArray(manifest.checks) ||
    !manifest.checks.every((command) => typeof command === "string")
  ) {
    throw new AgentError(`${label} is invalid`, 1);
  }
  return manifest;
}

function readIntegrityManifest(path) {
  return readArtifactMetadata(path);
}

function readImplementationIntent(path, issueNumber) {
  if (!existsSync(path)) throw new AgentError(`implementation intent not found: ${path}`, 2);
  let intent;
  try {
    intent = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new AgentError("implementation intent is not valid JSON", 1);
  }
  if (
    JSON.stringify(Object.keys(intent ?? {}).sort()) !==
      JSON.stringify(["issueNumber", "issueSnapshotSha256", "version"]) ||
    intent.version !== 1 ||
    intent.issueNumber !== issueNumber ||
    !/^[a-f0-9]{64}$/.test(intent.issueSnapshotSha256 ?? "")
  ) {
    throw new AgentError("implementation intent is invalid", 1);
  }
  return intent;
}

function stagedChangedPaths(cwd) {
  return runCommand("git", ["diff", "--cached", "--no-renames", "--name-only"], { cwd }).stdout
    .split("\n")
    .map((path) => path.trim())
    .filter(Boolean)
    .sort();
}

function pathWithin(parent, candidate) {
  const path = relative(resolve(parent), resolve(candidate));
  return path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

export function preparePatchValidation(
  config,
  issueNumber,
  patchPath,
  codexOutputPath,
  preparedPath,
  candidateDir,
  cwd = repoRoot(),
  intentPath = join(dirname(patchPath), "implementation-intent.json")
) {
  if (typeof patchPath !== "string" || !existsSync(patchPath)) throw new AgentError(`patch not found: ${patchPath}`, 2);
  if (typeof codexOutputPath !== "string" || !existsSync(codexOutputPath)) {
    throw new AgentError(`agent output not found: ${codexOutputPath}`, 2);
  }
  if (typeof preparedPath !== "string" || !preparedPath) throw new AgentError("missing prepared metadata path", 2);
  if (typeof candidateDir !== "string" || !candidateDir) throw new AgentError("missing candidate directory", 2);
  if (pathWithin(cwd, candidateDir) || pathWithin(candidateDir, cwd)) {
    throw new AgentError("candidate directory must be isolated from the trusted checkout", 2);
  }
  if (pathWithin(cwd, preparedPath) || pathWithin(candidateDir, preparedPath)) {
    throw new AgentError("prepared metadata must be isolated from the checkout and candidate", 2);
  }
  if (existsSync(candidateDir)) throw new AgentError(`candidate directory already exists: ${candidateDir}`, 2);
  const baseSha = exactBaseSha(config, cwd);
  const intent = readImplementationIntent(intentPath, issueNumber);
  const patchAction = applyPatchIdempotently(patchPath, cwd);
  if (patchAction !== "applied") throw new AgentError("validation patch must apply cleanly to the exact base", 1);
  const changed = stagedChangedPaths(cwd);
  const blockedPaths = privilegedPatchPaths(changed);
  if (blockedPaths.length) throw new AgentError("agent patch touches privileged paths", 1, { paths: blockedPaths });
  runCommand("git", ["diff", "--cached", "--check"], { cwd });
  const unstaged = runCommand("git", ["diff", "--no-renames", "--name-only"], { cwd }).stdout.trim();
  if (unstaged) throw new AgentError("patch preparation produced unstaged changes", 1);
  const resultTree = gitOutput(["write-tree"], { cwd });
  const prepared = {
    version: 1,
    issueNumber,
    issueSnapshotSha256: intent.issueSnapshotSha256,
    baseSha,
    resultTree,
    patchSha256: sha256(patchPath),
    codexOutputSha256: sha256(codexOutputPath),
    changedPaths: changed,
    checks: [...config.commands.defaultImplementChecks]
  };
  mkdirSync(candidateDir);
  runCommand("git", ["checkout-index", "--all", `--prefix=${candidateDir}/`], { cwd });
  writeFileSync(preparedPath, `${JSON.stringify(prepared, null, 2)}\n`);
  return { ...prepared, candidateDir };
}

export function runPatchValidationChecks(config, cwd = repoRoot()) {
  if (process.env.AGENT_VALIDATION_CONTAINER !== "1") {
    throw new AgentError("implementation checks must run in the isolated validation container", 1);
  }
  const env = checkEnvironment();
  for (const command of config.commands.defaultImplementChecks) runShell(command, { env, cwd });
  return { checks: [...config.commands.defaultImplementChecks] };
}

export function finalizePatchValidation(
  config,
  issueNumber,
  patchPath,
  codexOutputPath,
  preparedPath,
  manifestPath,
  cwd = repoRoot()
) {
  if (typeof patchPath !== "string" || !existsSync(patchPath)) throw new AgentError(`patch not found: ${patchPath}`, 2);
  if (typeof codexOutputPath !== "string" || !existsSync(codexOutputPath)) {
    throw new AgentError(`agent output not found: ${codexOutputPath}`, 2);
  }
  if (typeof manifestPath !== "string" || !manifestPath) throw new AgentError("missing integrity manifest path", 2);
  const prepared = readArtifactMetadata(preparedPath, "prepared validation metadata");
  if (prepared.issueNumber !== issueNumber) throw new AgentError("prepared validation issue does not match", 1);
  if (JSON.stringify(prepared.checks) !== JSON.stringify(config.commands.defaultImplementChecks)) {
    throw new AgentError("prepared validation checks do not match trusted config", 1);
  }
  if (prepared.baseSha !== exactBaseSha(config, cwd)) throw new AgentError("prepared validation base does not match", 1);
  if (prepared.patchSha256 !== sha256(patchPath)) throw new AgentError("prepared patch integrity check failed", 1);
  if (prepared.codexOutputSha256 !== sha256(codexOutputPath)) {
    throw new AgentError("prepared agent output integrity check failed", 1);
  }
  const unstaged = runCommand("git", ["diff", "--no-renames", "--name-only"], { cwd }).stdout.trim();
  if (unstaged) throw new AgentError("prepared validation checkout has unstaged changes", 1);
  const changed = stagedChangedPaths(cwd);
  if (JSON.stringify(changed) !== JSON.stringify(prepared.changedPaths)) {
    throw new AgentError("prepared validation paths changed", 1);
  }
  const blockedPaths = privilegedPatchPaths(changed);
  if (blockedPaths.length) throw new AgentError("prepared validation contains privileged paths", 1, { paths: blockedPaths });
  if (gitOutput(["write-tree"], { cwd }) !== prepared.resultTree) {
    throw new AgentError("prepared validation tree changed", 1);
  }
  writeFileSync(manifestPath, `${JSON.stringify(prepared, null, 2)}\n`);
  return prepared;
}

export function verifyValidatedArtifactBase(
  config,
  issueNumber,
  patchPath,
  codexOutputPath,
  manifestPath,
  cwd = repoRoot(),
  expectedIssueSnapshotSha256
) {
  if (typeof patchPath !== "string" || !existsSync(patchPath)) throw new AgentError(`patch not found: ${patchPath}`, 2);
  if (typeof codexOutputPath !== "string" || !existsSync(codexOutputPath)) {
    throw new AgentError(`agent output not found: ${codexOutputPath}`, 2);
  }
  const manifest = readIntegrityManifest(manifestPath);
  if (manifest.issueNumber !== issueNumber) throw new AgentError("integrity manifest issue does not match", 1);
  if (manifest.issueSnapshotSha256 !== expectedIssueSnapshotSha256) {
    throw new AgentError("integrity manifest source issue snapshot does not match", 1);
  }
  if (manifest.baseSha !== exactBaseSha(config, cwd)) throw new AgentError("integrity manifest base does not match", 1);
  if (manifest.patchSha256 !== sha256(patchPath)) throw new AgentError("patch integrity check failed", 1);
  if (manifest.codexOutputSha256 !== sha256(codexOutputPath)) {
    throw new AgentError("agent output integrity check failed", 1);
  }
  if (JSON.stringify(manifest.checks) !== JSON.stringify(config.commands.defaultImplementChecks)) {
    throw new AgentError("integrity manifest checks do not match trusted config", 1);
  }
  const blockedPaths = privilegedPatchPaths(manifest.changedPaths);
  if (blockedPaths.length) throw new AgentError("integrity manifest contains privileged paths", 1, { paths: blockedPaths });
  return manifest;
}

function verifyValidatedTree(manifest, cwd = repoRoot()) {
  const ancestor = runCommand("git", ["merge-base", "--is-ancestor", manifest.baseSha, "HEAD"], {
    cwd,
    check: false
  });
  if (ancestor.status !== 0) throw new AgentError("agent branch is not based on the validated base", 1);
  const unstaged = runCommand("git", ["diff", "--no-renames", "--name-only"], { cwd }).stdout.trim();
  if (unstaged) throw new AgentError("credentialed apply produced unstaged changes", 1);
  const tree = gitOutput(["write-tree"], { cwd });
  if (tree !== manifest.resultTree) throw new AgentError("applied tree does not match validated artifact", 1);
  const changed = runCommand("git", ["diff", "--no-renames", "--name-only", manifest.baseSha], { cwd }).stdout
    .split("\n")
    .map((path) => path.trim())
    .filter(Boolean)
    .sort();
  if (JSON.stringify(changed) !== JSON.stringify([...manifest.changedPaths].sort())) {
    throw new AgentError("applied paths do not match validated artifact", 1);
  }
  return tree;
}

export function alignRecoveredAgentBranch(manifest, cwd = repoRoot()) {
  const head = gitOutput(["rev-parse", "HEAD"], { cwd });
  const tree = gitOutput(["write-tree"], { cwd });
  const baseTree = gitOutput(["rev-parse", `${manifest.baseSha}^{tree}`], { cwd });
  const basedOnValidatedBase = runCommand("git", ["merge-base", "--is-ancestor", manifest.baseSha, "HEAD"], {
    cwd,
    check: false
  });
  if (basedOnValidatedBase.status === 0) {
    if (tree === baseTree || tree === manifest.resultTree) return { action: "ready", head };
    throw new AgentError("agent branch does not match the validated base or result tree", 1);
  }

  const mergeBase = runCommand("git", ["merge-base", "HEAD", manifest.baseSha], { cwd, check: false });
  const mergeBaseSha = mergeBase.stdout.trim();
  if (mergeBase.status !== 0 || !/^[a-f0-9]{40,64}$/.test(mergeBaseSha)) {
    throw new AgentError("agent branch has no common validated base", 1);
  }
  const mergeBaseTree = gitOutput(["rev-parse", `${mergeBaseSha}^{tree}`], { cwd });
  if (tree !== mergeBaseTree) {
    throw new AgentError("agent branch does not match the validated base or result tree", 1);
  }

  runCommand("git", ["merge", "--no-edit", manifest.baseSha], { cwd });
  if (gitOutput(["write-tree"], { cwd }) !== baseTree) {
    throw new AgentError("recovered agent branch did not align with the validated base", 1);
  }
  return { action: "merged-validated-base", head };
}

export function privilegedPatchPaths(paths) {
  return privilegedCandidatePaths(paths);
}

export function assertImplementationSource(config, issue) {
  const labels = issueLabels(issue);
  if (labels.includes(config.labels.blocked)) {
    throw new AgentError(`source issue #${issue.number} is blocked`, 1);
  }
  return labels;
}

export function implementationPullLabels(config, sourceLabels) {
  const labels = [config.labels.review];
  for (const propagated of [
    config.labels.automerge,
    config.labels.priorityHigh,
    config.labels.priorityLow,
    config.labels.proof
  ]) {
    if (sourceLabels.includes(propagated)) labels.push(propagated);
  }
  return [...new Set(labels)];
}

function normalizeImplementationError(error) {
  if (error instanceof AgentError && error.code === 2 && error.details === undefined) return error;
  const details = {};
  if (Array.isArray(error?.details?.paths)) details.paths = error.details.paths;
  if (Array.isArray(error?.details?.branches)) details.branches = error.details.branches;
  return new AgentError(error?.message ?? String(error), 1, Object.keys(details).length ? details : undefined);
}

function markImplementationFailure(config, issueNumber, error) {
  const result = { labels: null, comment: null };
  try {
    result.labels = {
      added: addLabels(config, issueNumber, [config.labels.blocked], false),
      removed: removeLabels(config, issueNumber, [config.labels.implement, config.labels.automerge], false)
    };
  } catch (labelError) {
    result.labels = { error: labelError?.message ?? String(labelError) };
  }
  try {
    result.comment = upsertManagedComment({
      config,
      number: issueNumber,
      marker: `${config.comments.gate}\n<!-- agent-gate-implement:v1 -->`,
      body: `Agent implementation blocked after an automation failure.

Structured blocker:
${markdownJsonBlock({
  failure: error.message,
  blockedPaths: error.details?.paths ?? [],
  branches: error.details?.branches ?? [],
  actionsRun: error.details?.actionsRun ?? "",
  requiredAction: "retry-or-human-review"
})}`,
      dryRun: false
    });
  } catch (commentError) {
    result.comment = { error: commentError?.message ?? String(commentError) };
  }
  return result;
}

export function applyPatchAndOpenPr(config, issueNumber, patchPath, codexOutputPath, manifestPath, dryRun) {
  if (!existsSync(patchPath)) throw new AgentError(`patch not found: ${patchPath}`, 2);
  const { issue, comments } = fetchIssue(config, issueNumber);
  const labels = assertImplementationSource(config, issue);
  const triage = newestManagedComment(comments, config.comments.triage, config.repo.owner);
  if (!triage) throw new AgentError(`source issue #${issueNumber} has no trusted managed triage`, 1);
  const snapshotSha256 = assertIssueMatchesTriageSnapshot(issue, triage, config.comments.triage);
  if (!dryRun) runCommand("gh", ["auth", "setup-git", "--hostname", "github.com"]);
  const metadata = {
    sourceIssue: issue.number,
    sourceLabels: labels,
    issueSnapshotSha256: snapshotSha256,
    automergeEligible:
      labels.includes(config.labels.automerge) &&
      !labels.includes(config.labels.priorityHigh) &&
      !labels.includes(config.labels.blocked)
  };
  const preferredBranch = preferredBranchName(issueNumber, issue.title);
  const existingPull = selectExistingPull(listPulls(config), config, issueNumber, preferredBranch);
  const remoteBranches = remoteAgentBranches(issueNumber);
  const branch = chooseAgentBranch(preferredBranch, existingPull, remoteBranches);
  const remoteExists = remoteBranches.includes(branch);
  const codexOutput = codexOutputPath && existsSync(codexOutputPath) ? readText(codexOutputPath) : "";

  if (existingPull?.merged_at) {
    if (!dryRun) removeLabels(config, issueNumber, [config.labels.implement], false);
    return {
      branch,
      action: dryRun ? "would-reuse-merged-pr" : "reused-merged-pr",
      issue: issue.number,
      pr: existingPull.number,
      url: existingPull.html_url
    };
  }
  if (existingPull && existingPull.state !== "open") {
    if (dryRun) {
      return { branch, action: "would-block-closed-pr", issue: issue.number, pr: existingPull.number };
    }
    throw new AgentError(`existing agent PR #${existingPull.number} is closed`, 1);
  }
  const manifest = verifyValidatedArtifactBase(
    config,
    issueNumber,
    patchPath,
    codexOutputPath,
    manifestPath,
    repoRoot(),
    snapshotSha256
  );
  if (dryRun) {
    return {
      branch,
      action: existingPull ? "would-update-branch-pr" : "would-upsert-branch-pr",
      issue: issue.number,
      pr: existingPull?.number ?? null,
      remoteExists
    };
  }

  checkoutAgentBranch(config, branch, remoteExists);
  runCommand("git", ["config", "user.name", "github-actions[bot]"]);
  runCommand("git", ["config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com"]);
  const branchAlignment = alignRecoveredAgentBranch(manifest);
  const patchAction = applyPatchIdempotently(patchPath);
  verifyValidatedTree(manifest);
  let committed = false;
  const staged = gitOutput(["diff", "--cached", "--name-only"]);
  if (staged) {
    runCommand("git", ["commit", "-m", `chore: implement agent issue #${issueNumber}`]);
    committed = true;
  }
  if (committed || branchAlignment.action === "merged-validated-base" || !remoteExists) {
    runCommand("git", ["push", "origin", `HEAD:refs/heads/${branch}`]);
  }
  const candidateSha = gitOutput(["rev-parse", "HEAD"]);
  const pull = upsertPullRequest({ config, issue, branch, codexOutput, metadata, existingPull });
  const prLabels = implementationPullLabels(config, labels);
  addLabels(config, pull.number, prLabels, false);
  const dispatch = {
    ci: dispatchCandidateCi(config, pull.number, candidateSha),
    review: dispatchWorkflow(
      config,
      "agent-review.yml",
      { "pr-number": pull.number, "expected-head-sha": candidateSha },
      false,
      config.repo.defaultBranch
    )
  };
  removeLabels(config, issueNumber, [config.labels.implement], false);
  upsertManagedComment({
    config,
    number: issueNumber,
    marker: `${config.comments.gate}\n<!-- agent-gate-implement:v1 -->`,
    body: `${pull.action === "created" ? "Opened" : "Updated"} agent PR: ${pull.url}

Structured handoff:
${markdownJsonBlock({
  pr: pull.number,
  branch,
  patchAction,
  committed,
  checks: config.commands.defaultImplementChecks
})}`,
    dryRun: false
  });
  return { branch, pr: pull.number, url: pull.url, action: pull.action, patchAction, committed, dispatch };
}

export async function main() {
  const args = parseArgs();
  const config = loadConfig();
  const issueNumber = Number(args["issue-number"]);
  if (args["issue-number"] === true || !Number.isInteger(issueNumber) || issueNumber <= 0) {
    throw new AgentError("missing --issue-number", 2);
  }
  const dryRun = Boolean(args["dry-run"]);

  if (args["write-prompt"]) {
    finish({ ok: true, message: `wrote implement prompt for #${issueNumber}`, ...writePrompt(config, issueNumber, args["write-prompt"]) }, Boolean(args.json));
    return;
  }
  if (args["create-patch"]) {
    finish({ ok: true, message: `created implementation patch for #${issueNumber}`, ...createPatch(args["create-patch"]) }, Boolean(args.json));
    return;
  }
  if (args["prepare-validation"]) {
    if (!args["prepared-metadata"]) throw new AgentError("missing --prepared-metadata", 2);
    if (!args["candidate-dir"]) throw new AgentError("missing --candidate-dir", 2);
    const result = preparePatchValidation(
      config,
      issueNumber,
      args["prepare-validation"],
      args["codex-output"],
      args["prepared-metadata"],
      args["candidate-dir"]
    );
    finish(
      { ok: true, message: `prepared isolated implementation validation for #${issueNumber}`, result },
      Boolean(args.json)
    );
    return;
  }
  if (args["run-validation-checks"]) {
    const result = runPatchValidationChecks(config);
    finish({ ok: true, message: `ran isolated implementation checks for #${issueNumber}`, result }, Boolean(args.json));
    return;
  }
  if (args["finalize-validation"]) {
    if (!args["prepared-metadata"]) throw new AgentError("missing --prepared-metadata", 2);
    if (!args["write-manifest"]) throw new AgentError("missing --write-manifest", 2);
    const result = finalizePatchValidation(
      config,
      issueNumber,
      args["finalize-validation"],
      args["codex-output"],
      args["prepared-metadata"],
      args["write-manifest"]
    );
    finish(
      { ok: true, message: `finalized isolated implementation validation for #${issueNumber}`, result },
      Boolean(args.json)
    );
    return;
  }
  if (args["mark-failed"]) {
    const actionsRun =
      process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
        ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
        : "";
    const error = new AgentError("implementation workflow did not open or update an agent PR", 1, {
      actionsRun
    });
    const result = dryRun ? { dryRun: true } : markImplementationFailure(config, issueNumber, error);
    finish(
      { ok: true, message: `${dryRun ? "would record" : "recorded"} implementation workflow failure for #${issueNumber}`, result },
      Boolean(args.json)
    );
    return;
  }
  if (args["apply-patch"]) {
    if (!args["integrity-manifest"]) throw new AgentError("missing --integrity-manifest", 2);
    try {
      const result = applyPatchAndOpenPr(
        config,
        issueNumber,
        args["apply-patch"],
        args["codex-output"],
        args["integrity-manifest"],
        dryRun
      );
      finish(
        { ok: true, message: `${dryRun ? "would upsert" : "upserted"} implementation PR for #${issueNumber}`, result },
        Boolean(args.json)
      );
    } catch (error) {
      const normalized = normalizeImplementationError(error);
      if (!dryRun && normalized.code !== 2) markImplementationFailure(config, issueNumber, normalized);
      throw normalized;
    }
    return;
  }
  throw new AgentError(
    "missing --write-prompt, --create-patch, --prepare-validation, --run-validation-checks, --finalize-validation, --apply-patch, or --mark-failed",
    2
  );
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => fail(error, Boolean(parseArgs().json)));
}
