import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

vi.mock("@/lib/i18n-context", () => ({ useLang: () => ({ t: (k: string) => k, lang: "zh", setLang: () => {} }) }));
vi.mock("@/components/referral/referral-cta", () => ({
  ReferralCta: ({ variant }: { variant?: string }) => <div data-testid="referral-cta" data-variant={variant} />,
}));

import { FeeSaveCard } from "../fee-save-card";

describe("FeeSaveCard", () => {
  it("以醒目 CTA 为主：标语 + 醒目版 ReferralCta + ①② 小注", () => {
    render(<FeeSaveCard />);
    expect(screen.getByTestId("fee-save")).toBeTruthy();
    expect(screen.getByText("learn.fees.save_title")).toBeTruthy();
    expect(screen.getByText("learn.fees.save_tagline")).toBeTruthy();
    expect(screen.getByText("learn.fees.save_maker")).toBeTruthy();
    expect(screen.getByText("learn.fees.save_rebate")).toBeTruthy();
    // 内嵌的是醒目版 CTA（variant=prominent），而非淡化的文字链
    const cta = screen.getByTestId("referral-cta");
    expect(cta.getAttribute("data-variant")).toBe("prominent");
  });
});
