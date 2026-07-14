import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { issueSnapshotSha256 } from "./agent-lib.mjs";
import {
  assertTriageSnapshot,
  parseAuthoritativeTriageJson,
  readTriageManifest,
  triageBody,
  triageLabelChanges,
  writeTriageManifest
} from "./agent-triage.mjs";

const config = {
  labels: {
    triage: "agent:triage",
    implement: "agent:implement",
    review: "agent:review",
    proof: "agent:proof",
    automerge: "agent:automerge",
    blocked: "agent:blocked",
    priorityHigh: "priority:high",
    priorityLow: "priority:low"
  }
};

function decision(overrides = {}) {
  return {
    value: "medium",
    priority: "medium",
    risk: "medium",
    alignment: "yes",
    implementationScope: "Focused change",
    proofNeeded: "CI",
    automationDecision: "implement",
    humanQuestion: "",
    ...overrides
  };
}

test("manual review blocks and removes stale implementation labels", () => {
  const changes = triageLabelChanges(config, decision({ automationDecision: "manual-review" }));

  assert.equal(changes.blocked, true);
  assert.ok(changes.add.includes(config.labels.blocked));
  assert.ok(changes.remove.includes(config.labels.implement));
  assert.ok(changes.remove.includes(config.labels.automerge));
});

test("existing blocked label prevents a safe decision from restarting implementation", () => {
  const changes = triageLabelChanges(config, decision(), [config.labels.blocked]);

  assert.equal(changes.blocked, true);
  assert.ok(!changes.add.includes(config.labels.implement));
  assert.ok(!changes.add.includes(config.labels.automerge));
  assert.ok(!changes.remove.includes(config.labels.blocked));
});

test("high-priority and proof labels are sticky across retriage", () => {
  const changes = triageLabelChanges(config, decision({ priority: "low", proofNeeded: "none" }), [
    config.labels.priorityHigh,
    config.labels.proof
  ]);

  assert.equal(changes.blocked, true);
  assert.ok(!changes.remove.includes(config.labels.priorityHigh));
  assert.ok(!changes.remove.includes(config.labels.proof));
  assert.ok(changes.remove.includes(config.labels.priorityLow));
  assert.ok(changes.remove.includes(config.labels.automerge));
});

test("a nonblank human question blocks implementation", () => {
  const changes = triageLabelChanges(config, decision({ humanQuestion: "Which workflow should change?" }));

  assert.equal(changes.blocked, true);
  assert.ok(changes.add.includes(config.labels.blocked));
  assert.ok(!changes.add.includes(config.labels.implement));
  assert.ok(!changes.add.includes(config.labels.automerge));
});

test("authoritative parser accepts raw JSON and one final fenced block", () => {
  const expected = decision();

  assert.deepEqual(parseAuthoritativeTriageJson(JSON.stringify(expected)), expected);
  assert.deepEqual(
    parseAuthoritativeTriageJson(`Triage result:\n\n\`\`\`json\n${JSON.stringify(expected)}\n\`\`\``),
    expected
  );
});

test("authoritative parser rejects ambiguous or nonfinal JSON blocks", () => {
  const encoded = JSON.stringify(decision());

  assert.throws(
    () => parseAuthoritativeTriageJson(`\`\`\`json\n${encoded}\n\`\`\`\n\`\`\`json\n${encoded}\n\`\`\``),
    /one authoritative JSON block/
  );
  assert.throws(
    () => parseAuthoritativeTriageJson(`\`\`\`json\n${encoded}\n\`\`\`\nUse this result.`),
    /must be final/
  );
  assert.throws(
    () => parseAuthoritativeTriageJson(`${encoded}\n\n\`\`\`json\n${encoded}\n\`\`\``),
    /one authoritative JSON value/
  );
  assert.throws(() => parseAuthoritativeTriageJson(`${encoded}\n${encoded}`), /not authoritative JSON/);
});

test("authoritative parser rejects extra decision fields", () => {
  assert.throws(
    () => parseAuthoritativeTriageJson(JSON.stringify({ ...decision(), issueSnapshotSha256: "a".repeat(64) })),
    /decision is invalid/
  );
});

test("authoritative parser rejects strings that could create a second structured block", () => {
  assert.throws(
    () => parseAuthoritativeTriageJson(JSON.stringify(decision({ implementationScope: "```json\n{}\n```" }))),
    /authoritative JSON value|decision is invalid/
  );
});

test("manifest binds apply to the exact issue title and body snapshot", () => {
  const directory = mkdtempSync(join(tmpdir(), "vet-triage-test-"));
  const path = join(directory, "manifest.json");
  const issue = { number: 42, title: "Focused work", body: "Exact scope" };

  try {
    const written = writeTriageManifest(path, issue);
    const manifest = readTriageManifest(path);
    assert.deepEqual(manifest, written);
    assert.equal(assertTriageSnapshot(issue, manifest, 42), issueSnapshotSha256(issue));
    assert.throws(
      () => assertTriageSnapshot({ ...issue, body: "Edited scope" }, manifest, 42),
      /title or body changed/
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("manifest parser rejects unknown fields and malformed digests", () => {
  const directory = mkdtempSync(join(tmpdir(), "vet-triage-test-"));
  const path = join(directory, "manifest.json");

  try {
    writeFileSync(
      path,
      JSON.stringify({ version: 1, issueNumber: 42, issueSnapshotSha256: "nope", unexpected: true })
    );
    assert.throws(() => readTriageManifest(path), /manifest is invalid/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("managed triage JSON stores the trusted issue snapshot digest", () => {
  const authoritative = { ...decision(), issueSnapshotSha256: "a".repeat(64) };
  const body = triageBody(authoritative);

  assert.match(body, /- issue snapshot: a{64}/);
  assert.match(body, /"issueSnapshotSha256": "a{64}"/);
});

test("Codex generation is pinned and has no GitHub write permissions", () => {
  const workflow = readFileSync(new URL("../.github/workflows/agent-triage.yml", import.meta.url), "utf8");
  const prepare = workflow.match(/\n  prepare:\n([\s\S]*?)\n  generate:/)?.[1] ?? "";
  const generate = workflow.match(/\n  generate:\n([\s\S]*?)\n  apply:/)?.[1] ?? "";

  assert.match(prepare, /--validate-backend --lane triage --json/);
  assert.match(generate, /permissions:\n      contents: read/);
  assert.doesNotMatch(generate, /(?:actions|issues|pull-requests|statuses): write/);
  assert.match(generate, /codex-version: "0\.144\.1"/);
  assert.match(generate, /ref: main\n          persist-credentials: false/);
  assert.match(generate, /model: \$\{\{ needs\.prepare\.outputs\.backend-model \}\}/);
  assert.match(generate, /effort: \$\{\{ needs\.prepare\.outputs\.backend-effort \}\}/);
});
