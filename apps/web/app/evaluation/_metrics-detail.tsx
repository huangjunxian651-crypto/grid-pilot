"use client";

// Task 7 明细面板：单机器人累计净盈亏 + 累计 Alpha 双折线，下方次级指标行。
// 图表样式对齐 dashboard/_equity-curve-chart.tsx（轴线/网格/Tooltip/图例色约定：
// 主序列 --accent，Alpha 序列 --alpha）。
import React from "react";
import { Card } from "@/components/ui/primitives";
import { fmt } from "@/lib/store";
import { useLang } from "@/lib/i18n-context";
import type { RobotMetricsEntry, StrategySeriesResponse } from "@/lib/api";
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";

// t 为 ISO 字符串（MetricsSeriesPoint.t），跨窗口跨度差异大：>3 天显示 M/D，否则 HH:MM。
function formatTime(iso: string, spanMs: number): string {
  const d = new Date(iso);
  if (spanMs > 3 * 24 * 3600_000) {
    return `${d.getMonth() + 1}/${d.getDate()}`;
  }
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// span > 3 天时 tick 标签折叠为 M/D，48px 的间隔会撞出重复日标签；放宽到 96（约一天一个）。
export function xAxisMinTickGap(spanMs: number): number {
  return spanMs > 3 * 24 * 3600_000 ? 96 : 48;
}

export function RobotMetricsDetail({
  entry,
  series,
}: {
  entry: RobotMetricsEntry | null;
  series: StrategySeriesResponse | null;
}) {
  const { t } = useLang();
  if (!entry) return null;
  const m = entry.metrics;

  const points = series?.points ?? [];
  const spanMs =
    points.length >= 2
      ? new Date(points[points.length - 1].t).getTime() - new Date(points[0].t).getTime()
      : 0;
  const cumNetPnlLabel = t("evaluation.metric.cumNetPnl");
  const cumAlphaLabel = t("evaluation.metric.cumAlpha");

  const secondary: Array<[string, string, string?]> = [
    [t("evaluation.metric.turnover"), fmt.usd(m.turnover, 0)],
    [t("evaluation.metric.fillsPerDay"), m.fillsPerDay.toFixed(1)],
    [t("evaluation.metric.netPositionChange"), fmt.coin(m.netPositionChange)],
    [t("evaluation.metric.funding"), fmt.signed(m.funding), t("evaluation.tip.funding")],
    [t("evaluation.metric.feeToGross"), m.feeToGross == null ? "—" : fmt.pct(m.feeToGross, 1)],
    [t("evaluation.metric.unrealizedPnl"), m.unrealizedPnl == null ? "—" : fmt.signed(m.unrealizedPnl)],
  ];

  return (
    <Card style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>
          {fmt.exchangeName(entry.exchange)} · {entry.symbol} · {entry.runCode}
        </div>
        {/* 色点图例：沿用 dashboard 权益曲线的 legend 模式 */}
        <div style={{ display: "flex", gap: 12, fontSize: 11 }}>
          {[
            { color: "var(--accent)", label: cumNetPnlLabel },
            { color: "var(--alpha)", label: cumAlphaLabel },
          ].map((l) => (
            <span key={l.label} style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--fg-1)" }}>
              <span style={{ width: 9, height: 3, borderRadius: 2, background: l.color, display: "inline-block" }} />{l.label}
            </span>
          ))}
        </div>
      </div>

      <div style={{ width: "100%", height: 220, padding: "8px 8px 0" }}>
        {/* 固定像素高度（容器 220 − 顶部内边距 8）避免 recharts 首帧 height(-1)。 */}
        <ResponsiveContainer width="100%" height={212}>
          <ComposedChart data={points} margin={{ top: 8, right: 4, bottom: 0, left: 4 }}>
            <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="2 4" vertical={false} />
            <XAxis
              dataKey="t"
              tickFormatter={(iso: string) => formatTime(iso, spanMs)}
              tick={{ fontSize: 10, fill: "var(--fg-3)" }}
              axisLine={false}
              tickLine={false}
              minTickGap={xAxisMinTickGap(spanMs)}
            />
            <YAxis
              domain={["auto", "auto"]}
              tick={{ fontSize: 10, fill: "var(--fg-3)" }}
              axisLine={false}
              tickLine={false}
              width={56}
              tickFormatter={(v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            />
            <Tooltip
              contentStyle={{
                background: "var(--bg-1)",
                border: "1px solid var(--border-subtle)",
                borderRadius: 8,
                fontSize: 11,
              }}
              labelFormatter={(label) => new Date(String(label)).toLocaleString()}
              formatter={(value, name) => [fmt.signed(Number(value)), String(name)]}
            />
            <Line
              type="monotone"
              dataKey="cumNetPnl"
              name={cumNetPnlLabel}
              stroke="var(--accent)"
              strokeWidth={1.5}
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="cumAlpha"
              name={cumAlphaLabel}
              stroke="var(--alpha)"
              strokeWidth={1.5}
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        {secondary.map(([label, value, tip]) => (
          <div key={label}>
            <div style={{ fontSize: 10.5, color: "var(--fg-2)", textTransform: "uppercase", letterSpacing: 0.9, fontWeight: 600 }} title={tip}>{label}</div>
            <div className="num" style={{ fontSize: 14, fontWeight: 600, marginTop: 2 }}>{value}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}
