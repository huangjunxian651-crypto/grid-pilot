"use client";
import React from "react";
import { type ExchangeId } from "@gridpilot/shared-types";
import { useLang } from "@/lib/i18n-context";
import {
  rebateRatePercent,
  REFERRAL_EXCHANGES,
  EXCHANGE_DISPLAY_NAME as NAME,
  INVITE_CODE,
  OFFICIAL_REGISTER_URL as OFFICIAL,
} from "@/lib/referral";
import { useReferralMirrors } from "./use-referral-mirrors";

const ALL: ExchangeId[] = REFERRAL_EXCHANGES;

// 注册关键提示：APP 注册需手填邀请码(易漏)、每身份证每所限一号(可用家人身份证另开)。
export function ReferralTips() {
  const { t } = useLang();
  return (
    <div data-testid="referral-tips" style={{ marginTop: 12, fontSize: 12, color: "var(--fg-2)", lineHeight: 1.6, display: "flex", flexDirection: "column", gap: 6 }}>
      <div>⚠️ {t("referral.tip_app")}</div>
      <div>💡 {t("referral.tip_id")}</div>
    </div>
  );
}

export function ReferralCta({ exchangeId, variant = "compact" }: { exchangeId?: ExchangeId; variant?: "compact" | "prominent" }) {
  const { t } = useLang();
  const mirrors = useReferralMirrors();
  const targets = exchangeId ? [exchangeId] : ALL;

  if (variant === "prominent") {
    const mirrorTargets = targets.filter((exchange) => mirrors[exchange]);
    return (
      <div data-testid="referral-cta-prominent" style={{ border: "1px solid var(--accent)", borderRadius: 14, padding: 22, background: "var(--accent-tint)" }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: "var(--fg-0)", lineHeight: 1.5 }}>{t("referral.cta_headline")}</div>
        <div style={{ fontSize: 13, color: "var(--fg-2)", margin: "8px 0 18px", lineHeight: 1.65 }}>{t("referral.cta_sub")}</div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {targets.map((exchange) => (
            <a
              key={exchange}
              data-testid={`referral-official-${exchange}`}
              href={OFFICIAL[exchange]} target="_blank" rel="noopener noreferrer"
              style={{ flex: "1 1 160px", textAlign: "center", background: "var(--accent)", color: "var(--btn-fg)", fontSize: 14, fontWeight: 600, padding: "13px 16px", borderRadius: 10, textDecoration: "none" }}
            >
              {t("referral.register_btn", { name: NAME[exchange], rate: rebateRatePercent(exchange) })} →
            </a>
          ))}
        </div>
        <div style={{ fontSize: 11.5, color: "var(--fg-3)", marginTop: 12 }}>
          {t("referral.invite_code")}：{targets.map((exchange) => `${NAME[exchange]} ${INVITE_CODE[exchange]}`).join(" · ")}
        </div>
        <ReferralTips />
        {mirrorTargets.length > 0 && (
          <div style={{ fontSize: 11, color: "var(--fg-3)", marginTop: 12, display: "flex", flexWrap: "wrap", gap: 12 }}>
            {mirrorTargets.map((exchange) => (
              <span key={exchange}>
                {NAME[exchange]} {t("referral.mirror_hint")}{" "}
                <a data-testid={`referral-mirror-${exchange}`} href={mirrors[exchange]} target="_blank" rel="noopener noreferrer" style={{ color: "var(--fg-2)", textDecoration: "underline" }}>
                  {t("referral.mirror_label")}
                </a>
              </span>
            ))}
          </div>
        )}
        <div style={{ fontSize: 10.5, color: "var(--fg-3)", marginTop: 10 }}>{t("referral.disclaimer")}</div>
      </div>
    );
  }

  return (
    <div style={{ border: "1px solid var(--border-subtle)", borderRadius: 10, padding: 14, background: "var(--bg-1)" }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{t("referral.title")}</div>
      <div style={{ fontSize: 12, color: "var(--fg-2)", marginBottom: 10 }}>{t("referral.subtitle")}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {targets.map((exchange) => (
          <div key={exchange} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <a
              data-testid={`referral-official-${exchange}`}
              href={OFFICIAL[exchange]} target="_blank" rel="noopener noreferrer"
              style={{ fontSize: 13, color: "var(--accent)" }}
            >
              {NAME[exchange]} · {t("referral.register_official", { code: INVITE_CODE[exchange] })}
            </a>
            {mirrors[exchange] && (
              <span style={{ fontSize: 11, color: "var(--fg-3)" }}>
                {t("referral.mirror_hint")}{" "}
                <a data-testid={`referral-mirror-${exchange}`} href={mirrors[exchange]} target="_blank" rel="noopener noreferrer" style={{ color: "var(--fg-2)", textDecoration: "underline" }}>
                  {t("referral.mirror_label")}
                </a>
              </span>
            )}
          </div>
        ))}
      </div>
      <ReferralTips />
      <div style={{ fontSize: 10.5, color: "var(--fg-3)", marginTop: 10 }}>{t("referral.disclaimer")}</div>
    </div>
  );
}
