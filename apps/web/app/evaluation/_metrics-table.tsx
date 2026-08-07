"use client";

import React from "react";
import { fmt } from "@/lib/store";
import { useLang } from "@/lib/i18n-context";
import type { RobotMetricsEntry } from "@/lib/api";
import { TableScroll } from "@/components/ui/table-scroll";

const isMissing = (v: number | null | undefined) => v == null;

export function RobotMetricsTable({
  robots,
  selectedId,
  onSelect,
}: {
  robots: RobotMetricsEntry[];
  selectedId: string | null;
  onSelect: (robotId: string) => void;
}) {
  const { t } = useLang();
  const th: React.CSSProperties = {
    textAlign: "right", fontSize: 10.5, color: "var(--fg-2)", textTransform: "uppercase",
    letterSpacing: 0.9, fontWeight: 600, padding: "6px 10px", whiteSpace: "nowrap",
  };
  const td: React.CSSProperties = { textAlign: "right", padding: "8px 10px", fontSize: 13, whiteSpace: "nowrap" };

  return (
    <TableScroll>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={{ ...th, textAlign: "left" }}>{t("evaluation.col.exchange")}</th>
            <th style={th}>{t("evaluation.metric.netPnl")}</th>
            <th style={th}>{t("evaluation.metric.alpha")}</th>
            <th style={th} title={t("evaluation.tip.winRate")}>{t("evaluation.metric.winRate")}</th>
            <th style={th}>{t("evaluation.metric.avgPnlPerFill")}</th>
            <th style={th}>{t("evaluation.metric.feeRateBp")}</th>
            <th style={th}>{t("evaluation.metric.gridCoverage")}</th>
            <th style={th}>{t("evaluation.metric.maxDrawdown")}</th>
            <th style={th}>{t("evaluation.metric.netExposure")}</th>
            <th style={th}>{t("evaluation.col.dataQuality")}</th>
          </tr>
        </thead>
        <tbody>
          {robots.map((r) => (
            <tr
              key={r.robotId}
              onClick={() => onSelect(r.robotId)}
              style={{
                cursor: "pointer",
                background: r.robotId === selectedId ? "var(--bg-2)" : undefined,
                borderTop: "1px solid var(--border-subtle)",
              }}
            >
              <td style={{ ...td, textAlign: "left" }}>{fmt.exchangeName(r.exchange)}</td>
              <td className="num" style={{ ...td, color: r.metrics.netPnl >= 0 ? "var(--up)" : "var(--down)" }}>{fmt.signed(r.metrics.netPnl)}</td>
              <td className="num" style={td}>{fmt.signed(r.metrics.alpha)}</td>
              <td className="num" style={td}>{fmt.pct(r.metrics.winRate)}</td>
              <td className="num" style={td}>{isMissing(r.metrics.avgPnlPerFill) ? "—" : fmt.signed(r.metrics.avgPnlPerFill, 4)}</td>
              <td className="num" style={td}>{r.metrics.feeRateBp.toFixed(2)} bp</td>
              <td className="num" style={td}>{isMissing(r.metrics.gridCoverage) ? "—" : fmt.pct(r.metrics.gridCoverage, 1)}</td>
              <td className="num" style={td}>{isMissing(r.metrics.maxDrawdown) ? "—" : fmt.usd(r.metrics.maxDrawdown)}</td>
              <td className="num" style={td}>{isMissing(r.metrics.netExposure) ? "—" : fmt.usd(r.metrics.netExposure, 0)}</td>
              <td style={{ ...td, color: "var(--fg-2)" }}>
                {r.dataQuality.fills} {t("evaluation.col.fills")}
                {!r.dataQuality.windowCovered && ` · ${t("evaluation.col.partialWindow")}`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableScroll>
  );
}
