"use client";

import React from "react";
import { Shell } from "@/components/shell/shell";
import { useLang } from "@/lib/i18n-context";
import { useRobots } from "@/lib/hooks/useBots";
import { estimateRebate, REBATE_RATES, rebateRatePercent, EXCHANGE_DISPLAY_NAME, type ReferralExchange } from "@/lib/referral";
import { ReferralRegisterCards } from "@/components/referral/referral-register-cards";
import { ReferralTips } from "@/components/referral/referral-cta";
import { Icons } from "@/components/ui/icons";
import { ExchangeMark } from "@/components/ui/primitives";
import { FeeWhyCard } from "./_components/fee-why-card";
import { MakerTakerCard } from "./_components/maker-taker-card";
import { FundingCard } from "./_components/funding-card";

function usd(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// 基础档位费率（与下方费率表一致，单一真源）。
const MAKER_RATE = 0.0002;
const TAKER_RATE = 0.0005;

const SectionTitle = ({ children }: { children: React.ReactNode }) => (
  <div style={{ fontFamily: "var(--font-display)", fontSize: 16, fontWeight: 600, marginBottom: 13 }}>{children}</div>
);

/** KPI hero 卡。hero=true 为金色渐变高亮（已省手续费）。 */
function KpiCard({ testId, label, value, sub, color, hero }: { testId: string; label: string; value: string; sub: React.ReactNode; color: string; hero?: boolean }) {
  return (
    <div
      data-testid={testId}
      style={{
        position: "relative",
        overflow: "hidden",
        background: hero ? "linear-gradient(150deg, var(--alpha-tint) 0%, var(--bg-1) 55%)" : "var(--bg-1)",
        border: `1px solid ${hero ? "var(--alpha-tint-strong)" : "var(--border-subtle)"}`,
        borderRadius: 14,
        padding: 17,
      }}
    >
      {hero && <div style={{ position: "absolute", top: -30, right: -30, width: 120, height: 120, borderRadius: "50%", background: "radial-gradient(circle, var(--alpha) 0%, transparent 70%)", opacity: 0.16 }} />}
      <div style={{ fontSize: 10.5, color, textTransform: "uppercase", letterSpacing: 0.9, fontWeight: 600 }}>{label}</div>
      <div className="num" style={{ fontFamily: "var(--font-mono)", fontSize: 28, fontWeight: 600, color, letterSpacing: -1, marginTop: 8 }}>{value}</div>
      <div style={{ fontSize: 11, color: "var(--fg-2)", marginTop: 4 }}>{sub}</div>
    </div>
  );
}

function LowerCostCard({ testId, icon, tintColor, title, desc }: { testId: string; icon: React.ReactNode; tintColor: string; title: string; desc: string }) {
  return (
    <div data-testid={testId} style={{ background: "var(--bg-1)", border: "1px solid var(--border-subtle)", borderRadius: 14, padding: 18 }}>
      <div style={{ width: 34, height: 34, borderRadius: 9, background: tintColor, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 12 }}>{icon}</div>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>{title}</div>
      <p style={{ fontSize: 12, color: "var(--fg-2)", lineHeight: 1.6, margin: 0 }}>{desc}</p>
    </div>
  );
}

export function FeesInfographic() {
  const { t } = useLang();
  const { data: robots } = useRobots();

  const list = robots ?? [];
  const totalFees = list.reduce((s, r) => s + (r.totalFees || 0), 0);
  // Maker 节省 vs 全吃单基准：同等成交量若全吃单需付 totalFees×(taker/maker)，差额即节省。
  const totalSavings = totalFees * (TAKER_RATE / MAKER_RATE - 1);
  const totalRebate = list.reduce((s, r) => s + estimateRebate(r.exchangeId, r.totalFees || 0), 0);

  return (
    <Shell breadcrumb={[t("learn.fees.nav")]}>
      <div style={{ display: "flex", flexDirection: "column" }}>
        {/* 页头（仅文字限宽，卡片/表格全宽，对齐设计稿） */}
        <div style={{ marginBottom: 20, maxWidth: 920 }}>
          <h1 style={{ fontFamily: "var(--font-display)", fontSize: 23, fontWeight: 600, letterSpacing: -0.6, margin: 0 }}>{t("fees.title")}</h1>
          <p style={{ fontSize: 13, color: "var(--fg-2)", lineHeight: 1.6, marginTop: 6, marginBottom: 0 }}>{t("fees.subtitle")}</p>
        </div>

        {/* KPI hero */}
        <div className="gp-grid-3 gp-grid-1-sm" style={{ gap: 14, marginBottom: 18 }}>
          <KpiCard testId="fees-kpi-saved" hero color="var(--alpha)" label={t("fees.kpi_saved_label")} value={usd(totalSavings)} sub={t("fees.kpi_saved_sub")} />
          <KpiCard testId="fees-kpi-paid" color="var(--fg-0)" label={t("fees.kpi_paid_label")} value={usd(totalFees)} sub={<span style={{ color: "var(--maker)" }}>{t("fees.kpi_paid_sub")}</span>} />
          <KpiCard testId="fees-kpi-rebate" color="var(--up)" label={t("fees.kpi_rebate_label")} value={usd(totalRebate)} sub={t("fees.kpi_rebate_sub")} />
        </div>

        {/* 如何降低成本 */}
        <SectionTitle>{t("fees.lower_title")}</SectionTitle>
        <div className="gp-grid-3 gp-grid-1-sm" style={{ gap: 14, marginBottom: 24 }}>
          <LowerCostCard testId="fees-lower-poc" tintColor="var(--maker-tint)" icon={<Icons.Grid size={17} style={{ color: "var(--maker)" }} />} title={t("fees.lower_poc_title")} desc={t("fees.lower_poc_desc")} />
          <LowerCostCard testId="fees-lower-gtc" tintColor="var(--alpha-tint)" icon={<Icons.Sparkles size={17} style={{ color: "var(--alpha)" }} />} title={t("fees.lower_gtc_title")} desc={t("fees.lower_gtc_desc")} />
          <LowerCostCard testId="fees-lower-rebate" tintColor="var(--up-tint)" icon={<Icons.TrendingUp size={17} style={{ color: "var(--up)" }} />} title={t("fees.lower_rebate_title")} desc={t("fees.lower_rebate_desc")} />
        </div>

        {/* 费率与返佣比例表 */}
        <SectionTitle>{t("fees.table_title")}</SectionTitle>
        <div style={{ background: "var(--bg-1)", border: "1px solid var(--border-subtle)", borderRadius: 14, overflow: "hidden", marginBottom: 24 }}>
          <table data-testid="fees-rate-table" style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ color: "var(--fg-3)", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.6 }}>
                <th style={{ padding: "11px 18px", textAlign: "left", fontWeight: 600 }}>{t("fees.col_exchange")}</th>
                <th style={{ padding: "11px 8px", textAlign: "right", fontWeight: 600 }}>{t("fees.col_maker")}</th>
                <th style={{ padding: "11px 8px", textAlign: "right", fontWeight: 600 }}>{t("fees.col_taker")}</th>
                <th style={{ padding: "11px 8px", textAlign: "right", fontWeight: 600 }}>{t("fees.col_rebate")}</th>
                <th style={{ padding: "11px 18px", textAlign: "right", fontWeight: 600 }}>{t("fees.col_net")}</th>
              </tr>
            </thead>
            <tbody style={{ fontSize: 12.5 }}>
              {(["binance", "okx", "gateio"] as ReferralExchange[]).map((ex) => {
                const maker = MAKER_RATE;
                const taker = TAKER_RATE;
                const rate = REBATE_RATES[ex] ?? 0;
                const net = maker * (1 - rate);
                const fmtPct = (n: number) => `${(n * 100).toFixed(4)}%`;
                return (
                  <tr key={ex} style={{ borderTop: "1px solid var(--border-subtle)" }}>
                    <td style={{ padding: "13px 18px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                        <ExchangeMark exchange={ex} size={18} />
                        <span style={{ fontWeight: 500 }}>{EXCHANGE_DISPLAY_NAME[ex]}</span>
                      </div>
                    </td>
                    <td style={{ padding: "13px 8px", textAlign: "right", fontFamily: "var(--font-mono)", color: "var(--maker)" }}>{fmtPct(maker)}</td>
                    <td style={{ padding: "13px 8px", textAlign: "right", fontFamily: "var(--font-mono)" }}>{fmtPct(taker)}</td>
                    <td style={{ padding: "13px 8px", textAlign: "right", fontFamily: "var(--font-mono)", color: "var(--up)" }}>{rebateRatePercent(ex)}%</td>
                    <td style={{ padding: "13px 18px", textAlign: "right", fontFamily: "var(--font-mono)", color: "var(--alpha)" }}>{fmtPct(net)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div style={{ padding: "11px 18px", borderTop: "1px solid var(--border-subtle)", fontSize: 11, color: "var(--fg-3)" }}>{t("fees.table_note")}</div>
        </div>

        {/* 手续费返佣·让成本回血 */}
        <SectionTitle>{t("fees.why_title")}</SectionTitle>
        <div style={{ background: "var(--bg-1)", border: "1px solid var(--border-subtle)", borderRadius: 14, padding: 20, marginBottom: 18, display: "flex", gap: 22, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 300 }}>
            <p style={{ fontSize: 13, color: "var(--fg-1)", lineHeight: 1.7, margin: "0 0 10px" }}>{t("fees.why_p1")}</p>
            <p style={{ fontSize: 12, color: "var(--fg-2)", lineHeight: 1.6, margin: 0 }}>{t("fees.why_p2")}</p>
          </div>
          <div style={{ display: "flex", gap: 22, flexShrink: 0 }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 26, fontWeight: 600, color: "var(--fg-0)", letterSpacing: -0.5 }}>{usd(totalFees)}</div>
              <div style={{ fontSize: 10.5, color: "var(--fg-3)", marginTop: 2 }}>{t("fees.why_monthly")}</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", color: "var(--fg-3)" }}><Icons.ChevronRight size={20} /></div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 26, fontWeight: 600, color: "var(--alpha)", letterSpacing: -0.5 }}>+{usd(totalRebate)}</div>
              <div style={{ fontSize: 10.5, color: "var(--fg-3)", marginTop: 2 }}>{t("fees.why_rebate")}</div>
            </div>
          </div>
        </div>

        {/* 注册并绑定交易所 */}
        <SectionTitle>{t("fees.register_title")}</SectionTitle>
        <p style={{ fontSize: 12.5, color: "var(--fg-2)", marginTop: -4, marginBottom: 14 }}>{t("fees.register_sub")}</p>
        <ReferralRegisterCards />
        <ReferralTips />

        {/* 一证一户提示 */}
        <div data-testid="fees-oneid" style={{ borderLeft: "3px solid var(--alpha)", background: "var(--alpha-tint)", borderRadius: "0 10px 10px 0", padding: "14px 18px", margin: "18px 0 8px" }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 4 }}>{t("fees.oneid_title")}</div>
          <p style={{ fontSize: 12, color: "var(--fg-2)", lineHeight: 1.6, margin: 0 }}>{t("fees.oneid_body")}</p>
        </div>

        {/* 深入了解（教育区） */}
        <div data-testid="fees-deepdive" style={{ marginTop: 30 }}>
          <SectionTitle>{t("fees.deepdive_title")}</SectionTitle>
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <FeeWhyCard />
            <div className="gp-grid-2 gp-grid-1-sm" style={{ gap: 18 }}>
              <MakerTakerCard />
              <FundingCard />
            </div>
          </div>
        </div>
      </div>
    </Shell>
  );
}
