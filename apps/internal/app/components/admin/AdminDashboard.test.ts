import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readSource = (relativePath: string) =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8");

test("admin logo reveals sparkles after five clicks", () => {
  const source = readSource("./AdminDashboard.tsx");

  assert.match(source, /const \[logoClicks, setLogoClicks\] = useState\(0\);/);
  assert.match(source, /if \(next < 5\) return next;/);
  assert.match(source, /setSparklesVisible\(true\);/);
  assert.match(source, /sparklesVisible \? <MiniConfetti key=\{sparklesKey\} \/> : null/);
});
