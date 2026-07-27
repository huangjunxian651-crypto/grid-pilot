import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

afterEach(() => vi.restoreAllMocks());
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { useRobotFills, useRobotFillsPaged, useReconcileRobot } from "../useBots";
import * as api from "../../api";

function wrap(qc?: QueryClient) {
  const client = qc ?? new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function page(data: api.FillRecord[], nextCursor: string | null) {
  return { data, boxes: {}, summary: {} as any, total: data.length, limit: 50, nextCursor };
}
const mkFill = (id: string): api.FillRecord => ({ id, eventType: "FILL", eventData: { side: "BUY", fillQty: 1, fillPrice: 1 }, seq: 0, createdAt: "2026-06-17T00:00:00Z" });

describe("useRobotFills", () => {
  it("空 id 不发请求", () => {
    const spy = vi.spyOn(api.robotApi, "robotFills");
    renderHook(() => useRobotFills(""), { wrapper: wrap() });
    expect(spy).not.toHaveBeenCalled();
  });

  it("有 id 调 robotApi.robotFills", async () => {
    const spy = vi.spyOn(api.robotApi, "robotFills").mockResolvedValue({ data: [], boxes: {}, summary: {} as any, total: 0, limit: 100 });
    renderHook(() => useRobotFills("robot-1"), { wrapper: wrap() });
    await waitFor(() => expect(spy).toHaveBeenCalledWith("robot-1", 100));
  });
});

describe("useRobotFillsPaged", () => {
  it("空 id 不发请求", () => {
    const spy = vi.spyOn(api.robotApi, "robotFills");
    renderHook(() => useRobotFillsPaged(""), { wrapper: wrap() });
    expect(spy).not.toHaveBeenCalled();
  });

  it("首页带 orderSearch、cursor 为 undefined", async () => {
    const spy = vi.spyOn(api.robotApi, "robotFills").mockResolvedValue(page([mkFill("a")], null));
    renderHook(() => useRobotFillsPaged("robot-1", { orderSearch: "EX1" }), { wrapper: wrap() });
    await waitFor(() => expect(spy).toHaveBeenCalledWith("robot-1", expect.any(Number), { cursor: undefined, orderSearch: "EX1" }));
  });

  it("fetchNextPage 用上一页 nextCursor 作游标", async () => {
    const spy = vi.spyOn(api.robotApi, "robotFills")
      .mockResolvedValueOnce(page([mkFill("a")], "a"))
      .mockResolvedValueOnce(page([mkFill("b")], null));
    const { result } = renderHook(() => useRobotFillsPaged("robot-1"), { wrapper: wrap() });
    await waitFor(() => expect(result.current.hasNextPage).toBe(true));
    result.current.fetchNextPage();
    await waitFor(() => expect(spy).toHaveBeenLastCalledWith("robot-1", expect.any(Number), { cursor: "a", orderSearch: undefined }));
  });
});

describe("useReconcileRobot 成功后应刷新成交列表", () => {
  it("reconcile 成功 → useRobotFillsPaged 与 useRobotFills 都重新拉取（同一 robotId）", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const fillsSpy = vi.spyOn(api.robotApi, "robotFills").mockResolvedValue(page([mkFill("a")], null));
    const reconcileSpy = vi.spyOn(api.robotApi, "reconcile").mockResolvedValue({
      success: true, robotId: "robot-1", newFillsCount: 1, dbPosition: 1, exchangePosition: 1, positionMatches: true,
    });

    const { result: paged } = renderHook(() => useRobotFillsPaged("robot-1"), { wrapper: wrap(qc) });
    const { result: simple } = renderHook(() => useRobotFills("robot-1"), { wrapper: wrap(qc) });
    await waitFor(() => expect(fillsSpy).toHaveBeenCalled());
    const callsBeforeReconcile = fillsSpy.mock.calls.length;

    const { result: reconcile } = renderHook(() => useReconcileRobot(), { wrapper: wrap(qc) });
    await act(async () => {
      await reconcile.current.mutateAsync("robot-1");
    });

    expect(reconcileSpy).toHaveBeenCalledWith("robot-1");
    await waitFor(() => expect(fillsSpy.mock.calls.length).toBeGreaterThan(callsBeforeReconcile));
    void paged;
    void simple;
  });
});
