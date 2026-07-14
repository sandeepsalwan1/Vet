import assert from "node:assert/strict";
import test from "node:test";

import { commentHasManagedMarker, dispatchWorkflow } from "./agent-lib.mjs";

test("managed comment markers match exact stage prefixes only", () => {
  const base = "<!-- agent-gate:v1 -->";
  const implement = `${base}\n<!-- agent-gate-implement:v1 -->`;
  const noMistakes = `${base}\n<!-- agent-gate-no-mistakes:v1 -->`;

  assert.equal(commentHasManagedMarker(`${implement}\nbody`, implement), true);
  assert.equal(commentHasManagedMarker(`${noMistakes}\nbody`, implement), false);
  assert.equal(commentHasManagedMarker(`prefix ${implement}\nbody`, implement), false);
});

test("workflow dispatch can target an exact branch", () => {
  const config = { repo: { owner: "owner", name: "repo" } };
  assert.deepEqual(dispatchWorkflow(config, "ci.yml", {}, true, "agent/issue-42-fix"), {
    ok: true,
    dryRun: true,
    workflow: "ci.yml",
    fields: {},
    ref: "agent/issue-42-fix"
  });
});
