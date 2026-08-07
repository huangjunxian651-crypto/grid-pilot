import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mockPush = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  usePathname: () => "/robots/archived",
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

vi.mock("@/lib/hooks/useBots", () => ({
  useRobots: () => ({ data: [] }),
  useArchivedRobots: () => ({
    isLoading: false,
    data: [
      {
        id: "a1", symbol: "ETH/USDT", direction: "LONG", status: "STOPPED",
        activeBoxId: null, activeSessionCode: null, managed: false, latestPrice: null,
        exchangeId: "binance", accountLabel: "demo", boxCount: 1, realizedPnl: 100,
        totalFees: 0, totalFunding: 0, netPnl: 100, totalPnl: null,
        activeBoxHighPrice: null, activeBoxLowPrice: null,
        lastPositionQty: 0.5, lastEntryPrice: 2400, lastUnrealizedPnl: 50,
        lastSnapshotAt: "2026-06-10T12:00:00Z",
        credentialId: "cred-1",
        stopStage: null, stopWarning: null,
      },
    ],
  }),
}));

vi.mock("@/lib/i18n-context", () => ({
  useLang: () => ({ t: (k: string) => k, lang: "zh" }),
}));

import ArchivedRobotsPage from "../page";

function wrap(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
}

describe("ArchivedRobotsPage", () => {
  it("renders the archived robot symbol", async () => {
    render(wrap(<ArchivedRobotsPage />));
    await waitFor(() => {
      expect(screen.getByText("ETH/USDT")).toBeTruthy();
    });
  });

  it("shows stop-snapshot summary for archived robot", async () => {
    render(wrap(<ArchivedRobotsPage />));
    await waitFor(() => {
      // t() mock returns keys; verify the i18n key is rendered (interpolation tested via i18n-coverage)
      expect(screen.getByText(/robot\.stopped_position/)).toBeTruthy();
    });
  });

  it("has no action buttons (read-only view)", async () => {
    render(wrap(<ArchivedRobotsPage />));
    await waitFor(() => {
      expect(screen.getByText("ETH/USDT")).toBeTruthy();
    });
    expect(screen.queryByText("启动")).toBeNull();
    expect(screen.queryByText("停止")).toBeNull();
    expect(screen.queryByText("暂停")).toBeNull();
    expect(screen.queryByText("重启")).toBeNull();
  });

  it("每个归档机器人卡片含复制按钮", async () => {
    render(wrap(<ArchivedRobotsPage />));
    await waitFor(() => expect(screen.getByText("ETH/USDT")).toBeTruthy());
    expect(screen.getByText("common.copy")).toBeTruthy();
  });
});
