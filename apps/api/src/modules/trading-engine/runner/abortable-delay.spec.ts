import { describe, it, expect } from "vitest";
import { getEventListeners } from "events";
import { abortableDelay } from "./abortable-delay";

describe("abortableDelay", () => {
  it("resolves after the timeout elapses", async () => {
    const ctrl = new AbortController();
    const start = Date.now();
    await abortableDelay(20, ctrl.signal);
    expect(Date.now() - start).toBeGreaterThanOrEqual(15);
  });

  it("resolves promptly when the signal is aborted before the timeout", async () => {
    const ctrl = new AbortController();
    const start = Date.now();
    const p = abortableDelay(10_000, ctrl.signal);
    ctrl.abort();
    await p;
    expect(Date.now() - start).toBeLessThan(1000);
  });

  it("resolves immediately if the signal is already aborted", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(abortableDelay(10_000, ctrl.signal)).resolves.toBeUndefined();
  });

  // 泄漏防护：正常超时结束后绝不能在 signal 上残留 'abort' 监听器。
  // 旧实现用 { once:true } 注册却未在超时路径 removeEventListener，长生命周期的
  // AbortController 会随每次退避累积监听器（EventTarget 泄漏）。
  it("leaves no abort listener after the timeout path resolves", async () => {
    const ctrl = new AbortController();
    await abortableDelay(5, ctrl.signal);
    expect(getEventListeners(ctrl.signal, "abort").length).toBe(0);
  });

  it("leaves no abort listener after the abort path resolves", async () => {
    const ctrl = new AbortController();
    const p = abortableDelay(10_000, ctrl.signal);
    ctrl.abort();
    await p;
    expect(getEventListeners(ctrl.signal, "abort").length).toBe(0);
  });
});
