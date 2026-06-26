import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

vi.mock("@/lib/i18n-context", () => ({
  useLang: () => ({ t: (k: string) => k, lang: "zh", setLang: () => {} }),
}));

import { PnlCell } from "../pnl-cell";

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
