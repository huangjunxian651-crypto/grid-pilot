import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import type { RobotMetrics, RobotMetricsEntry, StrategyMetricsResponse } from "@/lib/api";

// Shell 是布局边界，mock 掉避免牵连导航/通知等无关依赖
vi.mock("@/components/shell/shell", () => ({
  Shell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/lib/i18n-context", () => ({
  useLang: () => ({ t: (k: string) => k, lang: "zh", setLang: () => {} }),
}));

// 明细/KPI 子组件与本用例无关，mock 为边界
vi.mock("../_kpi-cards", () => ({ MetricsKpiCards: () => null }));
vi.mock("../_metrics-detail", () => ({
  RobotMetricsDetail: ({ entry }: { entry: RobotMetricsEntry | null }) =>
    entry ? <div data-testid="detail">{entry.robotId}</div> : null,
}));

const useStrategyMetricsMock = vi.fn();
const useStrategySeriesMock = vi.fn();
vi.mock("@/lib/hooks/useEvaluation", () => ({
  useStrategyMetrics: (w: unknown) => useStrategyMetricsMock(w),
  useStrategySeries: (id: unknown, w: unknown) => useStrategySeriesMock(id, w),
}));

import EvaluationPage from "../page";

function makeMetrics(): RobotMetrics {
  return {
    netPnl: 10, grossProfit: 12, totalFees: 2, feeRateBp: 1.5, feeToGross: 0.1,
    funding: 0, alpha: 3, alphaRateBp: 0.5, winRate: 0.6, avgPnlPerFill: 1,
    gridCoverage: 0.8, fillCount: 10, fillsPerDay: 2, turnover: 1000,
    netPositionChange: 0, maxDrawdown: 5, unrealizedPnl: 1, netExposure: 100,
  };
}

function makeEntry(robotId: string, exchange = "binance"): RobotMetricsEntry {
  return {
    robotId, exchange, symbol: "ETH/USDT", runCode: "R1",
    startedAt: "2026-07-01T00:00:00Z", metrics: makeMetrics(),
    dataQuality: { fills: 10, windowCovered: true },
  };
}

function makeData(robots: RobotMetricsEntry[]): StrategyMetricsResponse {
  return { window: "24h", generatedAt: "2026-08-01T00:00:00Z", aggregate: makeMetrics(), robots };
}

describe("EvaluationPage 选中机器人消失", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useStrategySeriesMock.mockReturnValue({ data: undefined });
  });

  it("选中的机器人从列表消失后清除 selectedId，series 查询停止轮询", () => {
    useStrategyMetricsMock.mockReturnValue({ data: makeData([makeEntry("r1")]) });
    const { rerender } = render(<EvaluationPage />);

    fireEvent.click(screen.getByText("Binance"));
    expect(screen.getByTestId("detail").textContent).toBe("r1");
    expect(useStrategySeriesMock).toHaveBeenLastCalledWith("r1", "24h");

    // 机器人停止/归档后从 RUNNING 列表消失
    useStrategyMetricsMock.mockReturnValue({ data: makeData([]) });
    rerender(<EvaluationPage />);

    expect(useStrategySeriesMock).toHaveBeenLastCalledWith(null, "24h");
    expect(screen.queryByTestId("detail")).toBeNull();
  });

  it("机器人仍在列表中时保持选中", () => {
    useStrategyMetricsMock.mockReturnValue({ data: makeData([makeEntry("r1"), makeEntry("r2", "okx")]) });
    const { rerender } = render(<EvaluationPage />);

    fireEvent.click(screen.getByText("Binance"));
    expect(useStrategySeriesMock).toHaveBeenLastCalledWith("r1", "24h");

    // 列表刷新但 r1 仍在
    useStrategyMetricsMock.mockReturnValue({ data: makeData([makeEntry("r1")]) });
    rerender(<EvaluationPage />);

    expect(useStrategySeriesMock).toHaveBeenLastCalledWith("r1", "24h");
    expect(screen.getByTestId("detail").textContent).toBe("r1");
  });
});
