import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

vi.mock("@/lib/i18n-context", () => ({
  useLang: () => ({ t: (k: string) => k, lang: "zh", setLang: () => {} }),
}));

import { PnlCell } from "../pnl-cell";

describe("PnlCell 保证金回报率", () => {
  const base = { realizedPnl: 12.4, totalFees: 3.4, netPnl: 9, totalPnl: 9, lastUnrealizedPnl: 0 };

  it("不传 marginBasis 时完全不渲染百分比节点（归档页等场景不受影响）", () => {
    // 归档页复用同一组件且不传保证金输入；若渲染出占位符 —，就是把百分比
    // 泄漏到了规格明确排除的页面。
    render(<PnlCell {...base} />);
    expect(screen.queryAllByTestId(/-roi$/)).toHaveLength(0);
  });

  it("传入 marginBasis 且有持仓时，总盈亏旁显示百分比", () => {
    // 0.3 × 1870 ÷ 20 = 28.05 保证金；9 / 28.05 = +32.1%
    render(<PnlCell {...base} marginBasis={{ positionQty: 0.3, price: 1870, leverage: 20 }} />);
    expect(screen.getByTestId("pnl-total-roi").textContent).toBe("+32.1%");
  });

  it("未实现盈亏旁也显示百分比", () => {
    render(<PnlCell {...base} lastUnrealizedPnl={2.805} marginBasis={{ positionQty: 0.3, price: 1870, leverage: 20 }} />);
    expect(screen.getByTestId("pnl-unrealized-roi").textContent).toBe("+10.0%");
  });

  it("空仓时完全不渲染百分比节点", () => {
    render(<PnlCell {...base} marginBasis={{ positionQty: 0, price: 1870, leverage: 20 }} />);
    expect(screen.queryByTestId("pnl-total-roi")).toBeNull();
  });

  it("缺杠杆时完全不渲染百分比节点（分母不可用）", () => {
    render(<PnlCell {...base} marginBasis={{ positionQty: 0.3, price: 1870, leverage: null }} />);
    expect(screen.queryByTestId("pnl-total-roi")).toBeNull();
  });

  it("亏损时百分比为负", () => {
    render(<PnlCell {...base} totalPnl={-9} marginBasis={{ positionQty: 0.3, price: 1870, leverage: 20 }} />);
    expect(screen.getByTestId("pnl-total-roi").textContent).toBe("-32.1%");
  });

  it("不给已实现盈亏和手续费加百分比（只有两个 roi 节点）", () => {
    render(<PnlCell {...base} marginBasis={{ positionQty: 0.3, price: 1870, leverage: 20 }} />);
    expect(screen.queryAllByTestId(/-roi$/)).toHaveLength(2);
  });
});

describe("PnlCell", () => {
  it("有 totalPnl：显示净总盈亏与分项(已实现/手续费)，不前端自算", () => {
    render(<PnlCell realizedPnl={10} totalFees={2} netPnl={8} totalPnl={13} lastUnrealizedPnl={5} />);
    expect(screen.getByTestId("pnl-total").textContent).toContain("13");
    // 显式保证不再前端自算：旧逻辑 realizedPnl(10) + lastUnrealizedPnl(5) = 15 不得出现
    expect(screen.getByTestId("pnl-total").textContent).not.toContain("15");
    expect(screen.getByText(/kpi.realized/)).toBeTruthy();
  });

  it("totalPnl 为 null(实时不可得)：降级显示净已实现 + 见详情提示", () => {
    render(<PnlCell realizedPnl={10} totalFees={2} netPnl={8} totalPnl={null} lastUnrealizedPnl={null} />);
    expect(screen.getByTestId("pnl-net-only")).toBeTruthy();
  });

  it("totalPnl 为 null 时显示 bot.realtime_total_in_detail 提示文字", () => {
    render(<PnlCell realizedPnl={10} totalFees={2} netPnl={8} totalPnl={null} lastUnrealizedPnl={null} />);
    expect(screen.getByText("bot.realtime_total_in_detail")).toBeTruthy();
  });

  it("有 totalPnl 时：分项行含手续费", () => {
    render(<PnlCell realizedPnl={10} totalFees={2} netPnl={8} totalPnl={13} lastUnrealizedPnl={5} />);
    expect(screen.getByTestId("pnl-fees")).toBeTruthy();
  });

  it("有 totalPnl 时：分项行含未实现盈亏", () => {
    render(<PnlCell realizedPnl={10} totalFees={2} netPnl={8} totalPnl={13} lastUnrealizedPnl={5} />);
    expect(screen.getByTestId("pnl-unrealized")).toBeTruthy();
  });
});
