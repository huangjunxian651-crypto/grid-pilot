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
  useRobotFills: () => ({ data: { data: [], boxes: {}, summary: { totalSavings: 0, totalSavingsRate: 0, fillCount: 0, buySavings: 0, sellSavings: 0, buyCount: 0, sellCount: 0, fills: [] }, total: 0, limit: 100 } }),
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

describe("MonitorPanel 停止态渲染（阶段进度 + 快照缺失/错误码告警）", () => {
  it("shows stage sub-label while STOPPING", async () => {
    mockState.events = { ...emptyEvents };
    await renderMonitor(makeRobot({ status: "STOPPING", stopStage: "CLOSING_POSITION", activeSessionCode: null, activeBoxId: null }));
    expect(screen.getByText("bot.stop_stage.closing_position")).toBeTruthy();
  });

  it("does NOT show snapshot warning when lastSnapshotAt is present", async () => {
    mockState.events = { ...emptyEvents };
    await renderMonitor(makeRobot({ status: "STOPPED", lastSnapshotAt: "2026-06-13T00:00:00Z", lastPositionQty: 2, stopWarning: null, activeSessionCode: null, activeBoxId: null }));
    expect(screen.queryByText("bot.snapshot_stale")).toBeNull();
  });

  it("shows snapshot warning only when lastSnapshotAt is null", async () => {
    mockState.events = { ...emptyEvents };
    await renderMonitor(makeRobot({ status: "STOPPED", lastSnapshotAt: null, stopWarning: "SNAPSHOT_UNAVAILABLE", activeSessionCode: null, activeBoxId: null }));
    // SNAPSHOT_UNAVAILABLE 用专门的 warning 文案表达"未取到快照"
    expect(screen.getByText("bot.stop_warning.snapshot_unavailable")).toBeTruthy();
  });

  it("shows residual-position warning from stopWarning code", async () => {
    mockState.events = { ...emptyEvents };
    await renderMonitor(makeRobot({ status: "STOPPED", lastSnapshotAt: "2026-06-13T00:00:00Z", stopWarning: "RESIDUAL_POSITION", activeSessionCode: null, activeBoxId: null }));
    expect(screen.getByText("bot.stop_warning.residual_position")).toBeTruthy();
  });
});
