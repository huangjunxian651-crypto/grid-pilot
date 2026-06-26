"use client";

import React from "react";
import { useLang } from "@/lib/i18n-context";

// 关键词渐变（紫色系，用主色变量，不写死十六进制）。
const GRADIENT: React.CSSProperties = {
  background: "linear-gradient(95deg, var(--accent-hi), var(--accent))",
  WebkitBackgroundClip: "text",
  backgroundClip: "text",
  color: "transparent",
};

function Stat({ value, label, accent, first }: { value: string; label: string; accent?: boolean; first?: boolean }) {
  return (
    <div style={{ padding: first ? "4px 14px 4px 0" : "4px 14px", borderLeft: first ? "none" : "1px solid var(--border-subtle)" }}>
      <div style={{ fontSize: 34, fontWeight: 800, letterSpacing: -1, lineHeight: 1.1, color: accent ? "var(--accent-hi)" : "var(--fg-0)" }}>{value}</div>
      <div style={{ fontSize: 12.5, color: "var(--fg-2)", marginTop: 6, lineHeight: 1.4 }}>{label}</div>
    </div>
  );
}

export function FeeShockHero() {
  const { t } = useLang();
  const title = t("learn.fees.hero_title");
  const accentPhrase = t("learn.fees.hero_title_accent");
  const accentIndex = title.indexOf(accentPhrase);
  const hasAccent = accentIndex >= 0;
  // accent 短语可能在标题任意位置：保留其前缀与后缀，避免句尾被吞（如韩文）。
  const prefix = hasAccent ? title.slice(0, accentIndex) : title;
  const suffix = hasAccent ? title.slice(accentIndex + accentPhrase.length) : "";
  return (
    <div data-testid="fee-hero" style={{ border: "1px solid var(--border-subtle)", borderRadius: 16, background: "var(--bg-1)", padding: "32px 30px" }}>
      <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: -0.5, lineHeight: 1.35, color: "var(--fg-0)" }}>
        {hasAccent ? <>{prefix}<span style={GRADIENT}>{accentPhrase}</span>{suffix}</> : title}
      </div>
      <div style={{ fontSize: 15, color: "var(--fg-2)", marginTop: 14, maxWidth: 640, lineHeight: 1.6 }}>{t("learn.fees.hero_sub")}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", marginTop: 28 }}>
        <Stat first accent value={t("learn.fees.stat_rebate_value")} label={t("learn.fees.stat_rebate_label")} />
        <Stat value={t("learn.fees.stat_auto_value")} label={t("learn.fees.stat_auto_label")} />
        <Stat value={t("learn.fees.stat_lock_value")} label={t("learn.fees.stat_lock_label")} />
      </div>
    </div>
  );
}
