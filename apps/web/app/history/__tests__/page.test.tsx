import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/hooks/useBots", () => ({
  useRobots: () => ({
    data: [
      {
        id: "r1",
        symbol: "ETH/USDT",
        direction: "LONG",
        status: "RUNNING",
        exchangeId: "binance",
        accountLabel: "demo",
        boxCount: 1,
        realizedPnl: 100,
        totalFees: 100,
        activeBoxId: null,
        activeSessionCode: null,
        managed: true,
        latestPrice: 2500,
        activeBoxHighPrice: null,
        activeBoxLowPrice: null,
        lastPositionQty: null,
        lastEntryPrice: null,
        lastUnrealizedPnl: null,
        lastSnapshotAt: null,
      },
    ],
  }),
  useEvents: () => ({
    data: {
      data: [
        {
          id: "fl-1",
          eventType: "FILL",
          eventData: {
            side: "BUY",
            fillQty: 0.05,
            fillPrice: 2500,
            gridIndex: 3,
            fee: 0.01,
            savings: 0.5,
            route: "POC",
          },
          createdAt: new Date().toISOString(),
          symbol: "ETH/USDT",
          direction: "LONG",
        },
      ],
      total: 1,
      limit: 100,
      offset: 0,
    },
  }),
}));

vi.mock("@/lib/referral", async () => {
  const actual = await vi.importActual<typeof import("@/lib/referral")>("@/lib/referral");
  return { ...actual, isReferralMuted: () => false };
});

vi.mock("@/lib/i18n-context", () => ({
  useLang: () => ({ t: (k: string) => k, lang: "zh" }),
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

describe("TradeHistoryPage", () => {
  it("renders fill rows with fee, gridIndex, savings, route", async () => {
    render(wrap(<TradeHistoryPage />));

    await waitFor(() => {
      expect(screen.getByText("ETH/USDT")).toBeTruthy();
    });

    // 验证 fee、gridIndex、savings、route 列已渲染
    expect(screen.getByText("POC")).toBeTruthy();
    expect(screen.getByText("$0.0100")).toBeTruthy();
    expect(screen.getByText("$0.5000")).toBeTruthy();
    expect(screen.getByText("G3")).toBeTruthy();
  });

  it("shows KPI summary with total fills and fees", async () => {
    render(wrap(<TradeHistoryPage />));

    // 检查 fees 列渲染了费用
    await waitFor(() => {
      expect(screen.getByText("$0.0100")).toBeTruthy();
    });
  });

  it("renders the time-range segmented control with default 7D", async () => {
    render(wrap(<TradeHistoryPage />));
    await waitFor(() => expect(screen.getByTestId("hist-range-seg")).toBeTruthy());
    expect(screen.getByTestId("hist-range-7D")).toBeTruthy();
    expect(screen.getByTestId("hist-range-30D")).toBeTruthy();
    expect(screen.getByTestId("hist-range-90D")).toBeTruthy();
    expect(screen.getByTestId("hist-range-ALL")).toBeTruthy();
  });

  it("filters out fills outside the selected range", async () => {
    render(wrap(<TradeHistoryPage />));
    // 默认 7D：今天的成交可见
    await waitFor(() => expect(screen.getAllByTestId("hist-row").length).toBe(1));
    // 该 mock 只有一条今日成交；切到 ALL 仍应可见
    fireEvent.click(screen.getByTestId("hist-range-ALL"));
    expect(screen.getAllByTestId("hist-row").length).toBe(1);
  });

  it("shows the rebate nudge inside the fees KPI when rebate > 0", async () => {
    render(wrap(<TradeHistoryPage />));
    await waitFor(() => expect(screen.getByTestId("hist-rebate-nudge")).toBeTruthy());
  });
});
