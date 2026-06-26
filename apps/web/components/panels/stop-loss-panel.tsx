import React from "react";
import { Card, Badge } from "@/components/ui/primitives";
import { useLang } from "@/lib/i18n-context";
import type { LiveState } from "@/lib/store";

interface StopLossPanelProps {
  live: LiveState;
}

export function StopLossPanel({ live }: StopLossPanelProps) {
  const { t } = useLang();
  const algoOrders = live.algoOrders ?? [];

  if (algoOrders.length === 0) {
    return null;
  }

  return (
    <Card pad={14}>
      <div style={{ fontSize: 11, color: "var(--fg-2)", textTransform: "uppercase", letterSpacing: 0.7, fontWeight: 500, marginBottom: 10 }}>
        {t("bot.stop_loss_buffer")}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {algoOrders.map((ao, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", background: "var(--bg-2)", borderRadius: 6 }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: ao.status === "open" ? "var(--up)" : "var(--fg-3)", flexShrink: 0 }} />
            <span style={{ fontSize: 11, color: "var(--fg-2)" }}>
              {ao.type === 'emergency' ? t("bot.emergency_stop") : `#${i + 1}`}
            </span>
            <Badge tone={ao.side === "sell" ? "down" : "up"}>{ao.side.toUpperCase()}</Badge>
            {ao.closePosition && <Badge tone="warn">{t("bot.close_all")}</Badge>}
            <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--fg-1)" }}>
              ${ao.triggerPrice.toFixed(2)}
            </span>
            {!ao.closePosition && (
              <span style={{ fontSize: 11, color: "var(--fg-2)" }}>
                ×{ao.qty.toFixed(4)}
              </span>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}
