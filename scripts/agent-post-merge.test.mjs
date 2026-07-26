import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  postMergeBody,
  postMergeLabelChanges,
  validateDeploymentLineage,
  validateRenderRecord
} from "./agent-post-merge.mjs";

const sha = "a".repeat(40);
const newerSha = "b".repeat(40);
const currentSha = "c".repeat(40);
const config = {
  labels: {
    postMergeFailed: "agent:post-merge-failed",
    blocked: "agent:blocked"
  }
};
const record = {
  version: 2,
  status: "passed",
  expectedSha: sha,
  deployedSha: sha,
  deploymentSource: "observed",
  previousLiveSha: sha,
  deployStatus: "live",
  deployStartedAt: "2026-07-25T03:55:00Z",
  deployFinishedAt: "2026-07-25T03:57:00Z",
  logs: { count: 10, errorCount: 0 },
  health: [
    {
      url: "https://centralvet.eepish.com/api/clinic",
      status: 200,
      clinicSlug: "central-vet",
      passed: true
    }
  ],
  summary: "Exact merged revision is healthy.",
  blocker: ""
};

test("post-merge workflow can read the exact pull request it validates", () => {
  const workflow = readFileSync(
    new URL("../.github/workflows/agent-post-merge.yml", import.meta.url),
    "utf8"
  );
  assert.match(
    workflow,
    /permissions:\n\s+contents: read\n\s+issues: write\n\s+pull-requests: read\n\s+statuses: write/
  );
  assert.match(workflow, /RENDER_WORKSPACE_ID: \$\{\{ secrets\.RENDER_WORKSPACE_ID \}\}/);
  assert.match(workflow, /render workspace set "\$RENDER_WORKSPACE_ID"/);
  assert.match(workflow, /--ensure-latest-deploy/);
  assert.doesNotMatch(workflow, /--commit/);
  assert.match(workflow, /DEPLOY_SHA: \$\{\{ steps\.target\.outputs\.deploy-sha \}\}/);
  assert.match(workflow, /args\+=\(--target-sha "\$TARGET_SHA"\)/);
});

test("post-merge success accepts only bound observation or latest-branch evidence", () => {
  assert.equal(validateRenderRecord(record, sha), record);
  assert.throws(
    () => validateRenderRecord({ ...record, deployedSha: "b".repeat(40) }, sha),
    /inconsistent/
  );
  assert.equal(
    validateRenderRecord(
      {
        ...record,
        deployedSha: newerSha,
        deploymentSource: "latest-branch"
      },
      sha
    ).deployedSha,
    newerSha
  );
  assert.throws(
    () =>
      validateRenderRecord(
        { ...record, health: [{ ...record.health[0], passed: false }] },
        sha
      ),
    /inconsistent/
  );
});

test("post-merge recovery accepts only deployed main descendants of the merge", () => {
  const comparison = (ancestor) => ({
    status: "ahead",
    behind_by: 0,
    merge_base_commit: { sha: ancestor }
  });
  assert.deepEqual(
    validateDeploymentLineage({
      mergeSha: sha,
      deploySha: newerSha,
      currentMainSha: currentSha,
      previousLiveSha: sha,
      mergeToDeploy: comparison(sha),
      deployToMain: comparison(newerSha),
      previousToDeploy: comparison(sha)
    }),
    {
      mergeSha: sha,
      deploySha: newerSha,
      currentMainSha: currentSha
    }
  );
  assert.throws(
    () =>
      validateDeploymentLineage({
        mergeSha: sha,
        deploySha: newerSha,
        currentMainSha: currentSha,
        mergeToDeploy: { ...comparison(sha), behind_by: 1 },
        deployToMain: comparison(newerSha)
      }),
    /does not contain the merged commit/
  );
  assert.throws(
    () =>
      validateDeploymentLineage({
        mergeSha: sha,
        deploySha: newerSha,
        currentMainSha: currentSha,
        previousLiveSha: currentSha,
        mergeToDeploy: comparison(sha),
        deployToMain: comparison(newerSha),
        previousToDeploy: {
          status: "behind",
          behind_by: 1,
          merge_base_commit: { sha: newerSha }
        }
      }),
    /would roll back/
  );
  assert.throws(
    () =>
      validateDeploymentLineage({
        mergeSha: sha,
        deploySha: newerSha,
        currentMainSha: currentSha,
        mergeToDeploy: comparison(sha),
        deployToMain: {
          status: "diverged",
          behind_by: 1,
          merge_base_commit: { sha: newerSha }
        }
      }),
    /not on current main/
  );
});

test("post-merge recovery removes shared blocker only when it owns a failure marker", () => {
  assert.deepEqual(
    postMergeLabelChanges(
      config,
      ["agent:post-merge-failed", "agent:blocked"],
      true
    ),
    {
      add: [],
      remove: ["agent:post-merge-failed", "agent:blocked"]
    }
  );
  assert.deepEqual(postMergeLabelChanges(config, ["agent:blocked"], true), {
    add: [],
    remove: ["agent:post-merge-failed"]
  });
  assert.deepEqual(postMergeLabelChanges(config, [], false), {
    add: ["agent:post-merge-failed", "agent:blocked"],
    remove: []
  });
});

test("post-merge comment contains bounded evidence and no provider identifiers", () => {
  const body = postMergeBody(
    record,
    sha,
    "https://github.com/sandeepsalwan1/Vet/actions/runs/123"
  );
  assert.match(body, /centralvet\.eepish\.com/);
  assert.match(body, /Logs observed: 10/);
  assert.match(body, /Deployment source: observed/);
  assert.match(body, new RegExp(`Deployed revision: \\\`${sha}\\\``));
  assert.equal(body.includes("srv-"), false);
  assert.equal(body.includes("dep-"), false);
});
