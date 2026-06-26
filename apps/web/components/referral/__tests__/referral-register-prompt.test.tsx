import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

vi.mock("@/lib/i18n-context", () => ({
  useLang: () => ({ t: (k: string) => k, lang: "zh", setLang: () => {} }),
}));
// 隔离 ReferralCta 的网络副作用：fetch 永不 resolve
vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));

import { ReferralRegisterPrompt } from "../referral-register-prompt";

describe("ReferralRegisterPrompt", () => {
  it("渲染一次性警告与标题，并内嵌注册链接", () => {
    render(<ReferralRegisterPrompt exchangeId="binance" />);
    expect(screen.getByTestId("referral-register-prompt")).toBeTruthy();
    expect(screen.getByText("referral.empty_title")).toBeTruthy();
    expect(screen.getByText("referral.oneshot_warning")).toBeTruthy();
    // ReferralCta 内的官网链接存在
    expect(screen.getByTestId("referral-official-binance")).toBeTruthy();
  });
});
