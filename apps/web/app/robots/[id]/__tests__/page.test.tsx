import { describe, it, expect, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import React, { Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ---- mock next/navigation ----
vi.mock("next/navigation", () => ({
  usePathname: () => "/robots/r1",
  useRouter: () => ({ push: vi.fn() }),
}));

// ---- mock i18n ----
vi.mock("@/lib/i18n-context", () => ({
  useLang: () => ({ t: (k: string) => k, lang: "zh", setLang: () => {} }),
  I18nProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// ---- mock auth / notifications / profile (required by Shell) ----
vi.mock("@/lib/hooks/useAuth", () => ({
  useAuth: () => ({ data: { id: "u1", email: "test@test.com", displayName: "Test", language: "zh" } }),
  useLogout: () => ({ mutate: vi.fn() }),
}));

vi.mock("@/lib/hooks/useNotifications", () => ({
  useNotifications: () => ({ unreadCount: 0, notifications: [], prefs: {}, togglePref: () => {} }),
}));

vi.mock("@/lib/hooks/useProfile", () => ({
  useUpdateProfile: () => ({ mutate: () => {} }),
}));

vi.mock("@/hooks/useMediaQuery", () => ({
  useIsMobile: () => false,
  useIsTablet: () => false,
}));

// ---- 可变 mock 状态:每个用例设置 robot / events 以切换显示态 ----
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
  realizedPnl: 12.5,
  totalSavings: 3.2,
};
const baseRobot = {
  id: "r1",
  symbol: "ETH/USDT",
  direction: "LONG",
  status: "RUNNING",
  activeBoxId: null as string | null,
  activeSessionCode: null as string | null,
  managed: true,
  latestPrice: 1700,
  exchangeId: "binance",
  accountLabel: "demo",
  credentialId: "cred1",
  boxCount: 1,
  realizedPnl: 0.5,
  totalFees: 0,
  totalFunding: 0,
  netPnl: 0.5,
  totalPnl: null as number | null,
  activeBoxHighPrice: null as number | null,
  activeBoxLowPrice: null as number | null,
  lastPositionQty: null as number | null,
  lastUnrealizedPnl: null as number | null,
  lastSnapshotAt: null as string | null,
  stopStage: null as string | null,
  stopWarning: null as string | null,
  boxes: [box],
};
const emptyEvents = {
  price: 0,
  fsm: "",
  fills: [],
  lastFill: null,
  orderPlaced: null,
  orderCancelled: null,
  liveStatus: null,
};
const mockState: { robot: typeof baseRobot; events: typeof emptyEvents } = {
  robot: { ...baseRobot },
  events: { ...emptyEvents },
};

// ---- mock useBots hooks ----
vi.mock("@/lib/hooks/useBots", async (orig) => ({
  ...(await orig<typeof import("@/lib/hooks/useBots")>()),
  useRobot: () => ({ data: mockState.robot, isLoading: false }),
  usePauseRobot: () => ({ mutate: vi.fn() }),
  useStartRobot: () => ({ mutate: vi.fn() }),
  useStopRobot: () => ({ mutate: vi.fn() }),
  useAddBox: () => ({ mutate: vi.fn() }),
  useRemoveBox: () => ({ mutate: vi.fn() }),
  useEditBox: () => ({ mutate: vi.fn() }),
  useRobotFills: () => ({ data: { data: [], boxes: {}, summary: { todayRealizedPnl: 0, alphaTotal: 0 }, total: 0, limit: 100 } }),
  useRunningBots: () => ({ data: [] }),
}));

vi.mock("@/lib/hooks/useBotEvents", () => ({
  useBotEvents: () => mockState.events,
}));

// mock components that need canvas/WebGL
vi.mock("@/components/charts/grid-ladder", () => ({
  GridLadder: () => <div data-testid="grid-ladder" />,
}));

import RobotDetailPage from "../page";

function wrap(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
}

async function renderPage() {
  await act(async () => {
    render(
      wrap(
        <Suspense fallback={<div>loading</div>}>
          <RobotDetailPage params={Promise.resolve({ id: "r1" })} />
        </Suspense>,
      ),
    );
  });
}

describe("RobotDetailPage", () => {
  it("无活跃箱时显示监控空态文案,不渲染网格面板", async () => {
    mockState.robot = { ...baseRobot, activeBoxId: null, activeSessionCode: null };
    mockState.events = { ...emptyEvents };
    await renderPage();
    expect(await screen.findByText("robot.monitor_waiting")).toBeTruthy();
    // 空态不渲染 GridLadder
    expect(screen.queryByTestId("grid-ladder")).toBeNull();
  });

  it("详情页头部显示交易所(LOGO + 名称)", async () => {
    mockState.robot = { ...baseRobot, activeBoxId: null, activeSessionCode: null };
    mockState.events = { ...emptyEvents };
    await renderPage();
    const ex = await screen.findByTestId("robot-exchange");
    expect(ex.textContent).toMatch(/Binance/);
  });

  it("有活跃箱时渲染监控面板(GridLadder)与箱体管理", async () => {
    mockState.robot = { ...baseRobot, activeBoxId: "b1", activeSessionCode: "ETHUSDT_1" };
    mockState.events = { ...emptyEvents, price: 1734, fsm: "RUNNING" };
    await renderPage();
    // 活跃态渲染 V1 三栏的 GridLadder(mock 为 testid)
    expect(await screen.findByTestId("grid-ladder")).toBeTruthy();
    // 箱体管理区标题仍在
    expect(screen.getByText("robot.boxes_title")).toBeTruthy();
    // 不应显示监控空态文案
    expect(screen.queryByText("robot.monitor_waiting")).toBeNull();
  });

  it("箱卡片有编辑按钮,点击打开预填编辑弹窗", async () => {
    mockState.robot = { ...baseRobot, activeBoxId: null, activeSessionCode: null };
    mockState.events = { ...emptyEvents };
    await renderPage();
    const editBtn = await screen.findByTestId("edit-box-btn");
    expect(editBtn).toBeTruthy();
    await act(async () => { editBtn.click(); });
    expect(screen.getByText("robot.edit_box")).toBeTruthy();
  });

  it("打开新增箱体弹窗显示结构预览容器与激活价字段", async () => {
    mockState.robot = { ...baseRobot, activeBoxId: null, activeSessionCode: null };
    mockState.events = { ...emptyEvents };
    await renderPage();
    const addBtn = await screen.findByTestId("add-box-btn");
    await act(async () => { addBtn.click(); });
    expect(screen.getByTestId("box-anatomy-preview")).toBeTruthy();
    // 弹窗字段标签（区别于箱体卡片新增的「激活价」stat 单元）
    expect(screen.getByText("robot.field_activation")).toBeTruthy();
  });

  it("归档(STOPPED)机器人详情页只读：不显示加/改/删箱体控件，但仍展示历史箱体", async () => {
    mockState.robot = { ...baseRobot, status: "STOPPED", activeBoxId: null, activeSessionCode: null };
    mockState.events = { ...emptyEvents };
    await renderPage();
    // 历史箱体区仍在
    expect(await screen.findByText("robot.boxes_title")).toBeTruthy();
    // 写操作控件隐藏
    expect(screen.queryByTestId("add-box-btn")).toBeNull();
    expect(screen.queryByTestId("edit-box-btn")).toBeNull();
    expect(screen.queryByTestId("remove-box-btn")).toBeNull();
  });

  it("箱体卡片盈亏领衔、配置压成一行（箱版 A），并逐项保留术语帮助", async () => {
    mockState.robot = { ...baseRobot };  // activeBoxId 为 null → 待命箱
    mockState.events = { ...emptyEvents };
    await renderPage();
    // 配置压成一行可读文本，不再 8 个独立 stat 格
    expect(screen.queryAllByTestId("box-stat").length).toBe(0);
    const cfg = screen.getByTestId("box-config");
    expect(cfg.textContent).toContain("robot.cfg_take_profit");
    expect(cfg.textContent).toContain("robot.cfg_portion");
    expect(cfg.textContent).toContain("robot.cfg_leverage");
    expect(cfg.textContent).toContain("0.05"); // box.mainGridPortionSize
    // 盈亏领衔：大号盈亏 + 已实现/超额 分解；待命箱（非活跃）不显示未实现
    // FIX I1+I2: 非活跃箱显示 net_pnl 标签（而非 total_pnl），语义更准确（已实现−手续费−资金费）
    expect(screen.getByText("kpi.net_pnl")).toBeTruthy();
    expect(screen.queryByText("kpi.total_pnl")).toBeNull();
    expect(screen.getByText("robot.pnl_realized")).toBeTruthy();
    expect(screen.getByText("robot.pnl_savings")).toBeTruthy();
    expect(screen.queryByText("robot.pnl_unrealized")).toBeNull();
    expect(screen.getAllByTestId("box-pnl").length).toBe(3);
    // TermHelp 接入验证：配置 8 项术语帮助齐全
    expect(screen.getByTestId("term-help-takeProfit")).toBeTruthy();
    expect(screen.getByTestId("term-help-leverage")).toBeTruthy();
    expect(screen.getByTestId("term-help-mainGrid")).toBeTruthy();
    expect(screen.getByTestId("term-help-portionSize")).toBeTruthy();
    expect(screen.getByTestId("term-help-stopLoss")).toBeTruthy();
    expect(screen.getByTestId("term-help-isolation")).toBeTruthy();
    expect(screen.getByTestId("term-help-activation")).toBeTruthy();
    expect(screen.getByTestId("term-help-trailingEntry")).toBeTruthy();
    // FIX I1+I2: 非活跃箱使用 netPnl 术语帮助（替换原 totalPnl）
    expect(screen.getByTestId("term-help-netPnl")).toBeTruthy();
    expect(screen.queryByTestId("term-help-totalPnl")).toBeNull();
    expect(screen.getByTestId("term-help-savings")).toBeTruthy();
    expect(screen.getAllByTestId("term-help-realizedPnl").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByTestId("term-help-unrealizedPnl").length).toBeGreaterThanOrEqual(1);
  });
});
