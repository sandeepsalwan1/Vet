import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./ChatPanel.tsx", import.meta.url), "utf8");

test("chat panel contains the hidden dog trigger and brief display", () => {
  assert.match(source, /DOG_EGG_PHRASE = "i need a dog image now"/);
  assert.match(source, /normalizeDogEggInput\(trimmed\) === DOG_EGG_PHRASE/);
  assert.match(source, /chatDogEgg/);
  assert.match(source, /DOG_EGG_VISIBLE_MS = 1600/);
});
