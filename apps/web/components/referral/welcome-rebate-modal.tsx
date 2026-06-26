"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useLang } from "@/lib/i18n-context";
import { Icons } from "@/components/ui/icons";

const WELCOMED_KEY = "gp-welcomed";

/**
 * 首登欢迎弹窗（设计稿 pageDash 首登 modal）——把"注册时绑定返佣"作为开始前最重要一步。
 * 仅首次出现（localStorage gp-welcomed），文案诚实：强调一证一户/注册时绑定/老账户无法补。
 */
export function WelcomeRebateModal() {
  const { t } = useLang();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(WELCOMED_KEY) !== "1") setOpen(true);
    } catch {
      /* localStorage 不可用时不打扰 */
    }
  }, []);

  const dismiss = () => {
    try {
      localStorage.setItem(WELCOMED_KEY, "1");
    } catch {
      /* noop */
    }
    setOpen(false);
  };

  const goFees = () => {
    dismiss();
    router.push("/learn/fees");
  };

  if (!open) return null;

  return (
    <div
      data-testid="welcome-rebate-modal"
      onClick={dismiss}
      style={{ position: "fixed", inset: 0, background: "rgba(6,9,13,0.72)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, padding: 20 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ position: "relative", overflow: "hidden", background: "var(--bg-1)", border: "1px solid var(--alpha-tint-strong)", borderRadius: 16, padding: 28, maxWidth: 440, width: "100%" }}
      >
        <div style={{ position: "absolute", top: -40, right: -40, width: 160, height: 160, borderRadius: "50%", background: "radial-gradient(circle, var(--alpha) 0%, transparent 70%)", opacity: 0.16, pointerEvents: "none" }} />
        <div style={{ width: 48, height: 48, borderRadius: 13, background: "var(--alpha-tint-strong)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
          <Icons.Sparkles size={24} style={{ color: "var(--alpha)" }} />
        </div>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 600, letterSpacing: -0.4, margin: "0 0 8px" }}>{t("welcome.title")}</h2>
        <p style={{ fontSize: 13, color: "var(--fg-1)", lineHeight: 1.7, margin: "0 0 10px" }}>{t("referral.empty_body")}</p>
        <p style={{ fontSize: 12, color: "var(--alpha)", lineHeight: 1.6, margin: "0 0 22px" }}>{t("referral.oneshot_warning")}</p>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button
            data-testid="welcome-later"
            onClick={dismiss}
            style={{ height: 40, padding: "0 16px", background: "transparent", border: "1px solid var(--border-default)", borderRadius: 9, fontSize: 13, fontWeight: 500, color: "var(--fg-1)", cursor: "pointer", fontFamily: "var(--font-sans)" }}
          >
            {t("welcome.later")}
          </button>
          <button
            data-testid="welcome-cta"
            onClick={goFees}
            style={{ height: 40, padding: "0 18px", background: "var(--alpha)", border: "none", borderRadius: 9, fontSize: 13, fontWeight: 600, color: "var(--btn-fg)", cursor: "pointer", fontFamily: "var(--font-sans)" }}
          >
            {t("referral.rebate_cta_learn")}
          </button>
        </div>
      </div>
    </div>
  );
}
