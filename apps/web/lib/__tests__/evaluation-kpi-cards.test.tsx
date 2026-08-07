import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import type { RobotMetrics } from "@/lib/api";

vi.mock("@/lib/i18n-context", () => ({
  useLang: () => ({ t: (k: string) => k, lang: "zh", setLang: () => {} }),
}));

import { MetricsKpiCards } from "../../app/evaluation/_kpi-cards";

function makeMetrics(overrides: Partial<RobotMetrics> = {}): RobotMetrics {
  return {
    netPnl: 1234.5, grossProfit: 1300, totalFees: 65.5, feeRateBp: 1.5, feeToGross: 0.05,
    funding: 2.5, alpha: 120.25, alphaRateBp: 1.2, winRate: 0.625, avgPnlPerFill: 3.4567,
    gridCoverage: 0.812, fillCount: 42, fillsPerDay: 6, turnover: 50000,
    netPositionChange: 0.5, maxDrawdown: null, unrealizedPnl: 10, netExposure: 1234.5,
    ...overrides,
  };
}

describe("MetricsKpiCards", () => {
  it("第 5 张卡为费用占毛利比：feeToGross=0.25 时显示 25.0%", () => {
    render(<MetricsKpiCards aggregate={makeMetrics({ feeToGross: 0.25 })} />);
    expect(screen.getByText("evaluation.metric.feeToGross")).toBeTruthy();
    expect(screen.getByText("25.0%")).toBeTruthy();
  });

  it("feeToGross=null 时显示占位符 —", () => {
    render(<MetricsKpiCards aggregate={makeMetrics({ feeToGross: null })} />);
    expect(screen.getByText("—")).toBeTruthy();
  });

  it("不再渲染最大回撤卡（汇总口径 maxDrawdown 恒为 null，是死卡）", () => {
    render(<MetricsKpiCards aggregate={makeMetrics()} />);
    expect(screen.queryByText("evaluation.metric.maxDrawdown")).toBeNull();
  });

  it("费用占毛利比卡带口径 tooltip", () => {
    render(<MetricsKpiCards aggregate={makeMetrics()} />);
    expect(screen.getByText("evaluation.metric.feeToGross").getAttribute("title")).toBe(
      "evaluation.tip.feeToGross",
    );
  });
});
