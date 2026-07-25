#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { AgentError, fail, finish, parseArgs, repoRoot } from "./agent-lib.mjs";

export const REQUIRED_CRABBOX_SKILLS = Object.freeze([
  "vet-worker",
  "vet-autoreview",
  "vet-behavior-validator",
  "vet-frontend-design",
  "vet-shadcn",
  "vet-render-cli",
  "vet-render-postgres",
  "vet-supabase"
]);

function normalizedPath(path) {
  return resolve(path).replaceAll("\\", "/");
}

export function verifyCodexSkillDiscovery(document, root = repoRoot(), required = REQUIRED_CRABBOX_SKILLS) {
  if (!Array.isArray(document)) throw new AgentError("Codex prompt input must be a JSON array", 1);

  const catalogs = document
    .filter((message) => message?.role === "developer" && Array.isArray(message.content))
    .flatMap((message) => message.content)
    .map((item) => item?.text)
    .filter(
      (text) =>
        typeof text === "string" &&
        text.includes("<skills_instructions>") &&
        text.includes("</skills_instructions>")
    );

  if (catalogs.length !== 1) {
    throw new AgentError(`expected one Codex skill catalog, found ${catalogs.length}`, 1);
  }

  const lines = catalogs[0].split(/\r?\n/);
  const discovered = [];
  for (const skill of required) {
    const matches = lines.filter((line) => line.startsWith(`- ${skill}:`));
    if (matches.length !== 1) {
      throw new AgentError(`expected one discovered ${skill} skill, found ${matches.length}`, 1);
    }
    const expectedPath = normalizedPath(join(root, ".agents", "skills", skill, "SKILL.md"));
    if (!matches[0].endsWith(`(file: ${expectedPath})`)) {
      throw new AgentError(`${skill} resolved outside the repository skill bundle`, 1);
    }
    discovered.push({ name: skill, path: expectedPath });
  }
  return { ok: true, discovered };
}

function main() {
  const args = parseArgs();
  if (!args.input) throw new AgentError("missing --input", 2);
  const document = JSON.parse(readFileSync(resolve(String(args.input)), "utf8"));
  finish(verifyCodexSkillDiscovery(document), Boolean(args.json));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    fail(error, Boolean(parseArgs().json));
  }
}
