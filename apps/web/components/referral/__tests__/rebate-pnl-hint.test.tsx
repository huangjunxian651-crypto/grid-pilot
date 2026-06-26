import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

vi.mock("@/lib/i18n-context", () => ({
  useLang: () => ({
    t: (k: string, p?: Record<string, string | number>) => (p ? `${k}|${JSON.stringify(p)}` : k),
    lang: "zh", setLang: () => {},
  }),
}));

import { RebatePnlHint } from "../rebate-pnl-hint";
import { setReferralMuted } from "@/lib/referral";

beforeEach(() => localStorage.clear());

describe("RebatePnlHint", () => {
  it("gate 40%：100 手续费提示可多赚 40，并含指向 /learn/fees 的 CTA 链接", () => {
    render(<RebatePnlHint exchangeId="gateio" feesPaid={100} />);
    expect(screen.getByTestId("rebate-pnl-hint").textContent).toContain("40");
    const link = screen.getByRole("link") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/learn/fees");
  });

  it("feesPaid<=0 不渲染", () => {
    const { container } = render(<RebatePnlHint exchangeId="binance" feesPaid={0} />);
    expect(container.firstChild).toBeNull();
  });

  it("静音后不渲染", () => {
    setReferralMuted();
    const { container } = render(<RebatePnlHint exchangeId="okx" feesPaid={80} />);
    expect(container.firstChild).toBeNull();
  });
});
