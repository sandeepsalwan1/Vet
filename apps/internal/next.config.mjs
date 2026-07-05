import path from "node:path";

const workspaceRoot = path.resolve(import.meta.dirname, "../..");

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@central-vet/agents", "@central-vet/client-request", "@central-vet/db", "@central-vet/notifications"],
  serverExternalPackages: ["@google/adk", "@google/genai"],
  outputFileTracingRoot: workspaceRoot,
  turbopack: {
    root: workspaceRoot
  }
};

export default nextConfig;
