import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import React from "react";

vi.mock("@/lib/i18n-context", () => ({
  useLang: () => ({ t: (k: string, p?: Record<string, string>) => (p?.code ? `${k}:${p.code}` : k), lang: "zh", setLang: () => {} }),
}));

import { ReferralCta } from "../referral-cta";

afterEach(() => vi.unstubAllGlobals());

describe("ReferralCta", () => {
  it("未联网即渲染官网域名链接 + 邀请码", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {}))); // 永不 resolve
    render(<ReferralCta exchangeId="binance" />);
    const a = screen.getByTestId("referral-official-binance") as HTMLAnchorElement;
    expect(a.href).toContain("binance.com");
    expect(a.href).toContain("ref=fanwo20"); // Binance 用 fanwo20（OKX/Gate 才是 fangeiwo）
  });

  it("fetch 成功后出现镜像备用入口（镜像域名）", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ([{ platform: "binance", invite_code: "fangeiwo", invite_link: "https://www.bsmkweb.cc/join?ref=fangeiwo", international_invite_link: "https://www.binance.com/join?ref=fangeiwo" }]),
    })));
    render(<ReferralCta exchangeId="binance" />);
    await waitFor(() => {
      const m = screen.getByTestId("referral-mirror-binance") as HTMLAnchorElement;
      expect(m.href).toContain("bsmkweb.cc");
    });
  });

  it("fetch 失败时只剩官网链接、不抛错", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network"); }));
    render(<ReferralCta exchangeId="okx" />);
    expect(screen.getByTestId("referral-official-okx")).toBeTruthy();
    await waitFor(() => expect(screen.queryByTestId("referral-mirror-okx")).toBeNull());
  });

  it("醒目版(variant=prominent)：渲染醒目容器 + 标题 + 填充注册按钮", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    render(<ReferralCta variant="prominent" />);
    expect(screen.getByTestId("referral-cta-prominent")).toBeTruthy();
    expect(screen.getByText("referral.cta_headline")).toBeTruthy();
    // 三所注册按钮(<a href>)均在；邀请码按所不同：Binance fanwo20，OKX/Gate fangeiwo
    const binance = screen.getByTestId("referral-official-binance") as HTMLAnchorElement;
    expect(binance.href).toContain("binance.com");
    expect(binance.href).toContain("ref=fanwo20");
    const okx = screen.getByTestId("referral-official-okx") as HTMLAnchorElement;
    expect(okx.href).toContain("fangeiwo");
    expect(screen.getByTestId("referral-official-gateio")).toBeTruthy();
    // 各所邀请码说明行
    const block = screen.getByTestId("referral-cta-prominent");
    expect(block.textContent).toContain("Binance fanwo20");
    expect(block.textContent).toContain("Gate.io fangeiwo");
    // 注册关键提示（APP 手填码 / 身份证限一号）
    const tipsBlock = screen.getByTestId("referral-tips");
    expect(tipsBlock).toBeTruthy();
    expect(tipsBlock.textContent).toContain("referral.tip_app");
    expect(tipsBlock.textContent).toContain("referral.tip_id");
  });
});
