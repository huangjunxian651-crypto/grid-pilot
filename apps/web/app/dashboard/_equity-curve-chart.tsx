"use client";

// P2-1 权益曲线图表：权益 Area(左轴) + 累计 Alpha Line(右轴)。
// 两者量级差 ~100×，必须双轴；缺失桶为 undefined，经 connectNulls 桥接保证两序列
// 时间范围不重叠时曲线仍连续（评审 I-2 修正：connectNulls 是桥接而非断点）。
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import type { MergedPoint } from "@/lib/equity-curve-data";

function formatTime(t: number, spanMs: number): string {
  const d = new Date(t);
  if (spanMs > 3 * 24 * 3600_000) {
    return `${d.getMonth() + 1}/${d.getDate()}`;
  }
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function EquityCurveChart({
  data,
  equityLabel,
  alphaLabel,
}: {
  data: MergedPoint[];
  equityLabel: string;
  alphaLabel: string;
}) {
  const spanMs = data.length >= 2 ? data[data.length - 1].t - data[0].t : 0;
  return (
    <div style={{ width: "100%", height: 220, padding: "8px 8px 0" }}>
      {/* 固定像素高度（容器 220 − 顶部内边距 8）避免 recharts 首帧因父高未量到而报 height(-1)。 */}
      <ResponsiveContainer width="100%" height={212}>
        <ComposedChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 4 }}>
          <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="2 4" vertical={false} />
          <XAxis
            dataKey="t"
            type="number"
            domain={["dataMin", "dataMax"]}
            tickFormatter={(t: number) => formatTime(t, spanMs)}
            tick={{ fontSize: 10, fill: "var(--fg-3)" }}
            axisLine={false}
            tickLine={false}
            minTickGap={48}
          />
          <YAxis
            yAxisId="equity"
            orientation="left"
            domain={["auto", "auto"]}
            tick={{ fontSize: 10, fill: "var(--fg-3)" }}
            axisLine={false}
            tickLine={false}
            width={56}
            tickFormatter={(v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          />
          <YAxis
            yAxisId="alpha"
            orientation="right"
            domain={["auto", "auto"]}
            tick={{ fontSize: 10, fill: "var(--alpha)" }}
            axisLine={false}
            tickLine={false}
            width={44}
            tickFormatter={(v: number) => v.toFixed(1)}
          />
          <Tooltip
            contentStyle={{
              background: "var(--bg-1)",
              border: "1px solid var(--border-subtle)",
              borderRadius: 8,
              fontSize: 11,
            }}
            labelFormatter={(label) => new Date(Number(label)).toLocaleString()}
            formatter={(value, name) => [
              String(name) === equityLabel
                ? `$${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}`
                : `$${Number(value).toFixed(4)}`,
              String(name),
            ]}
          />
          <Area
            yAxisId="equity"
            type="monotone"
            dataKey="equity"
            name={equityLabel}
            stroke="var(--accent)"
            fill="var(--accent)"
            fillOpacity={0.08}
            strokeWidth={1.5}
            dot={false}
            connectNulls
          />
          <Line
            yAxisId="alpha"
            type="monotone"
            dataKey="alpha"
            name={alphaLabel}
            stroke="var(--alpha)"
            strokeWidth={1.5}
            dot={false}
            connectNulls
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
