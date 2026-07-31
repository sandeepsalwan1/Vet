import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readSource = (relativePath: string) =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8");

test("task board chrome reveals a short frog easter egg after five activations", () => {
  const source = readSource("./TaskBoardChrome.tsx");
  const styles = readSource("../globals.css");

  assert.match(source, /function FrogWordmark\(\) \{/);
  assert.match(source, /const \[activationCount, setActivationCount\] = useState\(0\);/);
  assert.match(source, /activationRef\.current === 5|nextCount === 5/);
  assert.match(source, /idleTimerRef\.current = window\.setTimeout\(resetSequence, 1400\);/);
  assert.match(source, /frogEasterEgg--visible/);
  assert.match(styles, /prefers-reduced-motion: reduce/);
});
