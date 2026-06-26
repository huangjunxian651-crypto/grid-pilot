"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useLang } from "@/lib/i18n-context";
import { estimateRebate, isReferralMuted, setReferralMuted } from "@/lib/referral";

/**
 * 详情页唯一的返佣提示：单行、简洁，紧随 Alpha 归因卡（设计稿 pageDetail 的
 * "本机器人手续费还可再返 $X —— 注册时绑定邀请码"）。点链接去 /learn/fees 看完整注册流程，
 * 小 × 可静音（写全局 gp.referral_muted）。详情页不再堆叠 estimate/milestone/cta。
 */
export function RebatePnlHint({ exchangeId, feesPaid }: { exchangeId: string; feesPaid: number }) {
  const { t } = useLang();
  const [muted, setMuted] = useState(() => isReferralMuted());

  if (muted) return null;
  const rebate = estimateRebate(exchangeId, feesPaid);
  if (rebate <= 0) return null;

  return (
    <div data-testid="rebate-pnl-hint" style={{ display: "flex", alignItems: "baseline", gap: 6, fontSize: 11.5, color: "var(--fg-3)", lineHeight: 1.5 }}>
      <span style={{ flex: 1 }}>
        {t("referral.rebate_pnl_hint", { rebate: rebate.toFixed(2) })}{" "}
        <Link href="/learn/fees" style={{ color: "var(--accent)", whiteSpace: "nowrap" }}>{t("referral.rebate_cta_learn")}</Link>
      </span>
      <button
        type="button"
        data-testid="rebate-mute"
        aria-label={t("referral.rebate_mute")}
        title={t("referral.rebate_mute")}
        onClick={() => { setReferralMuted(); setMuted(true); }}
        style={{ background: "none", border: "none", color: "var(--fg-3)", cursor: "pointer", padding: 0, fontSize: 12, lineHeight: 1, flexShrink: 0 }}
      >
        ✕
      </button>
    </div>
  );
}
