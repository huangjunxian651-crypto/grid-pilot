"use client";
import React from "react";
import { useLang } from "@/lib/i18n-context";
import { TermHelp } from "@/components/ui/term-help";
import { computeMarginRoi, formatMarginRoi } from "@/lib/margin-roi";

const sign = (v: number) => (v >= 0 ? "+" : "");
const tone = (v: number) => (v >= 0 ? "var(--up)" : "var(--down)");
const label: React.CSSProperties = { fontSize: 10, color: "var(--fg-3)", textTransform: "uppercase" };

interface PnlCellProps {
  realizedPnl: number;
  totalFees: number;
  netPnl: number;
  totalPnl: number | null;
  lastUnrealizedPnl: number | null;
  /**
   * 保证金回报率的分母输入。三项只在一起才有意义，故合为一个对象：
   * **整体省略，或传入后分母不可用，都完全不渲染百分比节点**（不显示占位符）。
   */
  marginBasis?: { positionQty: number | null; price: number | null; leverage: number | null };
}

export function PnlCell({ realizedPnl, totalFees, netPnl, totalPnl, lastUnrealizedPnl, marginBasis }: PnlCellProps) {
  const { t } = useLang();
  const roiOf = (pnl: number): string | null => {
    if (!marginBasis) return null;
    const roi = computeMarginRoi({ pnl, ...marginBasis });
    return roi == null ? null : formatMarginRoi(roi);
  };

  // totalPnl == null: 实时未实现不可得，降级显示 netPnl（净已实现）+ 提示
  if (totalPnl == null) {
    return (
      <div style={{ textAlign: "right" }}>
        <div style={{ ...label, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 2 }}>
          {t("kpi.net_pnl")}<TermHelp term="netPnl" title={t("kpi.net_pnl")} />
        </div>
        <div className="num" data-testid="pnl-net-only" style={{ fontSize: 14, color: tone(netPnl) }}>
          {sign(netPnl)}{netPnl.toFixed(2)}
        </div>
        <div data-testid="pnl-hint" style={{ fontSize: 9, color: "var(--fg-3)" }}>{t("bot.realtime_total_in_detail")}</div>
      </div>
    );
  }

  // totalPnl != null: 显示后端 totalPnl（已实现 − 手续费 + 未实现）及分项
  const totalRoi = roiOf(totalPnl);
  const unrealizedRoi = lastUnrealizedPnl != null ? roiOf(lastUnrealizedPnl) : null;
  return (
    <div style={{ textAlign: "right" }}>
      <div style={{ ...label, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 2 }}>
        {t("kpi.total_pnl")}<TermHelp term="totalPnl" title={t("kpi.total_pnl")} />
      </div>
      <div className="num" data-testid="pnl-total" style={{ fontSize: 14, color: tone(totalPnl) }}>
        {sign(totalPnl)}{totalPnl.toFixed(2)}
        {totalRoi != null && <span data-testid="pnl-total-roi" style={{ marginLeft: 6, fontSize: 11 }}>{totalRoi}</span>}
      </div>
      <div className="num" data-testid="pnl-realized" style={{ fontSize: 10, color: "var(--fg-3)" }}>
        {t("kpi.realized")} {sign(realizedPnl)}{realizedPnl.toFixed(2)}
      </div>
      <div className="num" data-testid="pnl-fees" style={{ fontSize: 10, color: "var(--fg-3)" }}>
        {t("kpi.fees")} {totalFees > 0 ? "-" : ""}{totalFees.toFixed(2)}
      </div>
      {lastUnrealizedPnl != null && (
        <div className="num" data-testid="pnl-unrealized" style={{ fontSize: 10, color: "var(--fg-3)" }}>
          {t("kpi.unrealized")} {sign(lastUnrealizedPnl)}{lastUnrealizedPnl.toFixed(2)}
          {unrealizedRoi != null && <span data-testid="pnl-unrealized-roi" style={{ marginLeft: 6 }}>{unrealizedRoi}</span>}
        </div>
      )}
    </div>
  );
}
