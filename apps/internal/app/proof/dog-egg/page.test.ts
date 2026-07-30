import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

test("dog egg proof page stays local-only", () => {
  assert.match(source, /import \{ notFound \} from "next\/navigation";/);
  assert.match(source, /import \{ isLocalProofHost \} from "\.\.\/_proofHost";/);
  assert.match(source, /if \(!isLocalProofHost\(host\)\) \{\s+notFound\(\);\s+\}/s);
});
