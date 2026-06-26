"use client";

import React from "react";
import { useLang } from "@/lib/i18n-context";
import { FEE_EXAMPLE } from "./example-constants";

const MAX_H = 150; // 值为本金(1000)时的柱高(px)
const BAR_WIDTH = 88;

function barHeight(value: number): number {
  return Math.round((value / FEE_EXAMPLE.principal) * MAX_H);
}

// 三柱配色不用红：本金=虚线幽灵柱(容器)，Taker成本=中性灰实柱(填满=吃满本金)，Maker=主色紫短柱。
function barStyle(kind: "ghost" | "cost" | "good"): React.CSSProperties {
  if (kind === "ghost") return { background: "transparent", border: "1.5px dashed var(--border-strong)", color: "var(--fg-2)" };
  if (kind === "cost") return { background: "var(--fg-3)", color: "var(--fg-0)" };
  return { background: "var(--accent)", color: "var(--fg-0)" };
}

export function FeeWhyCard() {
  const { t } = useLang();
  const bars = [
    { testId: "fee-bar-principal", value: FEE_EXAMPLE.principal, kind: "ghost" as const, label: t("learn.fees.bar_principal") },
    { testId: "fee-bar-taker", value: FEE_EXAMPLE.takerDaily, kind: "cost" as const, label: t("learn.fees.bar_taker") },
    { testId: "fee-bar-maker", value: FEE_EXAMPLE.makerDaily, kind: "good" as const, label: t("learn.fees.bar_maker") },
  ];
  return (
    <div data-testid="fee-why" style={{ border: "1px solid var(--border-subtle)", borderRadius: 16, background: "var(--bg-1)", padding: 28 }}>
      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.8, color: "var(--fg-3)", fontWeight: 600, marginBottom: 14 }}>{t("learn.fees.why_title")}</div>
      <div style={{ fontSize: 13.5, color: "var(--fg-1)", lineHeight: 1.9, marginBottom: 22, display: "flex", flexDirection: "column", gap: 2 }}>
        <div>{t("learn.fees.calc1")}</div>
        <div>{t("learn.fees.calc2")}</div>
        <div style={{ color: "var(--accent-hi)", fontWeight: 600 }}>{t("learn.fees.calc3")}</div>
      </div>
      {/* 柱体：单独一行，底边落在同一基线 */}
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "center", gap: 48, height: MAX_H, borderBottom: "1px solid var(--border-subtle)" }}>
        {bars.map((bar) => (
          <div
            key={bar.testId}
            data-testid={bar.testId}
            style={{
              width: BAR_WIDTH, height: barHeight(bar.value), borderRadius: "10px 10px 0 0",
              display: "flex", alignItems: "flex-end", justifyContent: "center", fontSize: 20, fontWeight: 700, paddingBottom: 10,
              ...barStyle(bar.kind),
            }}
          >
            {bar.value}
          </div>
        ))}
      </div>
      {/* 标签：单独一行，等宽列对齐每根柱 */}
      <div style={{ display: "flex", justifyContent: "center", gap: 48, marginTop: 14 }}>
        {bars.map((bar) => (
          <div key={bar.testId} style={{ width: BAR_WIDTH, textAlign: "center", fontSize: 12.5, color: "var(--fg-2)", lineHeight: 1.45 }}>{bar.label}</div>
        ))}
      </div>
      <div style={{ fontSize: 14.5, color: "var(--fg-1)", textAlign: "center", marginTop: 22, lineHeight: 1.6 }}>{t("learn.fees.hero_takeaway")}</div>
    </div>
  );
}
