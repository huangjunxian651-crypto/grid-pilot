"use client";

import React from "react";
import { Shell } from "@/components/shell/shell";
import { useLang } from "@/lib/i18n-context";

const SectionLabel = ({ children }: { children: React.ReactNode }) => (
  <div style={{ fontSize: 10.5, color: "var(--fg-2)", textTransform: "uppercase", letterSpacing: 0.9, fontWeight: 600, marginBottom: 16 }}>{children}</div>
);

const Card = ({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) => (
  <div style={{ background: "var(--bg-1)", border: "1px solid var(--border-subtle)", borderRadius: 14, padding: 20, ...style }}>{children}</div>
);

const Arrow = () => (
  <svg width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="var(--fg-3)" strokeWidth="1.5" style={{ marginTop: 10, flexShrink: 0 }}><path d="M6 3l5 5-5 5" /></svg>
);

function LifecycleStep({ tint, stroke, icon, title, desc }: { tint: string; stroke: string; icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div style={{ flex: 1, textAlign: "center" }}>
      <div style={{ width: 40, height: 40, borderRadius: 11, background: tint, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 9px" }}>
        <svg width="19" height="19" viewBox="0 0 16 16" fill="none" stroke={stroke} strokeWidth="1.6">{icon}</svg>
      </div>
      <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 3 }}>{title}</div>
      <div style={{ fontSize: 11, color: "var(--fg-2)", lineHeight: 1.5 }}>{desc}</div>
    </div>
  );
}

function ZoneRow({ color, title, desc }: { color: string; title: string; desc: string }) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 3 }}>
        <span style={{ width: 8, height: 8, borderRadius: 2, background: color }} />
        <span style={{ fontSize: 12.5, fontWeight: 600 }}>{title}</span>
      </div>
      <div style={{ fontSize: 11.5, color: "var(--fg-2)", lineHeight: 1.55 }}>{desc}</div>
    </div>
  );
}

function Mechanism({ title, desc }: { title: string; desc: string }) {
  return (
    <div style={{ padding: "13px 14px", background: "var(--bg-2)", borderRadius: 10 }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 5 }}>{title}</div>
      <div style={{ fontSize: 11.5, color: "var(--fg-2)", lineHeight: 1.55 }}>{desc}</div>
    </div>
  );
}

function GlossaryItem({ term, desc }: { term: string; desc: string }) {
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 600 }}>{term}</div>
      <div style={{ fontSize: 11, color: "var(--fg-2)", lineHeight: 1.5 }}>{desc}</div>
    </div>
  );
}

