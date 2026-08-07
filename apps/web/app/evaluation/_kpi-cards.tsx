"use client";

import React from "react";
import { Card } from "@/components/ui/primitives";
import { fmt } from "@/lib/store";
import { useLang } from "@/lib/i18n-context";
import type { RobotMetrics } from "@/lib/api";

function Kpi({ label, value, tip }: { label: string; value: string; tip?: string }) {
  return (
    <Card style={{ padding: "12px 16px", minWidth: 140, flex: 1 }}>
      <div style={{ fontSize: 10.5, color: "var(--fg-2)", textTransform: "uppercase", letterSpacing: 0.9, fontWeight: 600 }} title={tip}>
        {label}
      </div>
      <div className="num" style={{ fontSize: 20, fontWeight: 650, marginTop: 4 }}>{value}</div>
    </Card>
  );
}

export function MetricsKpiCards({ aggregate }: { aggregate: RobotMetrics }) {
  const { t } = useLang();
  return (
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
      <Kpi label={t("evaluation.metric.netPnl")} value={fmt.signed(aggregate.netPnl)} />
      <Kpi label={t("evaluation.metric.alpha")} value={fmt.signed(aggregate.alpha)} />
      <Kpi
        label={t("evaluation.metric.winRate")}
        value={fmt.pct(aggregate.winRate)}
        tip={t("evaluation.tip.winRate")}
      />
      <Kpi label={t("evaluation.metric.feeRateBp")} value={`${aggregate.feeRateBp.toFixed(2)} bp`} />
      {/* 汇总口径 maxDrawdown 恒为 null（时间轴交叠不可相加），KPI 行改用费用占毛利比监控费用侵蚀。 */}
      <Kpi
        label={t("evaluation.metric.feeToGross")}
        value={aggregate.feeToGross == null ? "—" : fmt.pct(aggregate.feeToGross, 1)}
        tip={t("evaluation.tip.feeToGross")}
      />
    </div>
  );
}
