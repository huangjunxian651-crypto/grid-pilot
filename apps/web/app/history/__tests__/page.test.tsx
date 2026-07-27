import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const useEventsMock = vi.fn();

vi.mock("@/lib/hooks/useBots", () => ({
  useRobots: () => ({
    data: [
      { id: "r1", symbol: "ETH/USDT", direction: "LONG", status: "RUNNING", exchangeId: "binance", accountLabel: "demo", boxCount: 1, realizedPnl: 100, totalFees: 100, activeBoxId: null, activeSessionCode: null, managed: true, latestPrice: 2500, activeBoxHighPrice: null, activeBoxLowPrice: null, lastPositionQty: null, lastEntryPrice: null, lastUnrealizedPnl: null, lastSnapshotAt: null, createdAt: "2026-06-01T00:00:00Z", endedAt: null },
    ],
  }),
  useArchivedRobots: () => ({ data: [] }),
  useEvents: (params: unknown) => useEventsMock(params),
}));

vi.mock("@/lib/referral", async () => {
  const actual = await vi.importActual<typeof import("@/lib/referral")>("@/lib/referral");
  return { ...actual, isReferralMuted: () => false };
});

vi.mock("@/lib/i18n-context", () => ({
  useLang: () => ({ t: (k: string, params?: Record<string, unknown>) => (params ? `${k}:${JSON.stringify(params)}` : k), lang: "zh" }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/history",
}));

vi.mock("@/hooks/useMediaQuery", () => ({
  useIsMobile: () => false,
  useIsTablet: () => false,
}));

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

import TradeHistoryPage from "../page";

function wrap(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
}

function makeEvent(overrides: Partial<{ id: string; route: string | null; accountLabel: string | null; symbol: string; createdAt: string; eventData: Record<string, unknown> }> = {}) {
  return {
    id: overrides.id ?? "fl-1",
    eventType: "FILL",
    eventData: {
      side: "BUY", fillQty: 0.05, fillPrice: 2500, gridIndex: 3, fee: 0.01, savings: 0.5, realizedPnlDelta: 1,
      orderId: "ex-1", clientOrderId: "c-1",
      ...overrides.eventData,
    },
    createdAt: overrides.createdAt ?? new Date().toISOString(),
    symbol: overrides.symbol ?? "ETH/USDT",
    direction: "LONG",
    route: overrides.route === undefined ? "POC" : overrides.route,
    accountLabel: overrides.accountLabel === undefined ? "demo" : overrides.accountLabel,
  };
}

describe("TradeHistoryPage", () => {
  beforeEach(() => {
    useEventsMock.mockReset();
    useEventsMock.mockReturnValue({ data: { data: [makeEvent()], total: 1, limit: 50, offset: 0 } });
  });

  it("renders fill rows with fee, gridIndex, savings, route", async () => {
    render(wrap(<TradeHistoryPage />));
    await waitFor(() => expect(screen.getByText("ETH/USDT")).toBeTruthy());
    const row = within(screen.getByTestId("hist-row"));
    expect(row.getByText("POC")).toBeTruthy();
    expect(row.getByText("$0.0100")).toBeTruthy();
    expect(row.getByText("$0.5000")).toBeTruthy();
    expect(row.getByText("G3")).toBeTruthy();
  });

  it("KPI 瓦片读后端 aggregates(全量过滤结果)，而不是对当前页 fills 做 reduce", async () => {
    useEventsMock.mockReturnValue({
      data: {
        data: [makeEvent({ eventData: { fee: 0.01, savings: 0.5, realizedPnlDelta: 1 } })], // 当前页只 1 条
        total: 300,
        limit: 50,
        offset: 0,
        aggregates: { totalFee: 88.8, totalSavings: 66.6, totalRealizedPnl: 44.4, makerCount: 120, gtcCount: 80, unknownRouteCount: 100 },
      },
    });
    render(wrap(<TradeHistoryPage />));
    await waitFor(() => expect(screen.getByTestId("kpi-fees")).toBeTruthy());
    expect(within(screen.getByTestId("kpi-fees")).getByText("$88.80")).toBeTruthy();
    expect(within(screen.getByTestId("kpi-alpha")).getByText("$66.60")).toBeTruthy();
    expect(within(screen.getByTestId("kpi-realized-pnl")).getByText("+$44.40")).toBeTruthy();
    expect(within(screen.getByTestId("kpi-maker-fills")).getByText("120")).toBeTruthy();
    expect(within(screen.getByTestId("kpi-gtc")).getByText("80")).toBeTruthy();
  });

  it("route 为 null 时显示未知徽章，不再谎报成 POC", async () => {
    useEventsMock.mockReturnValue({ data: { data: [makeEvent({ route: null })], total: 1, limit: 50, offset: 0 } });
    render(wrap(<TradeHistoryPage />));
    await waitFor(() => expect(screen.getByTestId("hist-row")).toBeTruthy());
    const row = within(screen.getByTestId("hist-row"));
    expect(row.getByText("hist.route_unknown")).toBeTruthy();
    expect(row.queryByText("POC")).toBeNull();
  });

  it("搜索框防抖 300ms 后把 search 传给 useEvents", async () => {
    vi.useFakeTimers();
    render(wrap(<TradeHistoryPage />));
    fireEvent.change(screen.getByTestId("hist-search-input"), { target: { value: "BTC" } });

    vi.advanceTimersByTime(300);
    await vi.runOnlyPendingTimersAsync();

    const lastCall = useEventsMock.mock.calls.at(-1)?.[0];
    expect(lastCall.search).toBe("BTC");
    vi.useRealTimers();
  });

  it("选择机器人后把 robotId 传给 useEvents 并重置到第 1 页", async () => {
    render(wrap(<TradeHistoryPage />));
    fireEvent.click(screen.getByTestId("hist-bot-select-trigger"));
    fireEvent.click(screen.getByTestId("hist-bot-select-option-r1"));
    await waitFor(() => {
      const lastCall = useEventsMock.mock.calls.at(-1)?.[0];
      expect(lastCall.robotId).toBe("r1");
      expect(lastCall.offset).toBe(0);
    });
  });

  it("选择路由下拉后把 route 传给 useEvents", async () => {
    render(wrap(<TradeHistoryPage />));
    fireEvent.change(screen.getByTestId("hist-route-select"), { target: { value: "GTC" } });
    await waitFor(() => {
      const lastCall = useEventsMock.mock.calls.at(-1)?.[0];
      expect(lastCall.route).toBe("GTC");
    });
  });

  it("点击成交额表头切换排序方向并传给 useEvents", async () => {
    render(wrap(<TradeHistoryPage />));
    fireEvent.click(screen.getByTestId("hist-sort-notional"));
    await waitFor(() => {
      const lastCall = useEventsMock.mock.calls.at(-1)?.[0];
      expect(lastCall.sortBy).toBe("notional");
      expect(lastCall.sortDir).toBe("desc");
    });
    fireEvent.click(screen.getByTestId("hist-sort-notional"));
    await waitFor(() => {
      const lastCall = useEventsMock.mock.calls.at(-1)?.[0];
      expect(lastCall.sortDir).toBe("asc");
    });
  });

  it("点击下一页把 offset 往后翻一页", async () => {
    useEventsMock.mockReturnValue({ data: { data: [makeEvent()], total: 120, limit: 50, offset: 0 } });
    render(wrap(<TradeHistoryPage />));
    await waitFor(() => expect(screen.getByTestId("hist-page-next")).toBeTruthy());
    fireEvent.click(screen.getByTestId("hist-page-next"));
    await waitFor(() => {
      const lastCall = useEventsMock.mock.calls.at(-1)?.[0];
      expect(lastCall.offset).toBe(50);
    });
  });

  it("点击一行展开详情，显示订单号/账户；再点一次收起", async () => {
    render(wrap(<TradeHistoryPage />));
    await waitFor(() => expect(screen.getByTestId("hist-row")).toBeTruthy());
    fireEvent.click(screen.getByTestId("hist-row"));
    await waitFor(() => expect(screen.getByTestId("hist-row-detail")).toBeTruthy());
    expect(screen.getByText(/ex-1/)).toBeTruthy();
    fireEvent.click(screen.getByTestId("hist-row"));
    await waitFor(() => expect(screen.queryByTestId("hist-row-detail")).toBeNull());
  });

  it("默认最近 7 天，切到'全部'预设后 since/until 都不传", async () => {
    render(wrap(<TradeHistoryPage />));
    await waitFor(() => expect(screen.getByTestId("hist-range-trigger")).toBeTruthy());
    // 默认应带 since（最近 7 天）
    await waitFor(() => {
      const lastCall = useEventsMock.mock.calls.at(-1)?.[0];
      expect(lastCall.since).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId("hist-range-trigger"));
    fireEvent.click(screen.getByTestId("hist-range-preset-all"));
    await waitFor(() => {
      const lastCall = useEventsMock.mock.calls.at(-1)?.[0];
      expect(lastCall.since).toBeUndefined();
      expect(lastCall.until).toBeUndefined();
    });
  });

  it("shows the rebate nudge inside the fees KPI when rebate > 0", async () => {
    render(wrap(<TradeHistoryPage />));
    await waitFor(() => expect(screen.getByTestId("hist-rebate-nudge")).toBeTruthy());
  });

  it("导出按钮的 href 带上当前过滤条件", async () => {
    render(wrap(<TradeHistoryPage />));
    fireEvent.change(screen.getByTestId("hist-route-select"), { target: { value: "POC" } });
    await waitFor(() => {
      const link = screen.getByTestId("hist-export-csv") as HTMLAnchorElement;
      expect(link.getAttribute("href")).toContain("route=POC");
      expect(link.getAttribute("href")).toContain("/trading-engine/events/export");
    });
  });
});
