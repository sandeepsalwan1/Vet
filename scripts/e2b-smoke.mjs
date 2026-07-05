#!/usr/bin/env node

const apiKey = process.env.E2B_API_KEY;
if (!apiKey) {
  console.error("E2B_API_KEY missing.");
  process.exit(1);
}

const { Sandbox } = await import("e2b");
const started = performance.now();
const sandbox = await Sandbox.create({
  apiKey,
  timeoutMs: 60_000,
  metadata: { app: "vetagent", run: "smoke" }
});

try {
  const result = await sandbox.commands.run("node -e \"console.log('vetagent-e2b-ok')\"", {
    timeoutMs: 30_000
  });
  const ms = Math.round(performance.now() - started);
  if (result.exitCode !== 0 || !result.stdout.includes("vetagent-e2b-ok")) {
    console.error("E2B smoke command failed.");
    process.exitCode = 1;
  } else {
    console.log(`E2B smoke passed in ${ms}ms`);
  }
} finally {
  await sandbox.kill().catch(() => {});
}
