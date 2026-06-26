"use client";

import React from "react";
import { useLang } from "@/lib/i18n-context";
import { Icons } from "@/components/ui/icons";
import { ReferralCta } from "./referral-cta";

/**
 * 连接交易所前的高意图返佣引导（设计稿 pageKeys 顶部金色渐变 banner）。
 * 视觉：alpha 渐变底 + 右上 radial 光晕 + 金色图标徽，强化"注册时绑定才有效"的稀缺感。
 */
export function ReferralRegisterPrompt({ exchangeId }: { exchangeId?: "binance" | "okx" | "gateio" }) {
  const { t } = useLang();
  return (
    <div
      data-testid="referral-register-prompt"
      style={{
        position: "relative",
        overflow: "hidden",
        background: "linear-gradient(135deg, var(--alpha-tint) 0%, var(--bg-1) 62%)",
        border: "1px solid var(--alpha-tint-strong)",
        borderRadius: 14,
        padding: 18,
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <div style={{ position: "absolute", top: -28, right: -28, width: 120, height: 120, borderRadius: "50%", background: "radial-gradient(circle, var(--alpha) 0%, transparent 70%)", opacity: 0.14, pointerEvents: "none" }} />
      <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
        <div style={{ width: 42, height: 42, borderRadius: 11, background: "var(--alpha-tint-strong)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <Icons.Sparkles size={21} style={{ color: "var(--alpha)" }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14.5, fontWeight: 600, marginBottom: 4 }}>{t("referral.empty_title")}</div>
          <p style={{ fontSize: 12, color: "var(--fg-2)", lineHeight: 1.6, margin: 0 }}>{t("referral.empty_body")}</p>
          <div style={{ fontSize: 12, color: "var(--alpha)", marginTop: 6 }}>{t("referral.oneshot_warning")}</div>
        </div>
      </div>
      <ReferralCta exchangeId={exchangeId} />
    </div>
  );
}
