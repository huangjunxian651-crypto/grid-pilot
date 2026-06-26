"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { Shell } from "@/components/shell/shell";
import { useLang } from "@/lib/i18n-context";
import { fmt, useAccountStore, aggregateSnapshots } from "@/lib/store";
import { useRobots, useDashboard, useEvents, useEquityHistory, useSavingsHistory } from "@/lib/hooks/useBots";
import type { HistoryRange } from "@/lib/api";
import { mergeHistorySeries } from "@/lib/equity-curve-data";
import { EquityCurveChart } from "./_equity-curve-chart";
import { Card, Button, FsmPill, PriceTicker, ExchangeMark } from "@/components/ui/primitives";
import { Icons } from "@/components/ui/icons";
import { toast } from "sonner";
import { useCredentials } from "@/lib/hooks/useCredentials";
import { getAccounts } from "@/lib/api";
import { estimateRebate, isReferralMuted } from "@/lib/referral";

// ── 小节标签（uppercase mono 风格，照搬设计稿 10.5px / letter-spacing 0.9） ──
function SectionLabel({ children, color = "var(--fg-2)" }: { children: React.ReactNode; color?: string }) {
  return (
    <span style={{ fontSize: 10.5, color, textTransform: "uppercase", letterSpacing: 0.9, fontWeight: 600 }}>
      {children}
    </span>
  );
}

// 设计稿星形 Alpha 图标（icons.tsx 无此 path，就地内联）
function StarIcon({ size = 12, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={color} strokeWidth={1.5}>
      <path d="M8 1.6l1.5 3.4 3.7.3-2.8 2.4.9 3.6L8 13l-3.2 1.9.9-3.6L2.9 5.3l3.7-.3z" />
    </svg>
  );
}

