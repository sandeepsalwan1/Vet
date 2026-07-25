import assert from "node:assert/strict";
import test from "node:test";

import { launchAgentPlist } from "./install-opensrc-sync.mjs";

test("builds a daily launch agent without credentials", () => {
  const plist = launchAgentPlist({
    nodePath: "/opt/node & tools/bin/node",
    root: "/Users/test/Vet",
    scriptPath: "/Users/test/Vet/scripts/opensrc-sync.mjs",
    logPath: "/Users/test/Library/Logs/opensrc.log"
  });

  assert.match(plist, /<integer>86400<\/integer>/);
  assert.match(plist, /\/opt\/node &amp; tools\/bin\/node/);
  assert.doesNotMatch(plist, /TOKEN|credential|secret/i);
});
