import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

vi.mock("@/hooks/useMediaQuery", () => ({ useIsMobile: () => false }));

import { GridLadder } from "../charts/grid-ladder";
import { deriveLayout } from "@/lib/store";

// LONG 配置：止盈价=2500（高），清算价=1810（低）
// mainGridDepth=600, isolationEndDepth=645, boxDepth=690（9×5=45 止损深度，2500-690=1810）
const longConfig = {
  takeProfitPrice: 2500,
  direction: "LONG" as const,
  mainGridCount: 60,
  mainGridStep: 10,
  stopLossGridCount: 9,
  stopLossGridStep: 5,
  isolationStep: 45,
  activationPrice: 2200,
};
const longLayout = deriveLayout(longConfig);

// SHORT 配置：止盈价=2000（低），清算价=3000（高）
// mainGridDepth=940, isolationEndDepth=960, boxDepth=1000
const shortConfig = {
  takeProfitPrice: 2000,
  direction: "SHORT" as const,
  mainGridCount: 10,
  mainGridStep: 94,
  stopLossGridCount: 4,
  stopLossGridStep: 10,
  isolationStep: 20,
};
const shortLayout = deriveLayout(shortConfig);

const t = (k: string) => k;

describe("GridLadder 统一组件（layout/price 入参）", () => {
  it("从 layout/price 渲染，含四条语义线价签", () => {
    render(<GridLadder layout={longLayout} price={2000} prediction={null} t={t} />);
    // 止盈线=2500，清算线=1810（2500−690=1810）
    expect(screen.getByText(/2500/)).toBeTruthy();
    expect(screen.getByText(/1810/)).toBeTruthy();
    // 满仓线=2500-600=1900，止损区起点=2500-645=1855
    expect(screen.getByText(/1900/)).toBeTruthy();
  });

  it("现价低于箱体下沿时显示越过清算线标注", () => {
    render(<GridLadder layout={longLayout} price={1000} prediction={null} t={t} />);
    expect(screen.getByText(/越过清算线|↓/)).toBeTruthy();
  });

  it("现价高于箱体上沿时显示越过止盈端标注", () => {
    render(<GridLadder layout={longLayout} price={9999} prediction={null} t={t} />);
    expect(screen.getByText(/越过止盈端|↑/)).toBeTruthy();
  });

  it("结构边界横线 bottom% 与绝对价格线性对应（LONG）", () => {
    render(<GridLadder layout={longLayout} price={2000} prediction={null} t={t} />);
    const totalRange = longLayout.boxHighPrice - longLayout.boxLowPrice; // 690（2500−1810）

    const takeProfitLine = screen.getByTestId("bound-line-takeProfitPrice") as HTMLElement;
    expect(parseFloat(takeProfitLine.style.bottom)).toBeCloseTo(100, 0); // 止盈线在顶

    const liqLine = screen.getByTestId("bound-line-liquidationPrice") as HTMLElement;
    expect(parseFloat(liqLine.style.bottom)).toBeCloseTo(0, 0); // 清算线在底

    const fullLine = screen.getByTestId("bound-line-fullPositionPrice") as HTMLElement;
    // fullPositionPrice = 1900, pct = (1900-1810)/690 = 13.04%（boxLowPrice=1810，totalRange=690）
    expect(parseFloat(fullLine.style.bottom)).toBeCloseTo(13.04, 1);
  });

  it("SHORT 配置：止盈线绝对价格低于清算线（止盈在底，清算在顶）", () => {
    render(<GridLadder layout={shortLayout} price={2500} prediction={null} t={t} />);
    // SHORT: takeProfitPrice=2000（低端），liquidationPrice=3000（高端）
    const takeProfitLine = screen.getByTestId("bound-line-takeProfitPrice") as HTMLElement;
    const liqLine = screen.getByTestId("bound-line-liquidationPrice") as HTMLElement;
    // 止盈线在底（pct≈0），清算线在顶（pct≈100）
    expect(parseFloat(takeProfitLine.style.bottom)).toBeCloseTo(0, 0);
    expect(parseFloat(liqLine.style.bottom)).toBeCloseTo(100, 0);
    // 止盈价 < 清算价：确认 SHORT 几何正确
    expect(shortLayout.takeProfitPrice).toBeLessThan(shortLayout.liquidationPrice);
  });

  it("SHORT 配置：价签碰撞算法不堆叠——止盈线标签低于清算线标签且相邻标签间距 >= LABEL_GAP", () => {
    render(<GridLadder layout={shortLayout} price={2500} prediction={null} t={t} />);
    // 止盈线（pct≈0）的标签应在底部，清算线（pct≈100）的标签应在顶部
    const takeProfitLabel = screen.getByTestId("bound-label-takeProfitPrice") as HTMLElement;
    const liqLabel = screen.getByTestId("bound-label-liquidationPrice") as HTMLElement;
    const takeProfitLabelBottom = parseFloat(takeProfitLabel.style.bottom);
    const liqLabelBottom = parseFloat(liqLabel.style.bottom);
    // 止盈线标签应在清算线标签下面
    expect(takeProfitLabelBottom).toBeLessThan(liqLabelBottom);
    // 两者间距应 >= LABEL_GAP（6）
    expect(liqLabelBottom - takeProfitLabelBottom).toBeGreaterThanOrEqual(6);
  });
});
