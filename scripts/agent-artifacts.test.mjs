import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

test("artifact uploads explicitly include generated files under hidden directories", () => {
  const workflowsDir = join(process.cwd(), ".github/workflows");

  for (const filename of readdirSync(workflowsDir).filter((name) => name.endsWith(".yml"))) {
    const lines = readFileSync(join(workflowsDir, filename), "utf8").split("\n");

    for (let index = 0; index < lines.length; index += 1) {
      const match = lines[index].match(/^(\s*)- uses: actions\/upload-artifact@v4$/);
      if (!match) continue;

      const indent = match[1];
      let end = index + 1;
      while (end < lines.length && !lines[end].startsWith(`${indent}- `)) end += 1;
      const step = lines.slice(index, end).join("\n");

      if (step.includes(".agent-output")) {
        assert.match(step, /^\s*include-hidden-files: true$/m, `${filename}:${index + 1}`);
      }
    }
  }
});
