import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

test("staff tasks route renders the shared staff app root", () => {
  assert.match(source, /import \{ AppRoot \} from "\.\.\/\.\.\/components\/AppRoot";/);
  assert.match(source, /return <AppRoot audience="staff" \/>;/);
});
