#!/usr/bin/env node
/**
 * Unified development startup script.
 * Loads root .env, starts docker infrastructure, then starts API and Web.
 *
 * Usage:
 *   node scripts/start-dev.js
 *   node scripts/start-dev.js --skip-infra    (skip docker compose)
 */
const { spawn } = require("child_process");
const path = require("path");

// Load root .env so all child processes inherit the same configuration.
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const skipInfra = process.argv.includes("--skip-infra");

function run(name, command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      shell: true,
      env: process.env,
      ...options,
    });
    child.on("close", (code) => {
      if (code === 0 || code === null) {
        resolve(code);
      } else {
        reject(new Error(`${name} exited with code ${code}`));
      }
    });
  });
}

async function main() {
  if (!skipInfra) {
    console.log("[INFRA] Starting docker compose...");
    await run("INFRA", "docker", ["compose", "up", "-d"], { cwd: path.resolve(__dirname, "..") });
    console.log("[INFRA] Docker services started.");
  }

  // Start API and Web in parallel using concurrently if available,
  // otherwise fall back to spawning both.
  try {
    const concurrentlyPath = require.resolve("concurrently");
    console.log("[DEV] Starting API and Web (using concurrently)...");
    await run("DEV", "concurrently", [
      "-n", "API,WEB",
      "-c", "cyan,green",
      "cd apps/api && pnpm dev",
      "cd apps/web && pnpm dev",
    ], { cwd: path.resolve(__dirname, "..") });
  } catch {
    console.log("[DEV] concurrently not found, spawning processes manually...");
    const api = spawn("pnpm", ["dev"], { cwd: path.resolve(__dirname, "../apps/api"), stdio: "inherit", shell: true, env: process.env });
    const web = spawn("pnpm", ["dev"], { cwd: path.resolve(__dirname, "../apps/web"), stdio: "inherit", shell: true, env: process.env });

    process.on("SIGINT", () => {
      api.kill("SIGINT");
      web.kill("SIGINT");
      process.exit(0);
    });
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
