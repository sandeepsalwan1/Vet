#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const label = "com.central-vet.opensrc-sync";
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const syncScript = join(repoRoot, "scripts", "opensrc-sync.mjs");

function xml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function launchAgentPlist({ nodePath, root, scriptPath, logPath }) {
  const executablePath = dirname(nodePath);
  const path = `${executablePath}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(nodePath)}</string>
    <string>${xml(scriptPath)}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${xml(root)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${xml(path)}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>StartInterval</key>
  <integer>86400</integer>
  <key>ThrottleInterval</key>
  <integer>600</integer>
  <key>StandardOutPath</key>
  <string>${xml(logPath)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(logPath)}</string>
</dict>
</plist>
`;
}

function main() {
  if (process.platform !== "darwin") {
    throw new Error("launch agent installation requires macOS");
  }
  if (process.argv.length > 2) throw new Error(`unknown option ${process.argv[2]}`);

  const library = join(homedir(), "Library");
  const launchAgents = join(library, "LaunchAgents");
  const logs = join(library, "Logs");
  const plistPath = join(launchAgents, `${label}.plist`);
  const logPath = join(logs, "central-vet-opensrc-sync.log");
  mkdirSync(launchAgents, { recursive: true });
  mkdirSync(logs, { recursive: true });

  const content = launchAgentPlist({
    nodePath: process.execPath,
    root: repoRoot,
    scriptPath: syncScript,
    logPath
  });
  let existing = "";
  try {
    existing = readFileSync(plistPath, "utf8");
  } catch {
    // First install.
  }
  if (existing !== content) writeFileSync(plistPath, content, "utf8");
  chmodSync(plistPath, 0o644);

  const domain = `gui/${process.getuid()}`;
  const service = `${domain}/${label}`;
  const loaded = spawnSync("/bin/launchctl", ["print", service], {
    stdio: "ignore"
  }).status === 0;
  if (loaded) {
    execFileSync("/bin/launchctl", ["bootout", domain, plistPath], {
      stdio: "ignore"
    });
  }
  execFileSync("/bin/launchctl", ["bootstrap", domain, plistPath], {
    stdio: "ignore"
  });
  console.log(`opensrc: daily sync installed; log ${logPath}`);
}

const invokedPath = process.argv[1] ? fileURLToPath(import.meta.url) === process.argv[1] : false;
if (invokedPath) {
  try {
    main();
  } catch (error) {
    console.error(`opensrc: ${error.message}`);
    process.exit(1);
  }
}
