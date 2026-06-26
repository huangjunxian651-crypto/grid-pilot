import { describe, it, expect, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import React from "react";

vi.mock("@/lib/i18n-context", () => ({
  useLang: () => ({ t: (k: string) => k, lang: "zh", setLang: () => {} }),
}));

const emptyEvents = { price: 0, fsm: "", fills: [], lastFill: null, orderPlaced: null, orderCancelled: null, liveStatus: null as Record<string, unknown> | null, connected: true };
const mockState = { events: { ...emptyEvents } };
vi.mock("@/lib/hooks/useBotEvents", () => ({ useBotEvents: () => mockState.events }));

vi.mock("@tanstack/react-query", async (orig) => ({
  ...(await orig<typeof import("@tanstack/react-query")>()),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("@/lib/hooks/useBots", async (orig) => ({
  ...(await orig<typeof import("@/lib/hooks/useBots")>()),
  useRobotFills: () => ({
    data: {
      data: [{
        id: "hf1", createdAt: new Date(2000).toISOString(), boxId: "b1",
        eventData: { side: "BUY", fillQty: 0.01, fillPrice: 2500, gridIndex: 3, fee: 0.012, feeAsset: "USDT", savings: 0.5, savingsRate: 0.0075, avgGridPrice: 1812 },
        seq: 1, eventType: "FILL",
      }],
      boxes: { b1: { id: "b1", direction: "LONG", takeProfitPrice: 2800, mainGridCount: 235, mainGridStep: 2.5, stopLossGridCount: 4, stopLossGridStep: 2.5, isolationStep: 2.5 } },
      summary: { todayRealizedPnl: 0.5, alphaTotal: 0.5 },
      total: 1, limit: 100,
    },
  }),
  useRobotFillsPaged: () => ({
    data: { pages: [{ data: [{ id: "hf1", createdAt: new Date(2000).toISOString(), boxId: "b1", eventData: { side: "BUY", fillQty: 0.01, fillPrice: 2500, gridIndex: 3, fee: 0.012, feeAsset: "USDT", savings: 0.5, savingsRate: 0.0075 }, seq: 1, eventType: "FILL" }], boxes: { b1: { id: "b1", direction: "LONG", takeProfitPrice: 2800, mainGridCount: 235, mainGridStep: 2.5, stopLossGridCount: 4, stopLossGridStep: 2.5, isolationStep: 2.5 } }, nextCursor: null }] },
    fetchNextPage: () => {}, hasNextPage: false, isFetchingNextPage: false, isLoading: false,
  }),
}));

vi.mock("@/components/charts/grid-ladder", () => ({ GridLadder: () => <div data-testid="grid-ladder" /> }));

import { MonitorPanel } from "../_monitor";
import { type RobotDetail } from "@/lib/api";

function makeRobot(over: Partial<RobotDetail> = {}): RobotDetail {
  return { id: "robot-1", symbol: "ETH/USDT", direction: "LONG", status: "RUNNING", activeBoxId: "b1", activeSessionCode: "ETHUSDT_1", managed: true, latestPrice: 2500, exchangeId: "binance", accountLabel: "demo", credentialId: "cred1", boxCount: 1, realizedPnl: 0, totalFees: 0, totalFunding: 0, netPnl: 0, totalPnl: null, activeBoxHighPrice: null, activeBoxLowPrice: null, lastPositionQty: null, lastUnrealizedPnl: null, lastSnapshotAt: null, stopStage: null, stopWarning: null, boxes: [{ id: "b1", direction: "LONG", takeProfitPrice: 2800, mainGridCount: 235, mainGridStep: 2.5, mainGridPortionSize: 0.001, leverage: 10, stopLossGridCount: 4, stopLossGridStep: 2.5, isolationStep: 2.5, activationPrice: 2700, trailingEntry: false, trailingCallbackRate: 0.0002, excessProfitMultiplier: 2, reorderThreshold: 0.02, enabled: true }], ...(over as any) } as unknown as RobotDetail;
}

describe("MonitorPanel 成交流成本/超额利润", () => {
  it("逐笔渲染手续费、超额利润与箱体标签，去除 route 徽标", async () => {
    mockState.events = { ...emptyEvents, fsm: "RUNNING", price: 2500 };
    await act(async () => { render(<MonitorPanel robot={makeRobot()} />); });
    expect(screen.getByText("bot.fill_fee")).toBeTruthy();
    expect(screen.getByText("bot.fill_savings")).toBeTruthy();
    expect(screen.getByText(/2800/)).toBeTruthy();    // 箱体标签含止盈价
    expect(screen.queryByText("POC")).toBeNull();      // route 徽标移除
  });

  it("成交流滚动区限高可滚动（maxHeight + overflow auto），不随内容无限撑高", async () => {
    mockState.events = { ...emptyEvents, fsm: "RUNNING", price: 2500 };
    await act(async () => { render(<MonitorPanel robot={makeRobot()} />); });
    const scroll = screen.getByTestId("fill-stream-scroll") as HTMLElement;
    expect(scroll.style.overflow).toBe("auto");
    expect(scroll.style.maxHeight).not.toBe("");
  });

  // 控制面板重设计 spec：reorders/gridCycles 恒 0 时不渲染「本会话」改单/循环噪音行。
  // 守住 showActivity 守卫——若被移除而让恒 0 行渲染，本测试即失败。
  it("RUNNING 头部在无本会话活动（reorders/gridCycles=0）时不渲染改单/循环噪音行", async () => {
    mockState.events = { ...emptyEvents, fsm: "RUNNING", price: 2500 };
    await act(async () => { render(<MonitorPanel robot={makeRobot()} />); });
    expect(screen.queryByText("common.this_session")).toBeNull();
    expect(screen.queryByText("kpi.reorders")).toBeNull();
  });

  it('成交流首格展示平均网格价（替代挂单价）', async () => {
    mockState.events = { ...emptyEvents, fsm: "RUNNING", price: 2500 };
    await act(async () => { render(<MonitorPanel robot={makeRobot()} />); });
    expect(screen.getByText("bot.avg_grid_price")).toBeTruthy();
    expect(screen.queryByText("bot.order_price")).toBeNull();
  });
});
