"use client";
import React, { useState } from "react";
import { toast } from "sonner";
import { useLang } from "@/lib/i18n-context";
import { ExchangeMark } from "@/components/ui/primitives";
import { Icons } from "@/components/ui/icons";
import {
  REFERRAL_EXCHANGES,
  EXCHANGE_DISPLAY_NAME,
  INVITE_CODE,
  OFFICIAL_REGISTER_URL,
  rebateRatePercent,
  type ReferralExchange,
} from "@/lib/referral";
import { useReferralMirrors } from "./use-referral-mirrors";

const CONTRACT_KEY: Record<ReferralExchange, string> = {
  binance: "fees.contract_binance",
  okx: "fees.contract_okx",
  gateio: "fees.contract_gateio",
};

/** 单个交易所注册卡——设计稿「注册并绑定交易所」区。Gate.io（返佣最高）为金色高亮变体。 */
function RegisterCard({ exchange, mirror }: { exchange: ReferralExchange; mirror?: string }) {
  const { t } = useLang();
  const [copied, setCopied] = useState(false);
  const rate = rebateRatePercent(exchange);
  const code = INVITE_CODE[exchange];
  const isTop = exchange === "gateio";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      toast.success(t("fees.copied"));
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* 剪贴板不可用时静默 */
    }
  };

  return (
    <div
      data-testid={`fees-register-${exchange}`}
      style={{
        position: "relative",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        borderRadius: 14,
        padding: 18,
        background: isTop ? "linear-gradient(150deg, var(--alpha-tint) 0%, var(--bg-1) 55%)" : "var(--bg-1)",
        border: `1px solid ${isTop ? "var(--alpha-tint-strong)" : "var(--border-subtle)"}`,
      }}
    >
      {isTop && (
        <span style={{ position: "absolute", top: 13, right: 13, fontSize: 9.5, fontWeight: 600, color: "var(--alpha)", background: "var(--alpha-tint-strong)", padding: "2px 8px", borderRadius: 6, whiteSpace: "nowrap" }}>
          {t("fees.gate_highest")}
        </span>
      )}
      {/* isTop 卡右上角有「返佣最高」绝对定位角标，header 预留空间避免内联费率徽章与其重叠（避免硬编码 margin） */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, paddingRight: isTop ? 78 : 0 }}>
        <ExchangeMark exchange={exchange} size={34} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>{EXCHANGE_DISPLAY_NAME[exchange]}</div>
          <div style={{ fontSize: 10.5, color: "var(--fg-3)" }}>{t(CONTRACT_KEY[exchange])}</div>
        </div>
        <span style={{ fontSize: 11, fontWeight: 600, color: isTop ? "var(--alpha)" : "var(--up)", background: isTop ? "var(--alpha-tint-strong)" : "var(--up-tint)", padding: "2px 8px", borderRadius: 6, whiteSpace: "nowrap" }}>
          {t("fees.rebate_badge", { rate })}
        </span>
      </div>
      <div style={{ fontSize: 10, color: "var(--fg-3)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>
        {t("fees.invite_code_label")}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <div style={{ flex: 1, padding: "0 12px", height: 38, display: "flex", alignItems: "center", background: "var(--bg-2)", border: `1px dashed ${isTop ? "var(--alpha-tint-strong)" : "var(--border-default)"}`, borderRadius: 8, fontFamily: "var(--font-mono)", fontSize: 14, fontWeight: 600, letterSpacing: 1 }}>
          {code}
        </div>
        <button
          onClick={copy}
          title={copied ? t("fees.copied") : t("fees.copy")}
          aria-label={t("fees.copy")}
          style={{ width: 38, height: 38, borderRadius: 8, background: "var(--bg-2)", border: "1px solid var(--border-subtle)", display: "flex", alignItems: "center", justifyContent: "center", color: copied ? "var(--up)" : "var(--fg-1)", cursor: "pointer", flexShrink: 0 }}
        >
          {copied ? <Icons.Check size={14} /> : <Icons.Copy size={14} />}
        </button>
      </div>
      <a
        data-testid={`fees-register-link-${exchange}`}
        href={OFFICIAL_REGISTER_URL[exchange]}
        target="_blank"
        rel="noopener noreferrer"
        style={{ marginTop: "auto", height: 40, borderRadius: 9, background: isTop ? "var(--alpha)" : "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center", gap: 7, fontSize: 13, fontWeight: 600, color: "var(--btn-fg)", textDecoration: "none" }}
      >
        {t("fees.register_bind")} <Icons.ArrowUp size={13} style={{ transform: "rotate(45deg)" }} />
      </a>
      {mirror && (
        <span style={{ fontSize: 10.5, color: "var(--fg-3)", marginTop: 8, textAlign: "center" }}>
          {t("referral.mirror_hint")}{" "}
          <a data-testid={`fees-mirror-${exchange}`} href={mirror} target="_blank" rel="noopener noreferrer" style={{ color: "var(--fg-2)", textDecoration: "underline" }}>
            {t("referral.mirror_label")}
          </a>
        </span>
      )}
    </div>
  );
}

/** 设计稿「注册并绑定交易所」三卡区。真实邀请码 + 各所官方链接 + 大陆镜像兜底。 */
export function ReferralRegisterCards() {
  const mirrors = useReferralMirrors();
  return (
    <div data-testid="fees-register" className="gp-grid-3 gp-grid-1-sm" style={{ gap: 14 }}>
      {REFERRAL_EXCHANGES.map((exchange) => (
        <RegisterCard key={exchange} exchange={exchange} mirror={mirrors[exchange]} />
      ))}
    </div>
  );
}
