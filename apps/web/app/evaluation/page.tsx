"use client";

import React, { useState } from "react";
import { Shell } from "@/components/shell/shell";
import { Card, Button } from "@/components/ui/primitives";
import { useLang } from "@/lib/i18n-context";
import { useStrategyMetrics, useStrategySeries } from "@/lib/hooks/useEvaluation";
import type { MetricsWindow } from "@/lib/api";
import { MetricsKpiCards } from "./_kpi-cards";
import { RobotMetricsTable } from "./_metrics-table";
import { RobotMetricsDetail } from "./_metrics-detail";

const WINDOWS: MetricsWindow[] = ["24h", "7d", "30d"];

export default function EvaluationPage() {
  const { t } = useLang();
  const [timeWindow, setTimeWindow] = useState<MetricsWindow>("24h");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { data } = useStrategyMetrics(timeWindow);
  const { data: series } = useStrategySeries(selectedId, timeWindow);

  // 选中的机器人停止/归档从列表消失后清除选中，series 查询随之停止轮询
  React.useEffect(() => {
    if (selectedId && data && !data.robots.some((r) => r.robotId === selectedId)) {
      setSelectedId(null);
    }
  }, [data, selectedId]);

  return (
    <Shell breadcrumb={[t("evaluation.title")]}>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <h1 style={{ fontSize: 18, fontWeight: 650, margin: 0 }}>{t("evaluation.title")}</h1>
          <div style={{ display: "flex", gap: 8 }}>
            {WINDOWS.map((w) => (
              <Button key={w} size="sm" variant={timeWindow === w ? "primary" : "secondary"} onClick={() => setTimeWindow(w)}>
                {t(`evaluation.window.${w}`)}
              </Button>
            ))}
          </div>
        </div>

        {data && <MetricsKpiCards aggregate={data.aggregate} />}

        <Card style={{ padding: 16 }}>
          {data ? (
            data.robots.length > 0 ? (
              <RobotMetricsTable robots={data.robots} selectedId={selectedId} onSelect={setSelectedId} />
            ) : (
              <div style={{ color: "var(--fg-2)", fontSize: 13 }}>{t("evaluation.noData")}</div>
            )
          ) : null}
        </Card>

        {selectedId && (
          <RobotMetricsDetail
            entry={data?.robots.find((r) => r.robotId === selectedId) ?? null}
            series={series ?? null}
          />
        )}
      </div>
    </Shell>
  );
}
