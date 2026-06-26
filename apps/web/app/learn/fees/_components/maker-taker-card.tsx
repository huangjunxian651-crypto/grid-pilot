"use client";

import React from "react";
import { useLang } from "@/lib/i18n-context";
import { Badge } from "@/components/ui/primitives";

export function MakerTakerCard() {
  const { t } = useLang();
  // 不用红：Maker 用主色紫(accent,更省=好)，Taker 用中性(neutral,费率高但不刺眼)。
  return (
    <div data-testid="fee-makertaker" style={{ border: "1px solid var(--border-subtle)", borderRadius: 16, background: "var(--bg-1)", padding: 24 }}>
      <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: 0.7, color: "var(--fg-2)", marginBottom: 14 }}>{t("learn.fees.trading_fee_title")}</div>
      <div style={{ fontSize: 14, color: "var(--fg-1)", lineHeight: 1.8, display: "flex", flexDirection: "column", gap: 10 }}>
        <div><Badge tone="accent">Maker 0.02%</Badge> {t("learn.fees.maker_desc")}</div>
        <div><Badge tone="neutral">Taker 0.05%</Badge> {t("learn.fees.taker_desc")}</div>
        <div style={{ color: "var(--fg-3)", marginTop: 4, fontSize: 13 }}>{t("learn.fees.fee_note")}</div>
      </div>
    </div>
  );
}
