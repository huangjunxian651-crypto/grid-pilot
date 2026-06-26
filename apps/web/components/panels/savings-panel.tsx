import React from "react";
import { Card } from "@/components/ui/primitives";
import { useLang } from "@/lib/i18n-context";
import type { RobotSummaryMetrics } from "@/lib/api";

interface SavingsPanelProps {
  summary: RobotSummaryMetrics | undefined;
  isLoading?: boolean;
}

export function SavingsPanel({ summary, isLoading }: SavingsPanelProps) {
  const { t } = useLang();

  if (isLoading) {
    return (
      <Card pad={14}>
        <div style={{ fontSize: 11, color: "var(--fg-2)", textTransform: "uppercase", letterSpacing: 0.7, fontWeight: 500, marginBottom: 10 }}>
          {t("bot.strategy_advantage_attribution")}
        </div>
        <div style={{ fontSize: 12, color: "var(--fg-3)" }}>
          {t("common.loading")}
        </div>
      </Card>
    );
  }

  if (!summary) {
    return null;
  }

  const pnl = summary.todayRealizedPnl;
  const alpha = summary.alphaTotal;
  const pnlColor = pnl >= 0 ? "var(--up)" : "var(--down)";
  const pnlFormatted = `${pnl >= 0 ? "+" : ""}$${Math.abs(pnl).toFixed(2)}`;
  const alphaFormatted = `+$${alpha.toFixed(2)}`;

  return (
    <Card pad={14}>
      <div style={{ fontSize: 11, color: "var(--fg-2)", textTransform: "uppercase", letterSpacing: 0.7, fontWeight: 500, marginBottom: 10 }}>
        {t("bot.strategy_advantage_attribution")}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {/* 今日已实现盈亏 */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <div style={{ fontSize: 11, color: "var(--fg-2)" }}>
            {t("bot.today_realized_pnl")}
          </div>
          <div className="num" style={{ fontSize: 15, fontWeight: 600, color: pnlColor }}>
            {pnlFormatted}
          </div>
        </div>

        {/* Alpha 超额（归因）— 已含在已实现盈亏内，非额外叠加 */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <div style={{ fontSize: 11, color: "var(--fg-2)" }}>
            {t("bot.alpha_excess")}
          </div>
          <div className="num" style={{ fontSize: 15, fontWeight: 600, color: "var(--up)" }}>
            {alphaFormatted}
          </div>
        </div>
        <div style={{ fontSize: 10, color: "var(--fg-3)", lineHeight: 1.4 }}>
          {t("bot.alpha_attribution_note")}
        </div>
      </div>
    </Card>
  );
}
