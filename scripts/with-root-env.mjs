#!/usr/bin/env node
import nextEnv from "@next/env";
import { spawn } from "node:child_process";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
nextEnv.loadEnvConfig(root);

const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error("Usage: node scripts/with-root-env.mjs <command> [...args]");
  process.exit(1);
}

const child = spawn(command, args, {
  env: process.env,
  shell: process.platform === "win32",
  stdio: "inherit"
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
