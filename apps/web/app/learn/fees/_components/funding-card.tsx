"use client";

import React from "react";
import { useLang } from "@/lib/i18n-context";

const TICKS = ["00", "08", "16"];

export function FundingCard() {
  const { t } = useLang();
  // 结算时点圆点用中性色（仅作时间标记，不抢色）。
  return (
    <div data-testid="fee-funding" style={{ border: "1px solid var(--border-subtle)", borderRadius: 14, background: "var(--bg-1)", padding: 20 }}>
      <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: 0.7, color: "var(--fg-2)", marginBottom: 14 }}>{t("learn.fees.funding_title")}</div>
      <div style={{ display: "flex", gap: 8, justifyContent: "center", margin: "4px 0 14px" }}>
        {TICKS.map((tick) => (
          <div key={tick} style={{ width: 38, height: 38, borderRadius: "50%", border: "1px solid var(--border-default)", color: "var(--fg-2)", fontSize: 12, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center" }}>{tick}</div>
        ))}
      </div>
      <div style={{ fontSize: 14, color: "var(--fg-1)", lineHeight: 1.8, display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ textAlign: "center", color: "var(--fg-2)" }}>{t("learn.fees.funding_cycle")}</div>
        <div>{t("learn.fees.funding_dir")}</div>
        <div style={{ color: "var(--fg-3)", fontSize: 13 }}>{t("learn.fees.funding_note")}</div>
      </div>
    </div>
  );
}
