import { describe, it, expect, vi } from "vitest";
import { render, screen, act, within } from "@testing-library/react";
import React from "react";

// ---- mock i18n（t 直接回显 key，便于断言） ----
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

import { MonitorPanel, LINEAR_FSM_STATES } from "../_monitor";
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

const robot = {
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
} as unknown as RobotDetail;

async function renderWithFsm(fsm: string) {
  mockState.events = { ...emptyEvents, price: 1734, fsm };
  await act(async () => {
    render(<MonitorPanel robot={robot} />);
  });
}

// FSM 卡片容器：以唯一的「fsm.state」标题为锚（顶部头部状态徽标不含此标题），
// 把断言限定在时间线卡片内——避免与新增的头部 FsmPill 状态徽标产生 getByText 多匹配。
function fsmCard() {
  return screen.getByText("fsm.state").parentElement as HTMLElement;
}

describe("FsmTimeline 分支态展示（P1-1）", () => {
  it.each(["PAUSED", "HOLD", "CANCELLED", "TAKE_PROFIT"] as const)(
    "分支态 %s：主生命线 4 状态全部渲染，且分支态在主线对应位置高亮标注",
    async (branchState) => {
      await renderWithFsm(branchState);
      const card = within(fsmCard());
      for (const state of LINEAR_FSM_STATES) {
        expect(card.getByText(`fsm.${state}`)).toBeTruthy();
      }
      expect(card.getByText(`fsm.${branchState}`)).toBeTruthy();
      // 挂靠展示时不应再出现「不在主生命线上」的脱线提示
      expect(screen.queryByText("fsm.branch_note")).toBeNull();
    },
  );

  it("线性主状态 RUNNING：仅渲染主生命线，无分支标注", async () => {
    await renderWithFsm("RUNNING");
    const card = within(fsmCard());
    for (const state of LINEAR_FSM_STATES) {
      expect(card.getByText(`fsm.${state}`)).toBeTruthy();
    }
    expect(card.queryByText("fsm.PAUSED")).toBeNull();
    expect(screen.queryByText("fsm.branch_note")).toBeNull();
  });

  it("未知/遗留态 SLEEPING：回退为独立徽标 + 脱线提示，不渲染全灰主线", async () => {
    await renderWithFsm("SLEEPING");
    const card = within(fsmCard());
    expect(card.getByText("fsm.SLEEPING")).toBeTruthy();
    expect(card.getByText("fsm.branch_note")).toBeTruthy();
  });
});

describe("FSM 状态从 REST 播种（刷新已运行机器人）", () => {
  it("WS fsm 为空时，用 robot.activeFsmState 播种主生命线，不出现脱线提示", async () => {
    mockState.events = { ...emptyEvents, price: 1734, fsm: "" };
    const robotWithState = { ...robot, activeFsmState: "RUNNING" } as unknown as RobotDetail;
    await act(async () => {
      render(<MonitorPanel robot={robotWithState} />);
    });
    const card = within(fsmCard());
    for (const state of LINEAR_FSM_STATES) {
      expect(card.getByText(`fsm.${state}`)).toBeTruthy();
    }
    expect(screen.queryByText("fsm.branch_note")).toBeNull();
  });

  it("WS fsm 非空时优先于 activeFsmState 播种值", async () => {
    // 播种值是脱线态 SLEEPING，但 WS 实时为线性 RUNNING → 应以 WS 为准，无脱线提示
    mockState.events = { ...emptyEvents, price: 1734, fsm: "RUNNING" };
    const robotWithState = { ...robot, activeFsmState: "SLEEPING" } as unknown as RobotDetail;
    await act(async () => {
      render(<MonitorPanel robot={robotWithState} />);
    });
    expect(screen.queryByText("fsm.branch_note")).toBeNull();
  });
});
