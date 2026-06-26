import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

vi.mock("@/lib/i18n-context", () => ({
  useLang: () => ({ t: (k: string) => k, lang: "zh", setLang: () => {} }),
}));

import { FeeShockHero } from "../fee-shock-hero";

describe("FeeShockHero", () => {
  it("渲染标题、副标题与返佣价值三联", () => {
    render(<FeeShockHero />);
    expect(screen.getByTestId("fee-hero")).toBeTruthy();
    expect(screen.getByText("learn.fees.hero_title")).toBeTruthy();
    expect(screen.getByText("learn.fees.hero_sub")).toBeTruthy();
    // 三联：返佣价值 / 自动 / 注册时
    expect(screen.getByText("learn.fees.stat_rebate_value")).toBeTruthy();
    expect(screen.getByText("learn.fees.stat_rebate_label")).toBeTruthy();
    expect(screen.getByText("learn.fees.stat_auto_value")).toBeTruthy();
    expect(screen.getByText("learn.fees.stat_lock_value")).toBeTruthy();
  });
});