function relativeTime(iso: string, lang: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return lang === "zh" ? "刚刚" : "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

// ── KPI 卡（普通） ─────────────────────────────────────────────
function KpiCard({
  icon,
  label,
  value,
  valueColor = "var(--fg-0)",
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  valueColor?: string;
  sub?: React.ReactNode;
}) {
  return (
    <div style={{ background: "var(--bg-1)", border: "1px solid var(--border-subtle)", borderRadius: 14, padding: "16px 17px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ color: "var(--fg-2)", display: "inline-flex" }}>{icon}</span>
        <SectionLabel>{label}</SectionLabel>
      </div>
      <div className="num" style={{ fontSize: 30, fontWeight: 600, color: valueColor, letterSpacing: -1, marginTop: 8 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "var(--fg-2)", marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

// ── KPI 卡（Alpha hero 渐变） ──────────────────────────────────
function AlphaHeroKpi({ value, valueColor, sub }: { value: React.ReactNode; valueColor: string; sub: string }) {
  const { t } = useLang();
  return (
    <div
      data-testid="kpi-alpha-hero"
      style={{
        position: "relative", overflow: "hidden",
        background: "linear-gradient(150deg, var(--alpha-tint) 0%, var(--bg-1) 55%)",
        border: "1px solid var(--alpha-tint-strong)", borderRadius: 14, padding: "16px 17px",
      }}
    >
      <div style={{ position: "absolute", top: -30, right: -30, width: 120, height: 120, borderRadius: "50%", background: "radial-gradient(circle, var(--alpha) 0%, transparent 70%)", opacity: 0.16, pointerEvents: "none" }} />
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ color: "var(--alpha)", display: "inline-flex" }}><StarIcon size={12} /></span>
        <SectionLabel color="var(--alpha)">{t("dash.kpi_cum_alpha")}</SectionLabel>
      </div>
      <div className="num" style={{ fontSize: 27, fontWeight: 600, color: valueColor, letterSpacing: -1, marginTop: 8, whiteSpace: "nowrap" }}>{value}</div>
      <div style={{ fontSize: 11, color: "var(--fg-2)", marginTop: 4 }}>{sub}</div>
    </div>
  );
}

function LiveFillsCard() {
  const { t, lang } = useLang();
  const queryClient = useQueryClient();
  const { data } = useEvents({ type: "FILL", limit: 50 });

  useEffect(() => {
    const id = setInterval(() => {
      queryClient.invalidateQueries({ queryKey: ["events", { type: "FILL", limit: 50 }] });
    }, 30000);
    return () => clearInterval(id);
  }, [queryClient]);

  const fills = data?.data ?? [];

  return (
    <Card pad={0} style={{ display: "flex", flexDirection: "column", borderRadius: 14, overflow: "hidden" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "13px 16px", borderBottom: "1px solid var(--border-subtle)" }}>
        <SectionLabel>{t("dash.live_fills_short")}</SectionLabel>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 10.5, color: "var(--fg-3)" }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--up)" }} />LIVE
        </span>
      </div>
      {fills.length === 0 ? (
        <div style={{ padding: 24, textAlign: "center", color: "var(--fg-3)", fontSize: 13 }}>
          {t("dash.no_fills")}
        </div>
      ) : (
        <div style={{ flex: 1, overflowY: "auto", maxHeight: 320 }}>
          {fills.map((ev) => {
            const d = ev.eventData;
            const side = d.side as string;
            const qty = Number(d.fillQty ?? 0);
            const price = Number(d.fillPrice ?? 0);
            const isBuy = side === "BUY";
            const sideColor = side ? (isBuy ? "var(--up)" : "var(--down)") : "var(--fg-2)";
            const sideBg = side ? (isBuy ? "var(--up-tint)" : "var(--down-tint)") : "var(--bg-3)";
            return (
              <div key={ev.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 16px", borderTop: "1px solid var(--border-subtle)", fontSize: 11.5 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
                  <span style={{ fontSize: 9.5, fontWeight: 700, padding: "2px 6px", borderRadius: 4, color: sideColor, background: sideBg }}>{side ?? "—"}</span>
                  <span style={{ fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{ev.symbol}</span>
                  <span className="num" style={{ fontSize: 10.5, color: "var(--fg-2)" }}>{ev.direction}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 11, flexShrink: 0 }}>
                  <span className="num" style={{ color: "var(--fg-1)" }}>{qty.toFixed(4)}</span>
                  <span className="num" style={{ color: "var(--fg-2)" }}>@ {price.toFixed(2)}</span>
                  <span style={{ fontSize: 10, color: "var(--fg-3)", minWidth: 36, textAlign: "right" }}>{relativeTime(ev.createdAt, lang)}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

// ── Alpha 引擎卡（右栏，渐变；接真实累计 Alpha） ─────────────────
function AlphaEngineCard({ cumAlpha, hasData, rangeLabel }: { cumAlpha: number; hasData: boolean; rangeLabel: string }) {
  const { t } = useLang();
  return (
    <div
      data-testid="alpha-engine"
      style={{
        position: "relative", overflow: "hidden",
        background: "linear-gradient(160deg, var(--alpha-tint) 0%, var(--bg-1) 60%)",
        border: "1px solid var(--alpha-tint-strong)", borderRadius: 14, padding: 17,
      }}
    >
      <div style={{ position: "absolute", top: -25, right: -25, width: 140, height: 140, borderRadius: "50%", background: "radial-gradient(circle, var(--alpha) 0%, transparent 70%)", opacity: 0.13, pointerEvents: "none" }} />
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ color: "var(--alpha)", display: "inline-flex" }}><StarIcon size={12} /></span>
        <SectionLabel color="var(--alpha)">{t("dash.alpha_engine")} · {rangeLabel}</SectionLabel>
      </div>
      {hasData ? (
        <>
          <div className="num" style={{ fontSize: 34, fontWeight: 600, color: cumAlpha >= 0 ? "var(--alpha)" : "var(--down)", letterSpacing: -1.2, marginTop: 10 }}>
            {cumAlpha >= 0 ? "+" : "−"}${Math.abs(cumAlpha).toFixed(2)}
          </div>
          <div style={{ fontSize: 11.5, color: "var(--fg-2)", marginTop: 3 }}>{t("dash.alpha_engine_desc")}</div>
        </>
      ) : (
        <div style={{ color: "var(--fg-3)", fontSize: 13, padding: "18px 0 6px" }}>{t("dash.no_alpha_data")}</div>
      )}
    </div>
  );
}

// ── 资金分布卡（右栏；接真实快照 + 返佣 nudge） ─────────────────
const EXCHANGE_BAR_COLORS: Record<string, string> = {
  binance: "#f0b90b",
  gateio: "#2354e6",
  okx: "var(--fg-2)",
};

function FundDistributionCard() {
  const { t } = useLang();
  const snapshots = useAccountStore((s) => s.snapshots);
  const { data: creds } = useCredentials();
  const { data: robots } = useRobots();

  const credMap = useMemo(() => new Map(creds?.map((c) => [c.id, c]) ?? []), [creds]);
  const agg = aggregateSnapshots(snapshots);

  // 每交易所聚合权益 + 机器人数（真实）
  const perExchange = useMemo(() => {
    const map = new Map<string, { equity: number; bots: number }>();
    for (const snap of snapshots) {
      const exId = credMap.get(snap.credentialId)?.exchangeId ?? "binance";
      const cur = map.get(exId) ?? { equity: 0, bots: 0 };
      cur.equity += snap.totalEquity;
      map.set(exId, cur);
    }
    for (const r of robots ?? []) {
      if (r.status === "STOPPED") continue;
      const cur = map.get(r.exchangeId) ?? { equity: 0, bots: 0 };
      cur.bots += 1;
      map.set(r.exchangeId, cur);
    }
    return [...map.entries()].sort((a, b) => b[1].equity - a[1].equity);
  }, [snapshots, credMap, robots]);

  const totalExchangeEquity = perExchange.reduce((s, [, v]) => s + v.equity, 0);

  // 净持仓敞口（真实，跨快照按 symbol 汇总）
  const netExposure = useMemo(() => {
    let qty = 0, value = 0, symbol = "";
    for (const snap of snapshots) {
      for (const pos of snap.positions) {
        const signed = pos.side === "LONG" ? pos.qty : -pos.qty;
        qty += signed;
        value += pos.qty * pos.markPrice;
        symbol = pos.symbol;
      }
    }
    return { qty, value, symbol };
  }, [snapshots]);

  const marginPct = agg.totalEquity > 0 ? Math.min(100, (agg.marginUsed / agg.totalEquity) * 100) : 0;

  // 返佣 nudge（真实：从手续费推算月度可省）
  const monthlyRebate = useMemo(() => {
    if (isReferralMuted()) return 0;
    return (robots ?? []).reduce((s, r) => s + estimateRebate(r.exchangeId, r.totalFees || 0), 0);
  }, [robots]);

  const hasData = snapshots.length > 0;

  return (
    <Card pad={0} style={{ borderRadius: 14, overflow: "hidden" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "13px 16px", borderBottom: "1px solid var(--border-subtle)" }}>
        <SectionLabel>{t("dash.fund_distribution")}</SectionLabel>
        <span className="num" style={{ fontSize: 10.5, color: "var(--fg-3)" }}>{perExchange.length} {t("dash.exchanges_count")}</span>
      </div>
      <div style={{ padding: 16 }}>
        {!hasData ? (
          <div style={{ fontSize: 12, color: "var(--fg-3)", textAlign: "center", padding: 12 }}>{t("shell.connect_exchange")}</div>
        ) : (
          <>
            {/* 净持仓敞口 + 敞口价值 */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 14 }}>
              <div>
                <div style={{ fontSize: 10, color: "var(--fg-3)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 }}>{t("dash.net_exposure")}</div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 7 }}>
                  <span className="num" style={{ fontSize: 21, fontWeight: 600, letterSpacing: -0.5, color: "var(--fg-0)" }}>{netExposure.qty.toFixed(3)}</span>
                  {netExposure.symbol && (
                    <span style={{ fontSize: 12, color: "var(--fg-2)" }}>
                      {netExposure.symbol.replace(/\/?USDT$/i, "")} {netExposure.qty >= 0 ? t("dash.side_long") : t("dash.side_short")}
                    </span>
                  )}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 10, color: "var(--fg-3)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 }}>{t("dash.exposure_value")}</div>
                <div className="num" style={{ fontSize: 15, fontWeight: 600, color: "var(--fg-0)" }}>${fmt.usd(netExposure.value, 0)}</div>
              </div>
            </div>

            {/* 交易所占比条 */}
            {totalExchangeEquity > 0 && (
              <div style={{ display: "flex", height: 8, borderRadius: 4, overflow: "hidden", marginBottom: 13, background: "var(--bg-3)" }}>
                {perExchange.map(([exId, v]) => (
                  <div key={exId} style={{ flex: Math.max(0.0001, v.equity), background: EXCHANGE_BAR_COLORS[exId] ?? "var(--fg-2)" }} />
                ))}
              </div>
            )}

            {/* 每交易所行 */}
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {perExchange.map(([exId, v]) => (
                <div key={exId} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: EXCHANGE_BAR_COLORS[exId] ?? "var(--fg-2)", flexShrink: 0 }} />
                  <ExchangeMark exchange={exId} size={15} />
                  <span style={{ flex: 1, fontSize: 12, color: "var(--fg-1)" }}>{fmt.exchangeName(exId)}</span>
                  <span className="num" style={{ fontSize: 10.5, color: "var(--fg-3)" }}>{v.bots} {t("dash.bots_count")}</span>
                  <span className="num" style={{ fontSize: 12, fontWeight: 500, width: 70, textAlign: "right" }}>${fmt.usd(v.equity, 0)}</span>
                </div>
              ))}
            </div>

            {/* 保证金使用 */}
            <div style={{ marginTop: 15, paddingTop: 14, borderTop: "1px solid var(--border-subtle)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 7 }}>
                <span style={{ color: "var(--fg-2)" }}>{t("kpi.margin_used")}</span>
                <span className="num" style={{ color: "var(--fg-1)" }}>${fmt.usd(agg.marginUsed, 0)} / {marginPct.toFixed(0)}%</span>
              </div>
              <div style={{ height: 6, background: "var(--bg-3)", borderRadius: 3, overflow: "hidden" }}>
                <div style={{ width: `${marginPct}%`, height: "100%", background: "linear-gradient(90deg, var(--accent), var(--accent-hi))" }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, color: "var(--fg-3)", marginTop: 6 }}>
                <span>{t("shell.available")} <span className="num">{fmt.usd(agg.availableUsdt, 0)}</span> USDT</span>
                <span>{marginPct < 70 ? t("dash.health_good") : t("dash.health_watch")}</span>
              </div>

              {/* 返佣 nudge（保留 data-testid="rebate-total"） */}
              {monthlyRebate > 0 && (
                <Link
                  href="/learn/fees"
                  data-testid="rebate-total"
                  style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 12, paddingTop: 11, borderTop: "1px solid var(--border-subtle)", cursor: "pointer", textDecoration: "none" }}
                >
                  <StarIcon size={13} color="var(--alpha)" />
                  <span style={{ flex: 1, fontSize: 11, color: "var(--fg-1)" }}>
                    {t("dash.rebate_save_monthly")} <strong style={{ color: "var(--alpha)" }}>${monthlyRebate.toFixed(0)}</strong>
                  </span>
                  <span style={{ fontSize: 11, color: "var(--accent)" }}>{t("referral.rebate_cta_open")}</span>
                </Link>
              )}
            </div>
          </>
        )}
      </div>
    </Card>
  );
}

export default function DashboardPage() {
  const { t, lang } = useLang();
  const queryClient = useQueryClient();
  const { data: robots } = useRobots();
  const { data: dashboard } = useDashboard();
  const setSnapshots = useAccountStore((s) => s.setSnapshots);
  const [timeRange, setTimeRange] = useState<string>("30D");
  const historyRange = ({ "7D": "7d", "30D": "30d", "90D": "90d", ALL: "all" }[timeRange] ?? "30d") as HistoryRange;
  const { data: equityHistory } = useEquityHistory(historyRange);
  const { data: savingsHistory } = useSavingsHistory(historyRange);
  const curveData = React.useMemo(
    () => mergeHistorySeries(equityHistory?.series ?? [], savingsHistory?.series ?? []),
    [equityHistory, savingsHistory],
  );

  // 账户快照（驱动资金分布卡 + 净敞口）
  useEffect(() => {
    getAccounts().then((snaps) => setSnapshots(snaps)).catch(() => {});
  }, [setSnapshots]);

  const activeRobots = (robots ?? []).filter((r) => r.status !== "STOPPED");
  const activeCount = activeRobots.length;
  const totalRobots = (robots ?? []).length;

  // 真实累计 Alpha（savings 序列末点）
  const cumAlpha = savingsHistory && savingsHistory.series.length > 0
    ? savingsHistory.series[savingsHistory.series.length - 1].alpha
    : 0;
  const hasAlpha = !!savingsHistory && savingsHistory.series.length > 0;

  // 真实区间收益（equity 序列首末差）
  const equitySeries = equityHistory?.series ?? [];
  const periodReturn = equitySeries.length >= 2
    ? equitySeries[equitySeries.length - 1].equity - equitySeries[0].equity
    : null;

  const handleSync = () => {
    queryClient.invalidateQueries({ queryKey: ["robots"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    queryClient.invalidateQueries({ queryKey: ["equity-history"] });
    queryClient.invalidateQueries({ queryKey: ["savings-history"] });
    getAccounts().then((snaps) => setSnapshots(snaps)).catch(() => {});
    toast.success(t("common.synced"));
  };

  const handleExport = () => {
    toast.info(t("dash.export_coming_soon"));
  };

  return (
    <Shell
      breadcrumb={[t("nav.dashboard"), t("dash.overview")]}
      topbarRight={<Link href="/robots/new" style={{ textDecoration: "none" }}><Button variant="primary" size="md" icon={<Icons.Plus size={13} />}>{t("common.new_bot")}</Button></Link>}
    >
      {/* page header（设计稿：标题 23px display + 副标 + 导出/同步） */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, marginBottom: 20, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontFamily: "var(--font-display)", fontSize: 23, fontWeight: 600, letterSpacing: -0.6, marginBottom: 4 }}>{t("dash.welcome")}</h1>
          <p style={{ fontSize: 13, color: "var(--fg-2)", margin: 0 }}>
            {t("dash.welcome_sub", { n: activeCount, date: new Date().toLocaleDateString(lang === "zh" || lang === "zh-TW" ? "zh-CN" : "en-US", { weekday: "long", month: "short", day: "numeric" }) })}
          </p>
        </div>
        <div style={{ display: "flex", gap: 9, flexWrap: "wrap" }}>
          <Button variant="outline" size="md" icon={<Icons.Download size={13} />} onClick={handleExport}>{t("common.export")}</Button>
          <Button variant="ghost" size="md" icon={<Icons.Refresh size={13} />} onClick={handleSync}>{t("common.sync")}</Button>
        </div>
      </div>

      {/* KPI row（4 列：Alpha hero / 区间收益 / 活跃机器人 / 累计成交） */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3" style={{ marginBottom: 18 }}>
        <AlphaHeroKpi
          value={hasAlpha ? `${cumAlpha >= 0 ? "+" : "−"}$${Math.abs(cumAlpha).toFixed(2)}` : "—"}
          valueColor={hasAlpha ? (cumAlpha >= 0 ? "var(--alpha)" : "var(--down)") : "var(--fg-3)"}
          sub={t("dash.alpha_engine_desc")}
        />
        <KpiCard
          icon={<Icons.TrendingUp size={12} />}
          label={t("dash.kpi_period_return", { range: timeRange })}
          value={periodReturn != null ? `${periodReturn >= 0 ? "+" : "−"}$${Math.abs(periodReturn).toLocaleString("en-US", { maximumFractionDigits: 0 })}` : "—"}
          valueColor={periodReturn == null ? "var(--fg-3)" : periodReturn >= 0 ? "var(--up)" : "var(--down)"}
          sub={t("dash.kpi_active_orders", { n: dashboard?.totalOrdersPlaced ?? 0 })}
        />
        <KpiCard
          icon={<Icons.Bot size={12} />}
          label={t("kpi.active_bots")}
          value={<>{dashboard?.activeBots ?? activeCount}<span style={{ fontSize: 15, color: "var(--fg-3)" }}> / {totalRobots}</span></>}
          sub={t("dash.kpi_running_now", { n: activeCount })}
        />
        <KpiCard
          icon={<Icons.Sparkles size={12} />}
          label={t("kpi.total_fills")}
          value={(dashboard?.totalFills ?? 0).toLocaleString("en-US")}
          sub={t("kpi.reorders") + " " + String(dashboard?.totalReorders ?? 0)}
        />
      </div>

      {/* main 2-col grid */}
      <div className="dashboard-main-grid">
        {/* LEFT column */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
          {/* equity curve */}
          <Card pad={0} style={{ borderRadius: 14, overflow: "hidden", minHeight: 240 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "15px 17px 0", flexWrap: "wrap", gap: 10 }}>
              <div>
                <SectionLabel>{t("dash.equity_curve")}</SectionLabel>
                <div style={{ display: "flex", gap: 16, marginTop: 9, fontSize: 11.5, flexWrap: "wrap" }}>
                  {[
                    { color: "var(--accent)", label: t("dash.legend_equity") },
                    { color: "var(--alpha)", label: t("dash.legend_alpha") },
                    { color: "var(--fg-3)", label: t("dash.legend_naive") },
                  ].map((l) => (
                    <span key={l.label} style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--fg-1)" }}>
                      <span style={{ width: 9, height: 3, borderRadius: 2, background: l.color, display: "inline-block" }} />{l.label}
                    </span>
                  ))}
                </div>
              </div>
              <div style={{ display: "flex", gap: 4, background: "var(--bg-2)", padding: 3, borderRadius: 8 }}>
                {["7D", "30D", "90D", "ALL"].map((lbl) => {
                  const active = timeRange === lbl;
                  return (
                    <button
                      key={lbl}
                      onClick={() => setTimeRange(lbl)}
                      style={{ padding: "4px 11px", fontSize: 11, color: active ? "var(--fg-0)" : "var(--fg-2)", background: active ? "var(--bg-3)" : "transparent", borderRadius: 6, cursor: "pointer", border: "none", fontWeight: active ? 600 : 400 }}
                    >
                      {lbl}
                    </button>
                  );
                })}
              </div>
            </div>
            {curveData.length >= 2 ? (
              <EquityCurveChart data={curveData} equityLabel={t("dash.legend_equity")} alphaLabel={t("dash.legend_alpha")} />
            ) : (
              <div style={{ padding: 40, textAlign: "center", color: "var(--fg-3)", fontSize: 13 }}>
                {t("dash.no_equity_data")}
              </div>
            )}
          </Card>

          {/* active bots table */}
          <Card pad={0} style={{ borderRadius: 14, overflow: "hidden" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "15px 17px", borderBottom: "1px solid var(--border-subtle)" }}>
              <SectionLabel>{t("dash.active_bots")}</SectionLabel>
              <Link href="/robots" style={{ fontSize: 12, color: "var(--accent)", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4 }}>
                {t("common.view_all")}
              </Link>
            </div>
            <div className="gp-table-scroll" style={{ margin: "0 -16px", padding: "0 16px" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ color: "var(--fg-3)", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.6 }}>
                    {[
                      { label: t("dash.col_bot"), align: "left" as const, hideMobile: false },
                      { label: t("dash.col_status"), align: "left" as const, hideMobile: false },
                      { label: t("dash.col_range_box"), align: "left" as const, hideMobile: true },
                      { label: t("kpi.mark"), align: "right" as const, hideMobile: false },
                      { label: t("dash.col_unrealized_pnl"), align: "right" as const, hideMobile: false },
                      { label: t("dash.col_alpha"), align: "right" as const, hideMobile: true },
                      { label: "", align: "right" as const, hideMobile: false },
                    ].map((h, i) => (
                      <th key={i} className={h.hideMobile ? "gp-hide-mobile" : ""} style={{ padding: "9px 17px", textAlign: h.align, fontWeight: 600 }}>{h.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {activeRobots.length === 0 && (
                    <tr>
                      <td colSpan={7} className="gp-table-scroll-td" style={{ padding: "24px 16px", textAlign: "center", color: "var(--fg-3)" }}>
                        {t("dash.no_active_bots")}
                      </td>
                    </tr>
                  )}
                  {activeRobots.map((robot) => {
                    const exchangeId = robot.exchangeId ?? "binance";
                    const price = robot.latestPrice;
                    const hasBox = robot.activeBoxHighPrice != null && robot.activeBoxLowPrice != null;
                    const boxHighPrice = robot.activeBoxHighPrice ?? 1;
                    const boxLowPrice = robot.activeBoxLowPrice ?? 0;
                    const inBox = hasBox && price != null ? price >= boxLowPrice && price <= boxHighPrice : false;
                    const boxPct = hasBox && boxHighPrice > boxLowPrice && price != null ? (price - boxLowPrice) / (boxHighPrice - boxLowPrice) : 0;
                    const upnl = robot.lastUnrealizedPnl;
                    return (
                      <tr key={robot.id} style={{ borderTop: "1px solid var(--border-subtle)", cursor: "pointer" }} onClick={() => { window.location.href = `/robots/${robot.id}`; }} data-testid="dash-robot-row">
                        <td style={{ padding: "12px 17px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <ExchangeMark exchange={exchangeId} size={26} />
                            <div>
                              <div style={{ fontWeight: 600 }}>{robot.symbol} <span className="num" style={{ fontSize: 10, color: "var(--fg-3)" }}>· {robot.id.slice(0, 6)}</span></div>
                              <div style={{ fontSize: 10.5, color: "var(--fg-2)" }}>{robot.direction} · {fmt.exchangeName(exchangeId)}</div>
                            </div>
                          </div>
                        </td>
                        <td style={{ padding: "12px 8px" }}><FsmPill state={robot.status} size="sm" t={t} /></td>
                        <td className="gp-hide-mobile" style={{ padding: "12px 8px" }}>
                          {hasBox ? (
                            <>
                              <div className="num" style={{ fontSize: 10.5, color: "var(--fg-2)" }}>${boxLowPrice.toFixed(0)} — ${boxHighPrice.toFixed(0)}</div>
                              <div style={{ width: 130, height: 4, background: "var(--bg-3)", borderRadius: 2, position: "relative", marginTop: 4 }}>
                                <div style={{ position: "absolute", left: `${Math.max(0, Math.min(100, boxPct * 100))}%`, top: -2, width: 2.5, height: 8, background: inBox ? "var(--accent)" : "var(--down)", borderRadius: 2 }} />
                              </div>
                            </>
                          ) : (
                            <span style={{ fontSize: 10.5, color: "var(--fg-3)" }}>—</span>
                          )}
                        </td>
                        <td style={{ padding: "12px 8px", textAlign: "right" }}>{price != null ? <PriceTicker price={price} prev={price} size={12} /> : <span style={{ color: "var(--fg-3)" }}>—</span>}</td>
                        <td className="num" style={{ padding: "12px 8px", textAlign: "right", fontWeight: 500, color: upnl == null ? "var(--fg-3)" : upnl >= 0 ? "var(--up)" : "var(--down)" }}>
                          {upnl == null ? "—" : `${upnl >= 0 ? "+" : "−"}$${Math.abs(upnl).toFixed(2)}`}
                        </td>
                        <td className="gp-hide-mobile" style={{ padding: "12px 17px", textAlign: "right" }}>
                          <span className="num" style={{ color: "var(--fg-3)", fontSize: 11 }}>—</span>
                        </td>
                        <td style={{ padding: "12px 8px", textAlign: "right" }}><Icons.ChevronRight size={13} style={{ color: "var(--fg-3)" }} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </div>

        {/* RIGHT rail */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
          <AlphaEngineCard cumAlpha={cumAlpha} hasData={hasAlpha} rangeLabel={timeRange} />
          <FundDistributionCard />
          <LiveFillsCard />
        </div>
      </div>

      <div style={{ marginTop: 22, textAlign: "center", fontSize: 11, color: "var(--fg-3)" }}>{t("dash.footer_tagline")}</div>
    </Shell>
  );
}
