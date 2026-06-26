import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

vi.mock("@/lib/i18n-context", () => ({
  useLang: () => ({ t: (k: string) => k, lang: "zh", setLang: () => {} }),
}));

import { SavingsPanel } from "../savings-panel";

describe("SavingsPanel（今日盈亏 + Alpha 超额）", () => {
  it("渲染两指标标签", () => {
    render(<SavingsPanel summary={{ todayRealizedPnl: 12.5, alphaTotal: 3.2 }} />);
    expect(screen.getByText("bot.today_realized_pnl")).toBeTruthy();
    expect(screen.getByText("bot.alpha_excess")).toBeTruthy();
  });
  it("不再渲染旧的总节省/最近成交", () => {
    render(<SavingsPanel summary={{ todayRealizedPnl: 0, alphaTotal: 0 }} />);
    expect(screen.queryByText("bot.total_savings")).toBeNull();
    expect(screen.queryByText("bot.recent_fills_with_savings")).toBeNull();
  });
  it("alpha 标注为「策略优势(归因)」且带「已含在已实现内、非额外收益」说明", () => {
    render(<SavingsPanel summary={{ todayRealizedPnl: 10, alphaTotal: 2.5 }} />);
    // 面板标题应带有归因语义
    expect(screen.getByText("bot.strategy_advantage_attribution")).toBeTruthy();
    // alpha 行旁边要渲染 attribution note 说明键
    expect(screen.getByText("bot.alpha_attribution_note")).toBeTruthy();
  });
});
