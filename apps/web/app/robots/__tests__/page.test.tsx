import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mockPush = vi.fn();

const { confirmMock, pauseMutateMock, stopMutateMock } = vi.hoisted(() => ({
  confirmMock: vi.fn(),
  pauseMutateMock: vi.fn(),
  stopMutateMock: vi.fn(),
}));

vi.mock("@/lib/hooks/useConfirm", () => ({
  useConfirm: () => confirmMock,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  usePathname: () => "/robots",
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
  useRobots: () => ({
    data: [
      {
        id: "r1",
        symbol: "ETH/USDT",
        direction: "LONG",
        status: "PAUSED",
        activeBoxId: null,
        activeSessionCode: null,
        managed: false,
        latestPrice: null,
        exchangeId: "binance",
        environment: "demo",
        accountLabel: "demo",
        credentialId: "cred-1",
        boxCount: 1,
        realizedPnl: 100,
        totalFees: 0,
        totalFunding: 0,
        netPnl: 100,
        totalPnl: null,
        activeBoxHighPrice: null,
        activeBoxLowPrice: null,
        lastPositionQty: 0.5,
        lastEntryPrice: 2400,
        lastUnrealizedPnl: 50,
        lastSnapshotAt: "2026-06-10T12:00:00Z",
        stopStage: null,
        stopWarning: null,
      },
      {
        id: "r2",
        symbol: "BTC/USDT",
        direction: "SHORT",
        status: "RUNNING",
        activeBoxId: "b1",
        activeSessionCode: "sess-1",
        managed: true,
        latestPrice: 65000,
        exchangeId: "gateio",
        environment: "live",
        accountLabel: "main",
        credentialId: "cred-2",
        boxCount: 2,
        realizedPnl: -20,
        totalFees: 0,
        totalFunding: 0,
        netPnl: -20,
        totalPnl: null,
        activeBoxHighPrice: 70000,
        activeBoxLowPrice: 60000,
        lastPositionQty: null,
        lastEntryPrice: null,
        lastUnrealizedPnl: null,
        lastSnapshotAt: null,
        stopStage: null,
        stopWarning: null,
      },
    ],
  }),
  useArchivedRobots: () => ({
    isLoading: false,
    data: [
      { id: "arch-1", symbol: "SOL/USDT", direction: "LONG", status: "STOPPED",
        activeBoxId: null, activeSessionCode: null, managed: false, latestPrice: null,
        exchangeId: "gateio", accountLabel: "main", credentialId: "cred-9", boxCount: 3,
        realizedPnl: 312.5, totalFees: 0, totalFunding: 0, netPnl: 312.5, totalPnl: null,
        activeBoxHighPrice: null, activeBoxLowPrice: null,
        lastPositionQty: null, lastEntryPrice: null, lastUnrealizedPnl: null, lastSnapshotAt: null,
        stopStage: null, stopWarning: null },
    ],
  }),
  usePauseRobot: () => ({ mutate: pauseMutateMock }),
  useStartRobot: () => ({ mutate: vi.fn() }),
  useStopRobot: () => ({ mutate: stopMutateMock }),
}));

vi.mock("@/lib/i18n-context", () => ({
  useLang: () => ({ t: (k: string) => k, lang: "zh" }),
}));

import RobotsPage from "../page";

function wrap(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
}

describe("RobotsPage", () => {
  beforeEach(() => {
    confirmMock.mockReset();
    pauseMutateMock.mockClear();
    stopMutateMock.mockClear();
  });

  it("shows start button for PAUSED robot", async () => {
    render(wrap(<RobotsPage />));
    await waitFor(() => {
      expect(screen.getByText("robot.action_start")).toBeTruthy();
    });
  });

  it("shows stop button (icon) for RUNNING robot", async () => {
    render(wrap(<RobotsPage />));

    await waitFor(() => {
      expect(screen.getByLabelText("robot.action_stop")).toBeTruthy();
    });
    // 暂停按钮也以图标按钮形式存在
    expect(screen.getByLabelText("robot.action_pause")).toBeTruthy();
  });

  it("下部展示最近归档机器人，含复制按钮与查看全部入口", async () => {
    render(wrap(<RobotsPage />));
    await waitFor(() => expect(screen.getByText("SOL/USDT")).toBeTruthy());
    expect(screen.getByText("common.copy")).toBeTruthy();
    const viewAll = screen.getByText("robot.view_all_archived");
    expect(viewAll.closest("a")?.getAttribute("href")).toBe("/robots/archived");
  });

  it("正式环境机器人显示常驻徽章，模拟环境不显示", async () => {
    render(wrap(<RobotsPage />));
    const badges = await screen.findAllByTestId("robot-live-badge");
    expect(badges).toHaveLength(1);
  });

  it("停止按钮：取消确认时不触发 stopRobot.mutate", async () => {
    confirmMock.mockResolvedValue(false);
    render(wrap(<RobotsPage />));
    const stopButton = await screen.findByLabelText("robot.action_stop");
    fireEvent.click(stopButton);

    await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1));
    expect(stopMutateMock).not.toHaveBeenCalled();
  });

  it("停止按钮：确认后以 closePosition: true 触发 stopRobot.mutate", async () => {
    confirmMock.mockResolvedValue(true);
    render(wrap(<RobotsPage />));
    const stopButton = await screen.findByLabelText("robot.action_stop");
    fireEvent.click(stopButton);

    await waitFor(() => {
      expect(stopMutateMock).toHaveBeenCalledWith(
        { id: "r2", closePosition: true },
        expect.objectContaining({ onSuccess: expect.any(Function) })
      );
    });
  });

  it("暂停按钮：取消确认时不触发 pauseRobot.mutate", async () => {
    confirmMock.mockResolvedValue(false);
    render(wrap(<RobotsPage />));
    const pauseButton = await screen.findByLabelText("robot.action_pause");
    fireEvent.click(pauseButton);

    await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1));
    expect(pauseMutateMock).not.toHaveBeenCalled();
  });

  it("暂停按钮：确认后触发 pauseRobot.mutate", async () => {
    confirmMock.mockResolvedValue(true);
    render(wrap(<RobotsPage />));
    const pauseButton = await screen.findByLabelText("robot.action_pause");
    fireEvent.click(pauseButton);

    await waitFor(() => {
      expect(pauseMutateMock).toHaveBeenCalledWith(
        "r2",
        expect.objectContaining({ onSuccess: expect.any(Function) })
      );
    });
  });
});
