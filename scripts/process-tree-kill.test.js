import { describe, it, expect, afterEach } from "vitest";
import { spawn } from "node:child_process";
import { readFileSync, existsSync, unlinkSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { killProcessTree } from "./process-tree-kill.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const rootFixture = join(__dirname, "__fixtures__/tree-kill-root.js");

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(predicate, { timeoutMs = 3000, intervalMs = 20 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await predicate()) return;
    if (Date.now() > deadline) throw new Error("waitFor timed out");
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

async function tryListen(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolve(true));
    });
  });
}

describe("scripts/process-tree-kill.js killProcessTree()", () => {
  let infoFilePath;
  let rootChild;

  afterEach(() => {
    if (rootChild && isAlive(rootChild.pid)) {
      try {
        process.kill(rootChild.pid, "SIGKILL");
      } catch {
        // already gone
      }
    }
    if (infoFilePath && existsSync(infoFilePath)) unlinkSync(infoFilePath);
  });

  it("杀掉多层子进程（孙进程）持有的端口，而不仅仅是直接子进程", async () => {
    infoFilePath = join(tmpdir(), `tree-kill-test-${process.pid}-${Date.now()}.json`);

    rootChild = spawn(process.execPath, [rootFixture, infoFilePath], { stdio: "ignore" });

    await waitFor(() => existsSync(infoFilePath));
    const { pid: leafPid, port } = JSON.parse(readFileSync(infoFilePath, "utf8"));

    expect(isAlive(leafPid)).toBe(true);
    expect(await tryListen(port)).toBe(false);

    killProcessTree(rootChild.pid, "SIGTERM");

    await waitFor(() => !isAlive(leafPid));
    await waitFor(async () => tryListen(port), { timeoutMs: 3000 });

    expect(isAlive(leafPid)).toBe(false);
    expect(await tryListen(port)).toBe(true);
  });
});
