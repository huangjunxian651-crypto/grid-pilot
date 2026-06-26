import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

vi.mock("@/lib/i18n-context", () => ({
  useLang: () => ({ t: (k: string) => k, lang: "zh", setLang: () => {} }),
}));

import { FeeWhyCard } from "../fee-why-card";

describe("FeeWhyCard", () => {
  it("渲染标题、开平仓算账三行与三根对峙柱", () => {
    render(<FeeWhyCard />);
    expect(screen.getByTestId("fee-why")).toBeTruthy();
    expect(screen.getByText("learn.fees.why_title")).toBeTruthy();
    expect(screen.getByText("learn.fees.calc1")).toBeTruthy();
    expect(screen.getByText("learn.fees.calc2")).toBeTruthy();
    expect(screen.getByText("learn.fees.calc3")).toBeTruthy();
    expect(screen.getByText("learn.fees.hero_takeaway")).toBeTruthy();
    expect(screen.getByTestId("fee-bar-principal")).toBeTruthy();
    expect(screen.getByTestId("fee-bar-taker")).toBeTruthy();
    expect(screen.getByTestId("fee-bar-maker")).toBeTruthy();
  });
  it("Taker 柱与本金柱等高、Maker 柱更矮（按举例 1000/1000/400）", () => {
    render(<FeeWhyCard />);
    const taker = screen.getByTestId("fee-bar-taker").style.height;
    const principal = screen.getByTestId("fee-bar-principal").style.height;
    const maker = screen.getByTestId("fee-bar-maker").style.height;
    expect(taker).toBe(principal);
    expect(parseFloat(maker)).toBeLessThan(parseFloat(taker));
  });
});
