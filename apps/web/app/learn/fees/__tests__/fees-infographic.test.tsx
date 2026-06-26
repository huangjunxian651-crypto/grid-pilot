import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

vi.mock("@/lib/i18n-context", () => ({ useLang: () => ({ t: (k: string, p?: Record<string, unknown>) => (p ? `T:${k}:${JSON.stringify(p)}` : `T:${k}`), lang: "zh", setLang: () => {} }) }));
vi.mock("@/components/shell/shell", () => ({
  Shell: ({ breadcrumb, children }: { breadcrumb: string[]; children: React.ReactNode }) => (
    <div><div data-testid="breadcrumb">{breadcrumb.join("/")}</div>{children}</div>
  ),
}));
// 真实返佣注册卡，不再 mock，断言用真实邀请码渲染。
vi.mock("@/lib/hooks/useBots", () => ({
  useRobots: () => ({
    data: [
      { id: "a", exchangeId: "binance", totalFees: 100, totalSavings: 40 },
      { id: "b", exchangeId: "gateio", totalFees: 50, totalSavings: 10 },
    ],
  }),
}));

import { FeesInfographic } from "../fees-infographic";

describe("费用与返佣页（设计稿还原）", () => {
  it("面包屑取 learn.fees.nav，标题为费用与返佣", () => {
    render(<FeesInfographic />);
    expect(screen.getByTestId("breadcrumb").textContent).toBe("T:learn.fees.nav");
    expect(screen.getByText("T:fees.title")).toBeTruthy();
  });

  it("渲染三张 KPI hero（已省/已付/可返还），数值来自真实机器人数据", () => {
    render(<FeesInfographic />);
    expect(screen.getByTestId("fees-kpi-saved")).toBeTruthy();
    expect(screen.getByTestId("fees-kpi-paid")).toBeTruthy();
    expect(screen.getByTestId("fees-kpi-rebate")).toBeTruthy();
    // 已付手续费 = 100 + 50 = 150；可返还 = 100*0.2 + 50*0.4 = 40
    expect(screen.getByTestId("fees-kpi-paid").textContent).toContain("150");
    expect(screen.getByTestId("fees-kpi-rebate").textContent).toContain("40");
  });

  it("渲染降本三机制卡（POC Maker / GTC / 交易所返佣）", () => {
    render(<FeesInfographic />);
    expect(screen.getByTestId("fees-lower-poc")).toBeTruthy();
    expect(screen.getByTestId("fees-lower-gtc")).toBeTruthy();
    expect(screen.getByTestId("fees-lower-rebate")).toBeTruthy();
  });

  it("渲染费率与返佣比例表，含真实返佣比例 20%/40%", () => {
    render(<FeesInfographic />);
    const table = screen.getByTestId("fees-rate-table");
    expect(table).toBeTruthy();
    expect(table.textContent).toContain("20%");
    expect(table.textContent).toContain("40%");
  });

  it("渲染注册并绑定卡（含设计稿返佣页注册区）", () => {
    render(<FeesInfographic />);
    expect(screen.getByTestId("fees-register")).toBeTruthy();
  });

  it("渲染一证一户提示与深入了解教育区", () => {
    render(<FeesInfographic />);
    expect(screen.getByTestId("fees-oneid")).toBeTruthy();
    expect(screen.getByTestId("fees-deepdive")).toBeTruthy();
  });

  it("不出现设计稿占位符 rebateto.me / GRIDPILOT", () => {
    const { container } = render(<FeesInfographic />);
    expect(container.innerHTML).not.toContain("rebateto.me");
    expect(container.innerHTML).not.toContain("GRIDPILOT");
  });
});
