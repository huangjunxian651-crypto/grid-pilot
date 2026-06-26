"use client";

import React from "react";
import Link from "next/link";
import { useLang } from "@/lib/i18n-context";
import { Icons } from "@/components/ui/icons";
import { useRobots } from "@/lib/hooks/useBots";
import { estimateRebate, isReferralMuted } from "@/lib/referral";

/**
 * 返佣提醒卡（设计稿 pageNoti 首条金色返佣提醒）。诚实前端 CTA：
 * 仅当确有可返还金额时显示，数值取真实 estimateRebate，可被用户静音。
 * 不伪造后端通知，点击跳费用与返佣页。
 */
export function RebateReminderCard() {
  const { t } = useLang();
  const { data: robots } = useRobots();

  if (isReferralMuted()) return null;
  const list = robots ?? [];
  const totalFees = list.reduce((s, r) => s + (r.totalFees || 0), 0);
  const totalRebate = list.reduce((s, r) => s + estimateRebate(r.exchangeId, r.totalFees || 0), 0);
  if (totalRebate <= 0) return null;

  return (
    <Link
      href="/learn/fees"
      data-testid="rebate-reminder-card"
      style={{
        position: "relative",
        overflow: "hidden",
        display: "flex",
        gap: 14,
        padding: 16,
        background: "linear-gradient(135deg, var(--alpha-tint) 0%, var(--bg-1) 62%)",
        border: "1px solid var(--alpha-tint-strong)",
        borderRadius: 12,
        textDecoration: "none",
        color: "inherit",
      }}
    >
      <div style={{ position: "absolute", top: -28, right: -28, width: 120, height: 120, borderRadius: "50%", background: "radial-gradient(circle, var(--alpha) 0%, transparent 70%)", opacity: 0.14, pointerEvents: "none" }} />
      <div style={{ width: 36, height: 36, borderRadius: 9, background: "var(--alpha-tint-strong)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--alpha)", flexShrink: 0 }}>
        <Icons.Sparkles size={16} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 14 }}>{t("referral.empty_title")}</div>
        <div style={{ fontSize: 13, color: "var(--fg-2)", marginTop: 4, lineHeight: 1.6 }}>
          {t("referral.rebate_total", { fees: totalFees.toFixed(2), rebate: totalRebate.toFixed(2) })}
        </div>
        <div style={{ fontSize: 12.5, color: "var(--alpha)", fontWeight: 600, marginTop: 8 }}>
          {t("referral.rebate_cta_learn")}
        </div>
      </div>
    </Link>
  );
}