export default function DocsPage() {
  const { t } = useLang();
  return (
    <Shell breadcrumb={[t("docs.nav")]}>
      <div style={{ marginBottom: 22, maxWidth: 920 }}>
        <h1 style={{ fontFamily: "var(--font-display)", fontSize: 23, fontWeight: 600, letterSpacing: -0.6, margin: 0 }}>{t("docs.title")}</h1>
        <p style={{ fontSize: 13, color: "var(--fg-2)", lineHeight: 1.6, marginTop: 4, marginBottom: 0 }}>{t("docs.subtitle")}</p>
      </div>

      <div className="gp-grid-doc">
        {/* 主文档 */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
          {/* 生命周期 */}
          <Card>
            <SectionLabel>{t("docs.lifecycle_label")}</SectionLabel>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 0 }}>
              <LifecycleStep tint="var(--accent-tint)" stroke="var(--accent)" title={t("docs.life_entry_title")} desc={t("docs.life_entry_desc")} icon={<path d="M2 11l3.5-4 2.5 2.5L13 4M9.5 4H13v3.5" />} />
              <Arrow />
              <LifecycleStep tint="var(--accent-tint)" stroke="var(--accent)" title={t("docs.life_grid_title")} desc={t("docs.life_grid_desc")} icon={<><rect x="2" y="2" width="5" height="5" rx="1" /><rect x="9" y="2" width="5" height="5" rx="1" /><rect x="2" y="9" width="5" height="5" rx="1" /><rect x="9" y="9" width="5" height="5" rx="1" /></>} />
              <Arrow />
              <LifecycleStep tint="var(--up-tint)" stroke="var(--up)" title={t("docs.life_tp_title")} desc={t("docs.life_tp_desc")} icon={<path d="M3 8.5l3.5 3.5L13 4.5" />} />
            </div>
          </Card>

          {/* 三区间 */}
          <Card>
            <SectionLabel>{t("docs.zones_label")}</SectionLabel>
            <div style={{ display: "flex", gap: 18, alignItems: "stretch", flexWrap: "wrap" }}>
              <div style={{ position: "relative", width: 150, height: 170, flexShrink: 0, borderRadius: 8, overflow: "hidden" }}>
                <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: "46%", background: "var(--accent-tint)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: "var(--accent)", fontWeight: 600 }}>{t("docs.zone_main")}</div>
                <div style={{ position: "absolute", left: 0, right: 0, top: "46%", height: "14%", background: "var(--bg-3)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9.5, color: "var(--fg-3)" }}>{t("docs.zone_iso")}</div>
                <div style={{ position: "absolute", left: 0, right: 0, top: "60%", bottom: 0, background: "var(--down-tint)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: "var(--down)", fontWeight: 600 }}>{t("docs.zone_sl")}</div>
              </div>
              <div style={{ flex: 1, minWidth: 240, display: "flex", flexDirection: "column", gap: 12 }}>
                <ZoneRow color="var(--accent)" title={t("docs.zone_main_title")} desc={t("docs.zone_main_desc")} />
                <ZoneRow color="var(--fg-3)" title={t("docs.zone_iso_title")} desc={t("docs.zone_iso_desc")} />
                <ZoneRow color="var(--down)" title={t("docs.zone_sl_title")} desc={t("docs.zone_sl_desc")} />
              </div>
            </div>
          </Card>

          {/* 核心机制 */}
          <Card>
            <SectionLabel>{t("docs.mech_label")}</SectionLabel>
            <div className="gp-grid-2 gp-grid-1-sm" style={{ gap: 14 }}>
              <Mechanism title={t("docs.mech_boxes_title")} desc={t("docs.mech_boxes_desc")} />
              <Mechanism title={t("docs.mech_entry_title")} desc={t("docs.mech_entry_desc")} />
              <Mechanism title={t("docs.mech_dynamic_title")} desc={t("docs.mech_dynamic_desc")} />
              <Mechanism title={t("docs.mech_sl_title")} desc={t("docs.mech_sl_desc")} />
            </div>
          </Card>
        </div>

        {/* 右栏：Alpha + 术语表 + 风险 */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ position: "relative", overflow: "hidden", background: "linear-gradient(160deg, var(--alpha-tint) 0%, var(--bg-1) 60%)", border: "1px solid var(--alpha-tint-strong)", borderRadius: 14, padding: 18 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--alpha)", fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.9, fontWeight: 600 }}>
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M8 1.6l1.5 3.4 3.7.3-2.8 2.4.9 3.6L8 13l-3.2 1.9.9-3.6L2.9 5.3l3.7-.3z" /></svg>
              {t("docs.alpha_label")}
            </div>
            <p style={{ fontSize: 12, color: "var(--fg-1)", lineHeight: 1.65, marginTop: 10 }}>{t("docs.alpha_intro")}</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 11 }}>
              <div style={{ fontSize: 11.5, color: "var(--fg-2)" }}><span style={{ color: "var(--maker)", fontWeight: 600 }}>{t("docs.alpha_maker_term")}</span> — {t("docs.alpha_maker_desc")}</div>
              <div style={{ fontSize: 11.5, color: "var(--fg-2)" }}><span style={{ color: "var(--alpha)", fontWeight: 600 }}>{t("docs.alpha_gtc_term")}</span> — {t("docs.alpha_gtc_desc")}</div>
            </div>
            <div style={{ marginTop: 13, paddingTop: 13, borderTop: "1px solid var(--alpha-tint-strong)", fontFamily: "var(--font-mono)", fontSize: 11.5, color: "var(--fg-1)" }}>{t("docs.alpha_formula")}</div>
          </div>

          <Card style={{ padding: 18 }}>
            <SectionLabel>{t("docs.glossary_label")}</SectionLabel>
            <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
              <GlossaryItem term={t("docs.glossary_poc_term")} desc={t("docs.glossary_poc_desc")} />
              <GlossaryItem term={t("docs.glossary_gtc_term")} desc={t("docs.glossary_gtc_desc")} />
              <GlossaryItem term={t("docs.glossary_avg_term")} desc={t("docs.glossary_avg_desc")} />
              <GlossaryItem term={t("docs.glossary_full_term")} desc={t("docs.glossary_full_desc")} />
            </div>
          </Card>

          <div style={{ padding: "14px 16px", background: "var(--down-tint)", border: "1px solid transparent", borderRadius: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, color: "var(--down)", fontWeight: 600, fontSize: 12, marginBottom: 6 }}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M8 2l6 11H2z" /><path d="M8 6.5v3M8 11.2h.01" /></svg>
              {t("docs.risk_label")}
            </div>
            <p style={{ fontSize: 11, color: "var(--fg-1)", lineHeight: 1.6, margin: 0 }}>{t("docs.risk_body")}</p>
          </div>
        </div>
      </div>
    </Shell>
  );
}
