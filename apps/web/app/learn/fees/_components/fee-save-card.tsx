"use client";

import type { JSX } from "react";
import React from "react";
import { useLang } from "@/lib/i18n-context";
import { ReferralCta } from "@/components/referral/referral-cta";

export function FeeSaveCard(): JSX.Element {
  const { t } = useLang();
  // 让"注册返佣"成为最显眼的行动号召：精简到 标语 + 醒目 CTA（按钮）+ 一行 ①② 小注。
  return (
    <div data-testid="fee-save" style={{ border: "1px solid var(--border-subtle)", borderRadius: 16, background: "var(--bg-1)", padding: 24 }}>
      <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: 0.7, color: "var(--fg-2)", marginBottom: 10 }}>{t("learn.fees.save_title")}</div>
      <div style={{ fontSize: 17, fontWeight: 700, color: "var(--fg-0)", marginBottom: 16, lineHeight: 1.5 }}>{t("learn.fees.save_tagline")}</div>
      <ReferralCta variant="prominent" />
      <div style={{ fontSize: 12.5, color: "var(--fg-3)", marginTop: 14, lineHeight: 1.7 }}>
        <span style={{ color: "var(--accent)", fontWeight: 700 }}>① </span><span>{t("learn.fees.save_maker")}</span>
        <span style={{ margin: "0 8px", color: "var(--border-strong)" }}>·</span>
        <span style={{ color: "var(--accent)", fontWeight: 700 }}>② </span><span>{t("learn.fees.save_rebate")}</span>
      </div>
    </div>
  );
}
