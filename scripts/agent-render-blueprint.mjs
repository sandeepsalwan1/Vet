#!/usr/bin/env node

import { lstatSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  AgentError,
  fail,
  finish,
  parseArgs,
  runCommand
} from "./agent-lib.mjs";

const PAYMENT_BLOCK = "need_payment_info";
const MAX_BLUEPRINT_BYTES = 1_000_000;

function parseDocument(text) {
  try {
    return JSON.parse(String(text ?? ""));
  } catch {
    throw new AgentError("Render Blueprint validation returned invalid JSON", 1);
  }
}

export function validateBlueprintResult(document) {
  if (
    !document ||
    typeof document.valid !== "boolean" ||
    !Array.isArray(document.errors)
  ) {
    throw new AgentError("Render Blueprint validation result is invalid", 1);
  }
  const errors = document.errors.map((error) => {
    if (
      !error ||
      typeof error.error !== "string" ||
      typeof error.path !== "string" ||
      !Number.isInteger(error.line) ||
      !Number.isInteger(error.column)
    ) {
      throw new AgentError("Render Blueprint validation error is invalid", 1);
    }
    return {
      code: error.error,
      path: error.path.slice(0, 200),
      line: error.line,
      column: error.column
    };
  });
  const unsupported = errors.filter((error) => error.code !== PAYMENT_BLOCK);
  if (
    unsupported.length > 0 ||
    (!document.valid && errors.length === 0) ||
    (document.valid && errors.length > 0)
  ) {
    throw new AgentError(
      `Render Blueprint validation failed: ${unsupported.map((error) => error.code).join(", ") || "unknown error"}`,
      1
    );
  }
  return {
    version: 1,
    status: "passed",
    renderValid: document.valid,
    acceptedAccountBlocks: errors.filter(
      (error) => error.code === PAYMENT_BLOCK
    )
  };
}

export function verifyRenderBlueprint(path, dependencies = {}) {
  const target = resolve(path);
  const info = lstatSync(target);
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.size <= 0 ||
    info.size > MAX_BLUEPRINT_BYTES
  ) {
    throw new AgentError("Render Blueprint must be a bounded regular file", 1);
  }
  readFileSync(target, "utf8");
  const execute = dependencies.runCommand ?? runCommand;
  const run = execute(
    "render",
    ["blueprints", "validate", target, "-o", "json", "--confirm"],
    {
      check: false,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        RENDER_API_KEY: process.env.RENDER_API_KEY
      }
    }
  );
  const result = validateBlueprintResult(parseDocument(run.stdout));
  if (
    run.status !== 0 &&
    (result.renderValid || result.acceptedAccountBlocks.length === 0)
  ) {
    throw new AgentError("Render Blueprint validation command failed", 1);
  }
  return result;
}

export async function main() {
  const args = parseArgs();
  const path = String(args.blueprint ?? "");
  if (!path) throw new AgentError("missing --blueprint", 2);
  const result = verifyRenderBlueprint(path);
  finish(
    {
      ok: true,
      message: "Render Blueprint validation passed",
      result
    },
    Boolean(args.json)
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => fail(error, Boolean(parseArgs().json)));
}
