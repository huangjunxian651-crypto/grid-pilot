import { describe, it, expect, vi } from "vitest";
import { startDev } from "./start-dev.js";

function makeChild() {
  const handlers = {};
  const register = (event, cb) => {
    handlers[event] = cb;
  };
  return {
    on: vi.fn(register),
    once: vi.fn(register),
    kill: vi.fn(),
    __emit: (event, ...args) => handlers[event]?.(...args),
  };
}

function makeSpawnFn() {
  const children = [];
  const calls = [];
  const spawnFn = vi.fn((command, args, options) => {
    calls.push({ command, args, options });
    const child = makeChild();
    children.push(child);
    return child;
  });
  return { spawnFn, calls, children };
}

// API 端口就绪检查默认已经通过 waitForPortFn 拆出来，这里用一个立即 resolve
// 的桩替换掉真实的 TCP 探测，测试其余编排逻辑时不需要真的监听端口。
const resolvedWaitForPortFn = vi.fn(async () => {});

describe("scripts/start-dev.js startDev()", () => {
  it("API/WEB 各自以自己的目录为 cwd 直接调用 `pnpm dev`，不把多条命令拼接进单个 shell 参数字符串", async () => {
    const { spawnFn, calls, children } = makeSpawnFn();

    const donePromise = startDev({ skipInfra: true, spawnFn, waitForPortFn: resolvedWaitForPortFn });
    await vi.waitFor(() => expect(children.length).toBe(2));

    for (const { args } of calls) {
      for (const a of args ?? []) {
        expect(String(a)).not.toMatch(/&&/);
      }
    }

    const apiCall = calls.find((c) => c.options?.cwd?.includes("apps/api"));
    const webCall = calls.find((c) => c.options?.cwd?.includes("apps/web"));
    expect(apiCall).toBeTruthy();
    expect(webCall).toBeTruthy();
    expect(apiCall.command).toBe("pnpm");
    expect(apiCall.args).toEqual(["dev"]);
    expect(webCall.command).toBe("pnpm");
    expect(webCall.args).toEqual(["dev"]);

    for (const child of children) child.__emit("close", 0, null);
    await donePromise;
  });

  it("任一子进程异常退出时，startDev 返回的 Promise 必须 reject（不能静默挂起、不退出）", async () => {
    const { spawnFn, children } = makeSpawnFn();

    const donePromise = startDev({ skipInfra: true, spawnFn, waitForPortFn: resolvedWaitForPortFn });
    await vi.waitFor(() => expect(children.length).toBe(2));

    children[0].__emit("close", 1, null);

    await expect(donePromise).rejects.toThrow(/exited with code 1/);

    children[1].__emit("close", 0, null);
  });

  it("一方崩溃时会把另一方也杀掉，不留孤儿进程", async () => {
    const { spawnFn, children } = makeSpawnFn();

    const donePromise = startDev({ skipInfra: true, spawnFn, waitForPortFn: resolvedWaitForPortFn });
    await vi.waitFor(() => expect(children.length).toBe(2));

    children[0].__emit("close", 1, null);
    await expect(donePromise).rejects.toThrow();

    expect(children[1].kill).toHaveBeenCalled();
  });

  it("必须等 API 端口就绪后才启动 WEB，不能两者同时起（避免浏览器打到还没起来的 API 上）", async () => {
    const { spawnFn, calls, children } = makeSpawnFn();

    let releaseApiReady;
    const apiReady = new Promise((resolve) => (releaseApiReady = resolve));
    const waitForPortFn = vi.fn(() => apiReady);

    const donePromise = startDev({ skipInfra: true, spawnFn, waitForPortFn });

    await vi.waitFor(() => expect(children.length).toBe(1));
    expect(calls[0].options?.cwd).toMatch(/apps\/api$/);
    expect(waitForPortFn).toHaveBeenCalledWith("127.0.0.1", expect.any(Number));

    // API 端口还没就绪的这段时间里，WEB 不应该被启动。
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(children.length).toBe(1);

    releaseApiReady();
    await vi.waitFor(() => expect(children.length).toBe(2));
    expect(calls[1].options?.cwd).toMatch(/apps\/web$/);

    for (const child of children) child.__emit("close", 0, null);
    await donePromise;
  });
});
