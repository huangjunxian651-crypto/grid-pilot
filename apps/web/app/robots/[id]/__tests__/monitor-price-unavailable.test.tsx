import { describe, it, expect, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import React from "react";

vi.mock("@/lib/i18n-context", () => ({
  useLang: () => ({ t: (k: string) => k, lang: "zh", setLang: () => {} }),
}));

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

vi.mock("@/components/charts/grid-ladder", () => ({
  GridLadder: () => <div data-testid="grid-ladder" />,
}));

import { MonitorPanel } from "../_monitor";
import { type RobotDetail } from "@/lib/api";

// LONG TP2500 60格×$10：箱体几何中点固定可算（之前 bug 会把它当标记价展示）
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

function makeRobot(overrides: Record<string, unknown> = {}): RobotDetail {
  return {
    id: "r1",
    symbol: "ETH/USDT",
    direction: "LONG",
    status: "RUNNING",
    activeBoxId: "b1",
    activeSessionCode: "ETHUSDT_1",
    managed: true,
    latestPrice: null,
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

describe("MonitorPanel 标记价无行情回退（不得用箱体几何中点冒充）", () => {
  it("WS 无价且 REST 无 latestPrice 时，标记价显示 — 而非几何中点", async () => {
    mockState.events = { ...emptyEvents, price: 0, fsm: "RUNNING" };
    await renderMonitor(makeRobot({ latestPrice: null }));

    const kpiLabel = screen.getByText("kpi.mark");
    const kpiBlock = kpiLabel.closest("div")?.parentElement as HTMLElement;
    expect(kpiBlock.textContent).toContain("—");
    // 不得出现任何由箱体几何衍生的"价格"数字
    expect(kpiBlock.textContent).not.toMatch(/\d{3,}/);
  });

  it("WS 无价但 REST 有 latestPrice 时，标记价回退显示 latestPrice", async () => {
    mockState.events = { ...emptyEvents, price: 0, fsm: "RUNNING" };
    await renderMonitor(makeRobot({ latestPrice: 1700.5 }));

    const kpiLabel = screen.getByText("kpi.mark");
    const kpiBlock = kpiLabel.closest("div")?.parentElement as HTMLElement;
    expect(kpiBlock.textContent).toMatch(/1,?700\.50?/);
  });

  it("WS 有价时正常显示 WS 价", async () => {
    mockState.events = { ...emptyEvents, price: 1672.5, fsm: "RUNNING" };
    await renderMonitor(makeRobot({ latestPrice: 1700.5 }));

    const kpiLabel = screen.getByText("kpi.mark");
    const kpiBlock = kpiLabel.closest("div")?.parentElement as HTMLElement;
    expect(kpiBlock.textContent).toMatch(/1,?672\.50?/);
  });
});
