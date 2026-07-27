import { describe, it, expect } from "vitest";
import { createServer } from "node:net";
import { waitForPort } from "./wait-for-port.js";

describe("scripts/wait-for-port.js waitForPort()", () => {
  it("在端口还没人监听时不断重试，直到监听器起来后才 resolve（黑盒：不依赖内部实现）", async () => {
    const server = createServer(() => {});
    let listening = false;

    const readyPromise = new Promise((resolve) => {
      // 故意延迟起监听，模拟 API 启动较慢的场景。
      setTimeout(() => {
        server.listen(0, "127.0.0.1", () => {
          listening = true;
          resolve(server.address().port);
        });
      }, 200);
    });

    const port = await readyPromise;
    const waited = waitForPort("127.0.0.1", port, { timeoutMs: 5000, intervalMs: 20 });

    await waited;
    expect(listening).toBe(true);

    await new Promise((resolve) => server.close(resolve));
  });

  it("超时时间内一直连不上就 reject，而不是无限挂起", async () => {
    // 先拿一个刚刚被占用过、随后立刻释放的端口，保证这个端口在测试期间大概率没人监听。
    const freePort = await new Promise((resolve) => {
      const probe = createServer(() => {});
      probe.listen(0, "127.0.0.1", () => {
        const { port } = probe.address();
        probe.close(() => resolve(port));
      });
    });

    await expect(
      waitForPort("127.0.0.1", freePort, { timeoutMs: 300, intervalMs: 20 })
    ).rejects.toThrow();
  });
});
