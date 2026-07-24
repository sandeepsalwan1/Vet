import assert from "node:assert/strict";
import test from "node:test";
import { planMigrations } from "./migrationPlan.mjs";

const files = [
  "001_initial.sql",
  "027_client_analytics.sql",
  "028_separate_central_vet_and_tri_city.sql",
  "029_future.sql"
];

test("baselines legacy files without skipping a new migration", () => {
  assert.deepEqual(
    planMigrations({
      files,
      appliedFiles: [],
      legacyBaselineComplete: true
    }),
    {
      baseline: files.slice(0, 3),
      pending: ["029_future.sql"]
    }
  );
});

test("runs every migration for a fresh database", () => {
  assert.deepEqual(
    planMigrations({
      files,
      appliedFiles: [],
      legacyBaselineComplete: false
    }),
    {
      baseline: [],
      pending: files
    }
  );
});

test("runs only migrations missing from an existing ledger", () => {
  assert.deepEqual(
    planMigrations({
      files,
      appliedFiles: files.slice(0, 2),
      legacyBaselineComplete: true
    }),
    {
      baseline: [],
      pending: files.slice(2)
    }
  );
});
