import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

vi.mock("@/lib/i18n-context", () => ({ useLang: () => ({ t: (k: string) => k, lang: "zh", setLang: () => {} }) }));

import { FundingCard } from "../funding-card";

describe("FundingCard", () => {
  it("渲染标题、三个结算时点与公式说明", () => {
    render(<FundingCard />);
    expect(screen.getByTestId("fee-funding")).toBeTruthy();
    expect(screen.getByText("00")).toBeTruthy();
    expect(screen.getByText("08")).toBeTruthy();
    expect(screen.getByText("16")).toBeTruthy();
    expect(screen.getByText("learn.fees.funding_note")).toBeTruthy();
    expect(screen.getByText("learn.fees.funding_title")).toBeTruthy();
    expect(screen.getByText("learn.fees.funding_cycle")).toBeTruthy();
    expect(screen.getByText("learn.fees.funding_dir")).toBeTruthy();
  });
});
