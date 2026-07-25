import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  validateBlueprintResult,
  verifyRenderBlueprint
} from "./agent-render-blueprint.mjs";

test("Blueprint validation accepts valid config and known account billing blocks", () => {
  assert.equal(
    validateBlueprintResult({ valid: true, errors: [] }).renderValid,
    true
  );
  const result = validateBlueprintResult({
    valid: false,
    errors: [
      {
        error: "need_payment_info",
        path: "services[1]",
        line: 95,
        column: 5
      }
    ]
  });
  assert.equal(result.renderValid, false);
  assert.equal(result.acceptedAccountBlocks.length, 1);
  assert.throws(
    () =>
      validateBlueprintResult({
        valid: false,
        errors: [
          {
            error: "invalid_service_type",
            path: "services[0]",
            line: 4,
            column: 3
          }
        ]
      }),
    /invalid_service_type/
  );
  assert.throws(
    () =>
      validateBlueprintResult({
        valid: true,
        errors: [
          {
            error: "need_payment_info",
            path: "services[1]",
            line: 95,
            column: 5
          }
        ]
      }),
    /failed/
  );
});

test("Blueprint verifier executes only the bounded regular file", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "vet-blueprint-"));
  const blueprint = join(dir, "render.yaml");
  writeFileSync(blueprint, "services: []\n");
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  let call;
  const result = verifyRenderBlueprint(blueprint, {
    runCommand(command, args) {
      call = { command, args };
      return {
        status: 0,
        stdout: JSON.stringify({ valid: true, errors: [] }),
        stderr: ""
      };
    }
  });

  assert.equal(result.status, "passed");
  assert.equal(call.command, "render");
  assert.deepEqual(call.args.slice(0, 2), ["blueprints", "validate"]);
  assert.equal(call.args[2], blueprint);
});

test("Blueprint verifier preserves known billing blocks across CLI exit codes", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "vet-blueprint-billing-"));
  const blueprint = join(dir, "render.yaml");
  writeFileSync(blueprint, "services: []\n");
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const blocked = {
    valid: false,
    errors: [{
      error: "need_payment_info",
      path: "services[1]",
      line: 95,
      column: 5
    }]
  };
  const result = verifyRenderBlueprint(blueprint, {
    runCommand() {
      return {
        status: 1,
        stdout: JSON.stringify(blocked),
        stderr: ""
      };
    }
  });
  assert.equal(result.acceptedAccountBlocks.length, 1);
  assert.throws(
    () =>
      verifyRenderBlueprint(blueprint, {
        runCommand() {
          return {
            status: 1,
            stdout: JSON.stringify({ valid: true, errors: [] }),
            stderr: ""
          };
        }
      }),
    /command failed/
  );
});
