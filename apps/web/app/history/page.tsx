"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { Shell } from "@/components/shell/shell";
import { useLang } from "@/lib/i18n-context";
import { useRobots, useEvents } from "@/lib/hooks/useBots";
import { Card, Button } from "@/components/ui/primitives";
import { Icons } from "@/components/ui/icons";
import { TermHelp } from "@/components/ui/term-help";
import { estimateRebate, isReferralMuted } from "@/lib/referral";
import { toast } from "sonner";

type RangeKey = "7D" | "30D" | "90D" | "ALL";

const RANGE_DAYS: Record<RangeKey, number | null> = {
  "7D": 7,
  "30D": 30,
  "90D": 90,
  ALL: null,
};

// ── 内联 SVG（设计稿专属，icons.tsx 无对应项）────────────────
function CaretRight({ size = 9 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M6 3l5 5-5 5" />
    </svg>
  );
}

// ── KPI 瓦片（对齐设计稿：10px uppercase 标签 / 22px mono 数字）──
function KpiTile({
  label,
  labelHelp,
  value,
  sub,
  subNode,
  tone = "default",
  highlight,
  onClick,
  testId,
}: {
  label: string;
  labelHelp?: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  subNode?: React.ReactNode;
  tone?: "default" | "up" | "down" | "alpha" | "maker";
  highlight?: boolean;
  onClick?: () => void;
  testId?: string;
}) {
  const valueColor =
    tone === "up" ? "var(--up)" :
    tone === "down" ? "var(--down)" :
    tone === "alpha" ? "var(--alpha)" :
    tone === "maker" ? "var(--maker)" :
    "var(--fg-0)";
  return (
    <div
      data-testid={testId}
      onClick={onClick}
      style={{
        position: "relative",
        overflow: "hidden",
        background: highlight ? "var(--alpha-tint)" : "var(--bg-1)",
        border: `1px solid ${highlight ? "var(--alpha-tint-strong)" : "var(--border-subtle)"}`,
        borderRadius: 12,
        padding: "14px 15px",
        cursor: onClick ? "pointer" : "default",
      }}
    >
      {highlight && (
        <div style={{ position: "absolute", top: 0, right: 0, width: 80, height: 80, background: "radial-gradient(circle, var(--alpha) 0%, transparent 70%)", opacity: 0.1, pointerEvents: "none" }} />
      )}
      <div style={{ fontSize: 10, color: highlight ? "var(--alpha)" : "var(--fg-2)", textTransform: "uppercase", letterSpacing: 0.7, fontWeight: 600, display: "inline-flex", alignItems: "center" }}>{label}{labelHelp && <TermHelp term={labelHelp} title={label} />}</div>
      <div className="num" style={{ fontSize: 22, fontWeight: 600, marginTop: 6, color: valueColor, letterSpacing: -0.5 }}>{value}</div>
      {subNode
        ? <div style={{ marginTop: 2 }}>{subNode}</div>
        : sub != null && <div style={{ fontSize: 10.5, color: "var(--fg-3)", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

export default function TradeHistoryPage() {
  const { t } = useLang();
  const router = useRouter();
  const { data: robots } = useRobots();
  const { data: events } = useEvents({ type: "FILL", limit: 100 });

  const [range, setRange] = React.useState<RangeKey>("7D");

  const handleExportCSV = () => {
    toast.info(t("dash.export_coming_soon"));
  };

  type FillData = {
    orderId?: string;
    fillQty?: number;
    fillPrice?: number;
    side?: string;
    gridIndex?: number;
    fee?: number;
    savings?: number;
    route?: string;
    realizedPnlDelta?: number;
  };

  const allFills = events?.data ?? [];

  // 客户端范围过滤（7D/30D/90D/ALL）。ALL 不裁剪。
  const fills = React.useMemo(() => {
    const days = RANGE_DAYS[range];
    if (days == null) return allFills;
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    return allFills.filter((ev) => new Date(ev.createdAt).getTime() >= cutoff);
  }, [allFills, range]);

  // ── 汇总（接真实数据）──────────────────────────────────────
  const totalFills = fills.length;
  const totalFee = fills.reduce((s, ev) => s + ((ev.eventData as FillData).fee ?? 0), 0);
  const totalSavings = fills.reduce((s, ev) => s + ((ev.eventData as FillData).savings ?? 0), 0);
  const totalRealizedPnl = fills.reduce((s, ev) => s + ((ev.eventData as FillData).realizedPnlDelta ?? 0), 0);
  const makerFills = fills.filter((ev) => ((ev.eventData as FillData).route ?? "POC") === "POC").length;
  const gtcCaptures = fills.filter((ev) => ((ev.eventData as FillData).route ?? "POC") === "GTC").length;
  const makerPct = totalFills > 0 ? Math.round((makerFills / totalFills) * 100) : 0;
  const botCount = robots?.length ?? 0;

  // ── 返佣引导（已付手续费 KPI 内）──────────────────────────
  // 按各机器人所在交易所比例汇总可返金额（与 dashboard 一致）。
  const rebateEstimate = (robots ?? []).reduce((s, r) => s + estimateRebate(r.exchangeId, r.totalFees || 0), 0);
  const showRebateNudge = !isReferralMuted() && rebateEstimate > 0.01;

  const segments: RangeKey[] = ["7D", "30D", "90D", "ALL"];

  return (
    <Shell breadcrumb={[t("nav.history")]}>
      {/* 页头 */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, marginBottom: 20, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontFamily: "var(--font-display)", fontSize: 23, fontWeight: 600, letterSpacing: -0.6, marginBottom: 4 }}>{t("hist.title")}</h1>
          <p style={{ fontSize: 13, color: "var(--fg-2)" }}>{t("hist.subtitle")}</p>
        </div>
        <Button variant="outline" size="md" icon={<Icons.Download size={14} />} onClick={handleExportCSV}>{t("common.export_csv")}</Button>
      </div>

      {/* 6 KPI */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6" style={{ gap: 12, marginBottom: 18 }}>
        <KpiTile
          label={t("hist.total_fills_30d")}
          value={totalFills.toLocaleString("en-US")}
          sub={t("hist.across_bots", { n: botCount })}
          testId="kpi-total-fills"
        />
        <KpiTile
          label={t("hist.maker_fills")}
          value={makerFills.toLocaleString("en-US")}
          sub={t("hist.poc_route_pct", { pct: makerPct })}
          tone="maker"
          testId="kpi-maker-fills"
        />
        <KpiTile
          label={t("hist.gtc_captures")}
          value={gtcCaptures.toLocaleString("en-US")}
          sub={t("hist.excess_triggers")}
          tone="alpha"
          testId="kpi-gtc"
        />
        <KpiTile
          label={t("hist.total_alpha")}
          value={`$${totalSavings.toFixed(2)}`}
          sub={t("hist.alpha_breakdown")}
          tone="alpha"
          highlight
          testId="kpi-alpha"
        />
        <KpiTile
          label={t("hist.fees_paid")}
          labelHelp="fee"
          value={`$${totalFee.toFixed(2)}`}
          onClick={() => router.push("/learn/fees")}
          testId="kpi-fees"
          subNode={
            showRebateNudge ? (
              <div data-testid="hist-rebate-nudge" style={{ fontSize: 10.5, color: "var(--alpha)", display: "flex", alignItems: "center", gap: 3 }}>
                {t("hist.rebate_nudge", { rebate: rebateEstimate.toFixed(0) })}
                <CaretRight size={9} />
              </div>
            ) : (
              <span style={{ fontSize: 10.5, color: "var(--fg-3)" }}>{t("hist.fees_period")}</span>
            )
          }
        />
        <KpiTile
          label={t("hist.total_realized_pnl")}
          value={`${totalRealizedPnl >= 0 ? "+" : ""}$${totalRealizedPnl.toFixed(2)}`}
          sub={t("hist.fees_period")}
          tone={totalRealizedPnl >= 0 ? "up" : "down"}
          testId="kpi-realized-pnl"
        />
      </div>

      {/* 过滤器：搜索 + 下拉 + 范围分段 */}
      <div style={{ display: "flex", gap: 9, marginBottom: 14, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 12px", height: 36, background: "var(--bg-1)", border: "1px solid var(--border-default)", borderRadius: 9, flex: 1, minWidth: 160, fontSize: 12, color: "var(--fg-3)" }}>
          <Icons.Search size={13} />
          <span>{t("hist.placeholder")}</span>
        </div>
        <div className="gp-hide-mobile" style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "0 13px", height: 36, background: "var(--bg-1)", border: "1px solid var(--border-default)", borderRadius: 9, fontSize: 12, whiteSpace: "nowrap" }}>
          {t("hist.all_bots")} <Icons.ChevronDown size={11} style={{ color: "var(--fg-3)" }} />
        </div>
        <div className="gp-hide-mobile" style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "0 13px", height: 36, background: "var(--bg-1)", border: "1px solid var(--border-default)", borderRadius: 9, fontSize: 12, whiteSpace: "nowrap" }}>
          {t("hist.all_routes")} <Icons.ChevronDown size={11} style={{ color: "var(--fg-3)" }} />
        </div>
        {/* 时间范围分段切换 */}
        <div data-testid="hist-range-seg" style={{ display: "inline-flex", alignItems: "center", height: 36, background: "var(--bg-1)", border: "1px solid var(--border-default)", borderRadius: 9, padding: 2, gap: 2 }}>
          {segments.map((seg) => {
            const active = range === seg;
            return (
              <button
                key={seg}
                data-testid={`hist-range-${seg}`}
                onClick={() => setRange(seg)}
                style={{
                  height: 30, padding: "0 11px", fontSize: 12, fontWeight: 500,
                  border: "none", borderRadius: 7, cursor: "pointer",
                  background: active ? "var(--bg-3)" : "transparent",
                  color: active ? "var(--fg-0)" : "var(--fg-2)",
                  fontFamily: "var(--font-sans)",
                }}
              >
                {seg === "ALL" ? t("hist.range_all") : seg}
              </button>
            );
          })}
        </div>
      </div>

      {/* 成交流水表 */}
      <Card pad={0} style={{ borderRadius: 14 }}>
        <div className="gp-table-scroll">
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ color: "var(--fg-3)", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.6 }}>
                {[
                  { k: t("hist.col_time"), a: "left" },
                  { k: t("hist.col_bot"), a: "left" },
                  { k: t("hist.col_side"), a: "left" },
                  { k: t("hist.col_grid"), a: "right" },
                  { k: t("hist.col_price"), a: "right" },
                  { k: t("hist.col_qty"), a: "right" },
                  { k: t("hist.col_notional"), a: "right" },
                  { k: t("hist.col_route"), a: "center" },
                  { k: t("hist.col_fee"), a: "right", help: "fee" },
                  { k: t("hist.col_alpha"), a: "right", help: "alpha" },
                  { k: t("hist.col_realized_pnl"), a: "right" },
                ].map((h, i, arr) => (
                  <th key={i} style={{ padding: i === 0 || i === arr.length - 1 ? "10px 16px" : "10px 8px", textAlign: h.a as React.CSSProperties["textAlign"], fontWeight: 600, whiteSpace: "nowrap" }}>
                    <span style={{ display: "inline-flex", alignItems: "center" }}>{h.k}{h.help && <TermHelp term={h.help} title={h.k} />}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody style={{ fontSize: 12 }}>
              {fills.length === 0 && (
                <tr>
                  <td colSpan={11} style={{ padding: "40px 16px", textAlign: "center", color: "var(--fg-3)", fontSize: 13 }}>
                    {t("hist.no_data")}
                  </td>
                </tr>
              )}
              {fills.map((ev) => {
                const d = ev.eventData as FillData;
                const ts = new Date(ev.createdAt).toLocaleString();
                const symbol = ev.symbol ?? "—";
                const isBuy = (d.side ?? "").toUpperCase() === "BUY";
                const sideColor = isBuy ? "var(--up)" : "var(--down)";
                const notional = d.fillQty && d.fillPrice ? d.fillQty * d.fillPrice : null;
                const route = d.route ?? "POC";
                const isMaker = route === "POC";
                const pnl = d.realizedPnlDelta;
                return (
                  <tr
                    key={ev.id}
                    data-testid="hist-row"
                    onClick={() => router.push("/learn/fees")}
                    style={{ borderTop: "1px solid var(--border-subtle)", cursor: "pointer" }}
                  >
                    <td style={{ padding: "10px 16px", whiteSpace: "nowrap", color: "var(--fg-2)", fontFamily: "var(--font-mono)", fontSize: 11 }}>{ts}</td>
                    <td style={{ padding: "10px 8px", fontWeight: 500 }}>{symbol}</td>
                    <td style={{ padding: "10px 8px" }}><span style={{ color: sideColor, fontWeight: 600 }}>{d.side ?? "—"}</span></td>
                    <td className="num" style={{ padding: "10px 8px", textAlign: "right", color: "var(--fg-3)" }}>{typeof d.gridIndex === "number" && d.gridIndex >= 0 ? `G${d.gridIndex}` : "—"}</td>
                    <td className="num" style={{ padding: "10px 8px", textAlign: "right", color: sideColor }}>{d.fillPrice?.toFixed(2) ?? "—"}</td>
                    <td className="num" style={{ padding: "10px 8px", textAlign: "right" }}>{d.fillQty?.toFixed(4) ?? "—"}</td>
                    <td className="num" style={{ padding: "10px 8px", textAlign: "right", color: "var(--fg-2)" }}>{notional?.toFixed(2) ?? "—"}</td>
                    <td style={{ padding: "10px 8px", textAlign: "center" }}>
                      <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 3, color: isMaker ? "var(--maker)" : "var(--taker)", background: isMaker ? "var(--maker-tint)" : "var(--taker-tint)" }}>{route}</span>
                    </td>
                    <td className="num" style={{ padding: "10px 8px", textAlign: "right", color: "var(--fg-3)" }}>${(d.fee ?? 0).toFixed(4)}</td>
                    <td className="num" style={{ padding: "10px 8px", textAlign: "right", color: "var(--alpha)" }}>${(d.savings ?? 0).toFixed(4)}</td>
                    <td className="num" style={{ padding: "10px 16px", textAlign: "right", color: pnl != null && pnl >= 0 ? "var(--up)" : pnl != null ? "var(--down)" : "var(--fg-3)" }}>
                      {pnl != null ? `${pnl >= 0 ? "+" : ""}${pnl.toFixed(4)}` : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </Shell>
  );
}
