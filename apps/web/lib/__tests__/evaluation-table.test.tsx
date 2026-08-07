import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import type { RobotMetrics, RobotMetricsEntry } from "@/lib/api";

vi.mock("@/lib/i18n-context", () => ({
  useLang: () => ({ t: (k: string) => k, lang: "zh", setLang: () => {} }),
}));

import { RobotMetricsTable } from "../../app/evaluation/_metrics-table";

function makeMetrics(overrides: Partial<RobotMetrics> = {}): RobotMetrics {
  return {
    netPnl: 1234.5, grossProfit: 1300, totalFees: 65.5, feeRateBp: 1.5, feeToGross: 0.05,
    funding: 2.5, alpha: 120.25, alphaRateBp: 1.2, winRate: 0.625, avgPnlPerFill: 3.4567,
    gridCoverage: 0.812, fillCount: 42, fillsPerDay: 6, turnover: 50000,
    netPositionChange: 0.5, maxDrawdown: 87.65, unrealizedPnl: 10, netExposure: 1234.5,
    ...overrides,
  };
}

function makeEntry(overrides: Partial<RobotMetricsEntry> = {}): RobotMetricsEntry {
  return {
    robotId: "r1", exchange: "binance", symbol: "ETH/USDT", runCode: "R1",
    startedAt: "2026-07-01T00:00:00Z", metrics: makeMetrics(),
    dataQuality: { fills: 42, windowCovered: true },
    ...overrides,
  };
}

function renderTable(entry: RobotMetricsEntry, onSelect = vi.fn()) {
  render(<RobotMetricsTable robots={[entry]} selectedId={null} onSelect={onSelect} />);
  return onSelect;
}

describe("RobotMetricsTable", () => {
  it("正常数据行：netPnl > 0 着盈利色，各指标按 fmt 约定格式化", () => {
    renderTable(makeEntry());

    const netPnlCell = screen.getByText("+1,234.50");
    expect((netPnlCell as HTMLElement).style.color).toBe("var(--up)");
    expect(screen.getByText("+120.25")).toBeTruthy(); // alpha
    expect(screen.getByText("62.50%")).toBeTruthy(); // winRate
    expect(screen.getByText("+3.4567")).toBeTruthy(); // avgPnlPerFill（4 位小数）
    expect(screen.getByText("1.50 bp")).toBeTruthy(); // feeRateBp
    expect(screen.getByText("81.2%")).toBeTruthy(); // gridCoverage（1 位小数）
    expect(screen.getByText("87.65")).toBeTruthy(); // maxDrawdown
    expect(screen.getByText("1,235")).toBeTruthy(); // netExposure（0 位小数）
    expect(screen.getByText("Binance")).toBeTruthy();
    // 窗口完整：不出现 partial-window 标注
    expect(screen.queryByText(/partialWindow/)).toBeNull();
  });

  it("netPnl < 0 着亏损色", () => {
    renderTable(makeEntry({ metrics: makeMetrics({ netPnl: -50.25 }) }));
    const cell = screen.getByText("-50.25");
    expect((cell as HTMLElement).style.color).toBe("var(--down)");
  });

  it("空窗口数据行：可空指标为 null 时显示 —，未覆盖窗口时出现 partial-window 标注", () => {
    renderTable(
      makeEntry({
        metrics: makeMetrics({
          avgPnlPerFill: null, gridCoverage: null, maxDrawdown: null, netExposure: null,
        }),
        dataQuality: { fills: 3, windowCovered: false },
      }),
    );

    // 4 个可空指标全部降级为占位符
    expect(screen.getAllByText("—")).toHaveLength(4);
    expect(screen.getByText(/evaluation\.col\.partialWindow/)).toBeTruthy();
    expect(screen.getByText(/3 evaluation\.col\.fills/)).toBeTruthy();
  });

  it("点击行触发 onSelect(robotId)", () => {
    const onSelect = renderTable(makeEntry({ robotId: "r-click" }));
    fireEvent.click(screen.getByText("Binance"));
    expect(onSelect).toHaveBeenCalledWith("r-click");
  });
});
