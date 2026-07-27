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
const { killProcessTree } = require("./process-tree-kill");
const { waitForPort } = require("./wait-for-port");

const rootDir = path.resolve(__dirname, "..");

function run(name, command, args, options = {}, spawnFn = spawn) {
  const { onSpawn, ...spawnOptions } = options;
  return new Promise((resolve, reject) => {
    const child = spawnFn(command, args, { stdio: "inherit", shell: true, env: process.env, ...spawnOptions });
    onSpawn?.(child);
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code === 0 || code === null) {
        resolve(code);
      } else {
        reject(new Error(`${name} exited with code ${code}${signal ? ` (signal ${signal})` : ""}`));
      }
    });
  });
}

// API/WEB 各自直接以自己的目录为 cwd 调用 `pnpm dev`——不再通过 concurrently 拼接
// "cd apps/x && pnpm dev" 这种复合字符串。spawn 在 shell:true 下只会把 args 数组原样
// 拼接、不逐个转义（Node 自身的 DEP0190 警告就是在说这个），拼接出的字符串里的 && 会被
// /bin/sh 当成真正的命令分隔符解释，导致两个子命令的参数互相错位、必现失败。
async function startDev({ skipInfra = false, spawnFn = spawn, waitForPortFn = waitForPort } = {}) {
  if (!skipInfra) {
    console.log("[INFRA] Starting docker compose...");
    await run("INFRA", "docker", ["compose", "up", "-d"], { cwd: rootDir }, spawnFn);
    console.log("[INFRA] Docker services started.");
  }

  console.log("[DEV] Starting API and Web...");
  const children = new Set();
  const onSpawn = (child) => {
    children.add(child);
    child.once("exit", () => children.delete(child));
  };
  // 直接子进程是 `pnpm dev`，真正占用端口的是它几层之后派生的孙进程
  // （pnpm -> nest CLI -> dist/main）。只 kill 直接子进程依赖每一层都正确
  // 转发信号；哪一层慢了（比如 nest 正在文件监听重启）就会把孙进程漏掉，
  // 留下孤儿占着端口。所以这里把子进程的整棵进程树都杀掉，不依赖逐层转发。
  const killTree = (child, signal) => {
    child.kill(signal);
    killProcessTree(child.pid, signal);
  };
  const onSigint = () => {
    for (const child of children) killTree(child, "SIGINT");
  };
  process.on("SIGINT", onSigint);

  try {
    // Web 先于 API 就绪时，浏览器会立刻打到 /api/* 的 rewrite 代理上，
    // 而 Nest 启动（编译+建连）比 Next dev 慢得多，中间那段时间全是
    // ECONNREFUSED。这里让 API 先起、等它真正 accept 连接了，再起 Web，
    // 从根上消灭这个窗口。
    const apiPromise = run("API", "pnpm", ["dev"], { cwd: path.join(rootDir, "apps/api"), onSpawn }, spawnFn);

    const apiPort = Number(process.env.API_PORT ?? process.env.PORT ?? 3301);
    console.log(`[DEV] Waiting for API to accept connections on 127.0.0.1:${apiPort}...`);
    await Promise.race([apiPromise, waitForPortFn("127.0.0.1", apiPort)]);
    console.log("[DEV] API is up, starting Web...");

    const webPromise = run("WEB", "pnpm", ["dev"], { cwd: path.join(rootDir, "apps/web"), onSpawn }, spawnFn);

    await Promise.all([apiPromise, webPromise]);
  } finally {
    // 任一方失败/整体退出时，把还活着的另一方也收掉，不留孤儿进程。
    process.off("SIGINT", onSigint);
    for (const child of children) killTree(child, "SIGTERM");
  }
}

module.exports = { run, startDev };

if (require.main === module) {
  require("dotenv").config({ path: path.join(rootDir, ".env") });
  startDev({ skipInfra: process.argv.includes("--skip-infra") }).catch((err) => {
    console.error(`[DEV] ${err.message}`);
    process.exit(1);
  });
}
