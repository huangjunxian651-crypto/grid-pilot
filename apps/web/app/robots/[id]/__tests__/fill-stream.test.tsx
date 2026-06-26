import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import * as useBots from "@/lib/hooks/useBots";
import { FillStream } from "../_monitor";
import type { FillRecord } from "@/lib/api";

vi.mock("@/lib/hooks/useBots");

const t = (k: string) => k;

function rec(id: string, over: Partial<FillRecord["eventData"]> = {}): FillRecord {
  return {
    id,
    eventType: "FILL",
    eventData: { side: "BUY", fillQty: 1, fillPrice: 2500, orderId: "EX" + id, clientOrderId: "C" + id, gridIndex: 3, fee: 0.01, ...over },
    seq: 0,
    createdAt: "2026-06-17T00:00:00Z",
  };
}

function mockPaged(over: Record<string, unknown> = {}) {
  (useBots.useRobotFillsPaged as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    data: { pages: [{ data: [], boxes: {}, summary: {}, total: 0, limit: 50, nextCursor: null }] },
    fetchNextPage: vi.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
    isLoading: false,
    ...over,
  });
}

beforeEach(() => vi.clearAllMocks());

describe("FillStream", () => {
  it("渲染分页成交行", () => {
    mockPaged({ data: { pages: [{ data: [rec("1"), rec("2")], boxes: {}, nextCursor: null }] } });
    render(<FillStream robotId="r1" wsFills={[]} t={t} lang={"zh" as never} />);
    expect(screen.getByTestId("fill-row-1")).toBeTruthy();
    expect(screen.getByTestId("fill-row-2")).toBeTruthy();
  });

  it("空态显示占位", () => {
    mockPaged();
    render(<FillStream robotId="r1" wsFills={[]} t={t} lang={"zh" as never} />);
    expect(screen.queryByTestId(/^fill-row-/)).toBeNull();
  });

  it("点击行弹详情, 含 orderId 与 clientOrderId", () => {
    mockPaged({ data: { pages: [{ data: [rec("1")], boxes: {}, nextCursor: null }] } });
    render(<FillStream robotId="r1" wsFills={[]} t={t} lang={"zh" as never} />);
    fireEvent.click(screen.getByTestId("fill-row-1"));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("EX1")).toBeTruthy();
    expect(screen.getByText("C1")).toBeTruthy();
  });

  it("搜索输入按 orderSearch 走服务端过滤", () => {
    const spy = useBots.useRobotFillsPaged as unknown as ReturnType<typeof vi.fn>;
    mockPaged();
    render(<FillStream robotId="r1" wsFills={[]} t={t} lang={"zh" as never} />);
    fireEvent.change(screen.getByTestId("fill-search"), { target: { value: "EX9" } });
    expect(spy).toHaveBeenLastCalledWith("r1", { orderSearch: "EX9" });
  });

  it("WS 新成交插顶(非搜索态), 与历史并存", () => {
    mockPaged({ data: { pages: [{ data: [rec("1")], boxes: {}, nextCursor: null }] } });
    render(
      <FillStream
        robotId="r1"
        wsFills={[{ id: "w1", side: "sell", price: 2600, qty: 2, gridIndex: 5, route: "GTC", fee: 0, ts: 1718000000000 }]}
        t={t}
        lang={"zh" as never}
      />,
    );
    expect(screen.getByTestId("fill-row-w1")).toBeTruthy();
    expect(screen.getByTestId("fill-row-1")).toBeTruthy();
  });
});
