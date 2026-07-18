#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

process.stdout.on("error", (error) => {
  if (error?.code === "EPIPE") process.exit(0);
  throw error;
});

const args = new Set(process.argv.slice(2));
const unknownArgs = [...args].filter((arg) => arg !== "--check");
if (unknownArgs.length > 0) {
  console.error(`docs:list: unknown option ${unknownArgs.join(", ")}`);
  process.exit(2);
}

const check = args.has("--check");
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const docsDir = join(repoRoot, "docs");
const excludedDirectories = new Set(["archive", "research"]);

if (!existsSync(docsDir) || !statSync(docsDir).isDirectory()) {
  console.error("docs:list: missing docs directory");
  process.exit(1);
}

function walkMarkdownFiles(directory) {
  const files = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;

    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!excludedDirectories.has(entry.name)) {
        files.push(...walkMarkdownFiles(fullPath));
      }
      continue;
    }

    if (
      entry.isFile() &&
      entry.name !== "AGENTS.md" &&
      /\.(md|mdx)$/i.test(entry.name)
    ) {
      files.push(fullPath);
    }
  }

  return files.toSorted((left, right) => left.localeCompare(right));
}

function unquote(value) {
  const trimmed = value.trim();
  const first = trimmed.at(0);
  if ((first === '"' || first === "'") && trimmed.at(-1) === first) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function parseInlineList(value) {
  const trimmed = value.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return null;

  return trimmed
    .slice(1, -1)
    .split(",")
    .map(unquote)
    .filter(Boolean);
}

function readMetadata(fullPath) {
  const content = readFileSync(fullPath, "utf8").replaceAll("\r\n", "\n");
  if (!content.startsWith("---\n")) {
    return { error: "missing front matter" };
  }

  const end = content.indexOf("\n---\n", 4);
  if (end === -1) {
    return { error: "unterminated front matter" };
  }

  const lines = content.slice(4, end).split("\n");
  let summary = "";
  let collectingReadWhen = false;
  let sawReadWhen = false;
  const readWhen = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.startsWith("summary:")) {
      summary = unquote(line.slice("summary:".length));
      collectingReadWhen = false;
      continue;
    }

    if (line.startsWith("read_when:")) {
      sawReadWhen = true;
      collectingReadWhen = true;
      const inline = parseInlineList(line.slice("read_when:".length));
      if (inline) readWhen.push(...inline);
      continue;
    }

    if (collectingReadWhen) {
      if (line.startsWith("- ")) {
        const hint = unquote(line.slice(2));
        if (hint) readWhen.push(hint);
      } else if (line !== "") {
        collectingReadWhen = false;
      }
    }
  }

  if (!summary) return { error: "summary is missing or empty" };
  if (sawReadWhen && readWhen.length === 0) {
    return { error: "read_when is empty" };
  }

  return { summary, readWhen };
}

const failures = [];
for (const fullPath of walkMarkdownFiles(docsDir)) {
  const path = relative(docsDir, fullPath);
  const metadata = readMetadata(fullPath);
  if (metadata.error) {
    failures.push(`${path}: ${metadata.error}`);
    console.log(`${path} - [${metadata.error}]`);
    continue;
  }

  console.log(`${path} - ${metadata.summary}`);
  if (metadata.readWhen.length > 0) {
    console.log(`  Read when: ${metadata.readWhen.join("; ")}`);
  }
}

if (failures.length > 0) {
  console.error(`docs:list: ${failures.length} metadata error(s)`);
  if (check) process.exit(1);
}
