import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import type { LiveState, AlgoOrder } from "@/lib/store";

// i18n: return the key so we can assert on stable strings
vi.mock("@/lib/i18n-context", () => ({
  useLang: () => ({ t: (k: string) => k, lang: "zh", setLang: () => {} }),
}));

import { StopLossPanel } from "../panels/stop-loss-panel";

function liveWith(algoOrders: AlgoOrder[]): LiveState {
  return { algoOrders } as unknown as LiveState;
}

describe("StopLossPanel", () => {
  it("close-position 算法单隐藏 ×qty 并显示全平徽章", () => {
    render(
      <StopLossPanel
        live={liveWith([
          { type: "emergency", side: "sell", triggerPrice: 1430, qty: 0, closePosition: true, status: "open" },
        ])}
      />,
    );
    // 全平徽章
    expect(screen.getByText("bot.close_all")).toBeTruthy();
    // 不应渲染误导性的 ×0.0000
    expect(screen.queryByText(/×0\.0000/)).toBeNull();
    expect(screen.queryByText(/×/)).toBeNull();
  });

  it("普通算法单显示 ×qty,不显示全平徽章", () => {
    render(
      <StopLossPanel
        live={liveWith([
          { type: "other", side: "buy", triggerPrice: 1900, qty: 0.05, closePosition: false, status: "open" },
        ])}
      />,
    );
    expect(screen.getByText("×0.0500")).toBeTruthy();
    expect(screen.queryByText("bot.close_all")).toBeNull();
  });

  it("无算法单时不渲染", () => {
    const { container } = render(<StopLossPanel live={liveWith([])} />);
    expect(container.firstChild).toBeNull();
  });
});
