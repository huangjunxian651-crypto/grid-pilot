import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

vi.mock("@/lib/i18n-context", () => ({ useLang: () => ({ t: (k: string) => k, lang: "zh", setLang: () => {} }) }));
vi.mock("@/components/ui/primitives", () => ({
  Badge: ({ children, tone }: { children: React.ReactNode; tone: string }) => (
    <span data-tone={tone}>{children}</span>
  ),
}));

import { MakerTakerCard } from "../maker-taker-card";

describe("MakerTakerCard", () => {
  it("渲染标题、maker/taker 描述与不抽成说明，并正确应用 Badge tone", () => {
    render(<MakerTakerCard />);
    expect(screen.getByTestId("fee-makertaker")).toBeTruthy();
    expect(screen.getByText("learn.fees.trading_fee_title")).toBeTruthy();

    // 不用红：maker 行用主色 accent，taker 行用 neutral
    const makerRow = screen.getByText("learn.fees.maker_desc").closest("div");
    expect(makerRow?.querySelector('[data-tone="accent"]')).toBeTruthy();

    const takerRow = screen.getByText("learn.fees.taker_desc").closest("div");
    expect(takerRow?.querySelector('[data-tone="neutral"]')).toBeTruthy();

    expect(screen.getByText("learn.fees.fee_note")).toBeTruthy();
  });
});
