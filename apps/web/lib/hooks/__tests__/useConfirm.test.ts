import { describe, it, expect, beforeEach } from "vitest";
import { useConfirmStore } from "../useConfirm";

// 纯 store 逻辑测试，不涉及任何 React 渲染，因此不需要 @testing-library/react 的 act()。

describe("useConfirmStore", () => {
  beforeEach(() => {
    useConfirmStore.setState({ pending: null });
  });

  it("resolves true when resolvePending(true) is called", async () => {
    const promise = useConfirmStore.getState().request({ tier: "simple", title: "t", body: "b" });
    useConfirmStore.getState().resolvePending(true);
    await expect(promise).resolves.toBe(true);
  });

  it("resolves false when resolvePending(false) is called", async () => {
    const promise = useConfirmStore.getState().request({ tier: "simple", title: "t", body: "b" });
    useConfirmStore.getState().resolvePending(false);
    await expect(promise).resolves.toBe(false);
  });

  it("exposes the pending options while awaiting", () => {
    useConfirmStore.getState().request({ tier: "destructive", title: "T", body: "B", confirmWord: "DELETE" });
    const pending = useConfirmStore.getState().pending;
    expect(pending?.title).toBe("T");
    expect(pending?.tier).toBe("destructive");
    expect(pending?.confirmWord).toBe("DELETE");
  });

  it("clears pending after resolvePending", () => {
    useConfirmStore.getState().request({ tier: "simple", title: "t", body: "b" });
    useConfirmStore.getState().resolvePending(true);
    expect(useConfirmStore.getState().pending).toBeNull();
  });

  it("resolvePending on empty pending is a no-op (no throw)", () => {
    expect(() => useConfirmStore.getState().resolvePending(true)).not.toThrow();
  });

  it("a new request supersedes and resolves the previous pending request with false", async () => {
    const first = useConfirmStore.getState().request({ tier: "simple", title: "first", body: "b" });
    const second = useConfirmStore.getState().request({ tier: "simple", title: "second", body: "b" });
    expect(useConfirmStore.getState().pending?.title).toBe("second");
    useConfirmStore.getState().resolvePending(true);
    await expect(first).resolves.toBe(false);
    await expect(second).resolves.toBe(true);
  });
});
