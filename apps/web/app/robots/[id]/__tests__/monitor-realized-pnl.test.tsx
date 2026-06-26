import { describe, it, expect, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import React from "react";

// ---- mock i18n（t 直接回显 key，便于断言） ----
vi.mock("@/lib/i18n-context", () => ({
  useLang: () => ({ t: (k: string) => k, lang: "zh", setLang: () => {} }),
}));

// ---- 可变 mock 状态 ----
const emptyEvents = {
  price: 0,
  fsm: "",
  fills: [],
  lastFill: null,
  orderPlaced: null,
  orderCancelled: null,
  liveStatus: null as Record<string, unknown> | null,
  connected: true,
};
const mockState = { events: { ...emptyEvents } };

vi.mock("@/lib/hooks/useBotEvents", () => ({
  useBotEvents: () => mockState.events,
}));

vi.mock("@tanstack/react-query", async (orig) => ({
  ...(await orig<typeof import("@tanstack/react-query")>()),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("@/lib/hooks/useBots", async (orig) => ({
  ...(await orig<typeof import("@/lib/hooks/useBots")>()),
  useRobotFills: () => ({ data: { data: [], boxes: {}, summary: { todayRealizedPnl: 0, alphaTotal: 0 }, total: 0, limit: 100 } }),
  useRobotFillsPaged: () => ({ data: { pages: [{ data: [], boxes: {}, nextCursor: null }] }, fetchNextPage: () => {}, hasNextPage: false, isFetchingNextPage: false, isLoading: false }),
}));

// GridLadder 依赖 canvas，jsdom 不支持
vi.mock("@/components/charts/grid-ladder", () => ({
  GridLadder: () => <div data-testid="grid-ladder" />,
}));

import { MonitorPanel } from "../_monitor";
import { type RobotDetail } from "@/lib/api";

const box = {
  id: "b1",
  direction: "LONG",
  takeProfitPrice: 2500,
  mainGridCount: 60,
  mainGridStep: 10,
  mainGridPortionSize: 0.05,
  leverage: 20,
  stopLossGridCount: 9,
  stopLossGridStep: 5,
  activationPrice: 2300,
  trailingEntry: false,
  trailingCallbackRate: 0.002,
  excessProfitMultiplier: 2,
  reorderThreshold: 0.02,
  enabled: true,
};

function makeRobot(overrides: Partial<RobotDetail> = {}): RobotDetail {
  return {
    id: "r1",
    symbol: "ETH/USDT",
    direction: "LONG",
    status: "RUNNING",
    activeBoxId: "b1",
    activeSessionCode: "ETHUSDT_1",
    managed: true,
    latestPrice: 1700,
    exchangeId: "binance",
    accountLabel: "demo",
    credentialId: "cred1",
    boxCount: 1,
    realizedPnl: 0,
    totalFees: 0,
    totalFunding: 0,
    netPnl: 0,
    totalPnl: null,
    activeBoxHighPrice: null,
    activeBoxLowPrice: null,
    lastPositionQty: null,
    lastUnrealizedPnl: null,
    lastSnapshotAt: null,
    stopStage: null,
    stopWarning: null,
    boxes: [box],
    ...overrides,
  } as unknown as RobotDetail;
}

async function renderMonitor(robot: RobotDetail) {
  await act(async () => {
    render(<MonitorPanel robot={robot} />);
  });
}

describe("MonitorPanel 已实现盈亏（P0-1/P0-2/P2-4）", () => {
  it("活跃态 KPI 与持仓面板均显示 robot.realizedPnl（API 聚合值），而非 WS 当前 run 值", async () => {
    mockState.events = {
      ...emptyEvents,
      price: 1734,
      fsm: "RUNNING",
      liveStatus: {
        positionQty: 0.1,
        entryPrice: 1700,
        unrealizedPnl: 1,
        leverage: 20,
        marginType: "CROSS",
        realizedPnl: -45.82, // 仅当前 run 的值（错误数据源）
      },
    };
    await renderMonitor(makeRobot({ realizedPnl: 123.45 }));
    // KPI + 持仓面板两处均使用聚合值
    expect(screen.getAllByText("+$123.45").length).toBeGreaterThanOrEqual(2);
    // 当前 run 值不应作为已实现盈亏出现
    expect(screen.queryByText(/45\.82/)).toBeNull();
  });

  it("活跃态负值不出现 +$- 拼接，且 tone 为 down（var(--down)）", async () => {
    mockState.events = {
      ...emptyEvents,
      price: 1734,
      fsm: "RUNNING",
      liveStatus: {
        positionQty: 0.1,
        entryPrice: 1700,
        unrealizedPnl: 1,
        leverage: 20,
        marginType: "CROSS",
        realizedPnl: 10,
      },
    };
    await renderMonitor(makeRobot({ realizedPnl: -45.82 }));
    expect(screen.queryByText("+$-45.82")).toBeNull();
    const values = screen.getAllByText("$-45.82");
    expect(values.length).toBeGreaterThanOrEqual(2);
    for (const el of values) {
      expect((el as HTMLElement).style.color).toBe("var(--down)");
    }
  });

  it("空态 KPI 已实现盈亏负值时 tone 为 down 而非硬编码 up", async () => {
    mockState.events = { ...emptyEvents };
    await renderMonitor(makeRobot({ activeBoxId: null, activeSessionCode: null, realizedPnl: -45.82 }));
    const value = screen.getByText("$-45.82");
    expect((value as HTMLElement).style.color).toBe("var(--down)");
  });

  it("空态 KPI 已实现盈亏正值显示 +$ 前缀且 tone 为 up", async () => {
    mockState.events = { ...emptyEvents };
    await renderMonitor(makeRobot({ activeBoxId: null, activeSessionCode: null, realizedPnl: 123.45 }));
    const value = screen.getByText("+$123.45");
    expect((value as HTMLElement).style.color).toBe("var(--up)");
  });
});
