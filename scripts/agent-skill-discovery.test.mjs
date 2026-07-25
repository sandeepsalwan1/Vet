import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";

import {
  REQUIRED_CRABBOX_SKILLS,
  verifyCodexSkillDiscovery
} from "./agent-skill-discovery.mjs";

const root = "/workspace";

function catalog(skills = REQUIRED_CRABBOX_SKILLS, base = root) {
  const lines = skills.map(
    (skill) => `- ${skill}: description (file: ${join(base, ".agents", "skills", skill, "SKILL.md")})`
  );
  return `<skills_instructions>\n### Available skills\n${lines.join("\n")}\n</skills_instructions>`;
}

function document(skillCatalog, prompt = "skill discovery probe") {
  return [
    {
      role: "developer",
      content: [{ type: "input_text", text: skillCatalog }]
    },
    {
      role: "user",
      content: [{ type: "input_text", text: prompt }]
    }
  ];
}

test("skill discovery verifies every exact repository skill path", () => {
  const result = verifyCodexSkillDiscovery(document(catalog()), root);

  assert.equal(result.ok, true);
  assert.deepEqual(
    result.discovered.map((item) => item.name),
    REQUIRED_CRABBOX_SKILLS
  );
});

test("skill names in the user prompt cannot fake discovery", () => {
  assert.throws(
    () => verifyCodexSkillDiscovery(document(catalog([]), REQUIRED_CRABBOX_SKILLS.join(" ")), root),
    /expected one discovered vet-worker skill/
  );
});

test("skill discovery rejects a global or host-local copy", () => {
  assert.throws(
    () => verifyCodexSkillDiscovery(document(catalog(REQUIRED_CRABBOX_SKILLS, "/other")), root),
    /resolved outside the repository skill bundle/
  );
});

test("skill discovery requires exactly one developer catalog", () => {
  assert.throws(
    () => verifyCodexSkillDiscovery([{ role: "user", content: [{ text: catalog() }] }], root),
    /expected one Codex skill catalog/
  );
});
