"use client";

import React, { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { robotApi } from "@/lib/api";
import { useCredentials } from "@/lib/hooks/useCredentials";
import { useLang } from "@/lib/i18n-context";
import { Button } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/modal";
import { Icons } from "@/components/ui/icons";
import { BoxForm } from "./box-form";
import { SymbolPicker } from "@/components/robots/symbol-picker";
import { ReferralRegisterPrompt } from "@/components/referral/referral-register-prompt";
import {
  type BoxFormValue,
  emptyBoxFormValue,
  boxFormValueFromBox,
  boxFormValueFromRecommendation,
  boxFormValueToAddBoxInput,
  boxFormErrors,
} from "./box-form-model";

interface WizardBox { key: string; value: BoxFormValue; }

// 字段卡：圆角输入容器，label 11.5px/fg-2，输入 height 36/圆角8/mono 值（对齐设计稿 1000-1010 行）
const fieldLabel: React.CSSProperties = { fontSize: 11.5, color: "var(--fg-2)", marginBottom: 6, fontWeight: 500 };
const inputShell: React.CSSProperties = {
  display: "flex", alignItems: "center", height: 36, background: "var(--bg-2)",
  border: "1px solid var(--border-default)", borderRadius: 8, padding: "0 11px",
};
const selectStyle: React.CSSProperties = {
  ...inputShell, width: "100%", color: "var(--fg-0)", fontSize: 13,
  fontFamily: "var(--font-mono)", cursor: "pointer",
  appearance: "none", WebkitAppearance: "none", MozAppearance: "none",
};
// 小节标题：display 字体
const sectionTitle: React.CSSProperties = { fontSize: 13, fontWeight: 600, marginBottom: 16, fontFamily: "var(--font-display)", letterSpacing: -0.2 };

export function RobotWizard() {
  const router = useRouter();
  const { t } = useLang();
  const searchParams = useSearchParams();
  const from = searchParams.get("from");
  const seedBoxRaw = searchParams.get("seedBox");
  const { data: credentials } = useCredentials();
  const creds = credentials ?? [];

  const keySeqRef = useRef(0);
  const makeBox = (value: BoxFormValue): WizardBox => {
    keySeqRef.current += 1;
    return { key: `box-${keySeqRef.current}`, value };
  };

  const [step, setStep] = useState(1);
  const [credentialId, setCredentialId] = useState("");
  const [symbol, setSymbol] = useState("ETH/USDT");
  const [direction, setDirection] = useState<"LONG" | "SHORT">("LONG");
  const [boxes, setBoxes] = useState<WizardBox[]>(() => [makeBox(emptyBoxFormValue())]);
  const [editing, setEditing] = useState(0);
  const [latestPrice, setLatestPrice] = useState(0);
  const [createError, setCreateError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [symbolBlocked, setSymbolBlocked] = useState(false);
  const [showLiveConfirm, setShowLiveConfirm] = useState(false);

  const selectedExchangeId = credentials?.find((c) => c.id === credentialId)?.exchangeId;
  const selectedEnvironment = credentials?.find((c) => c.id === credentialId)?.environment;

  // seedBox 预填（AI 推荐一键创建，from 优先）
  useEffect(() => {
    if (from || !seedBoxRaw) return;
    try {
      const seed = JSON.parse(seedBoxRaw) as { symbol?: string; direction?: string; box?: Parameters<typeof boxFormValueFromRecommendation>[0] };
      if (seed.symbol) setSymbol(seed.symbol);
      if (seed.direction) setDirection(seed.direction === "SHORT" ? "SHORT" : "LONG");
      if (seed.box) { setBoxes([makeBox(boxFormValueFromRecommendation(seed.box))]); setEditing(0); }
    } catch {
      // 非法 seedBox：保持空白默认
    }
  }, [from, seedBoxRaw]);

  // 种子预填（复制）
  useEffect(() => {
    if (!from) return;
    let cancelled = false;
    robotApi.get(from).then((r) => {
      if (cancelled) return;
      setSymbol(r.symbol);
      setDirection(r.direction === "SHORT" ? "SHORT" : "LONG");
      setCredentialId(r.credentialId ?? "");
      setLatestPrice(r.latestPrice ?? 0);
      const seeded = (r.boxes ?? []).map((b) => makeBox(boxFormValueFromBox(b)));
      setBoxes(seeded.length > 0 ? seeded : [makeBox(emptyBoxFormValue())]);
      setEditing(0);
    }).catch(() => {
      // 种子加载失败：保持空白默认让用户手填，并提示，避免误以为已按原配置预填。
      if (!cancelled) toast.error(t("robot.wizard_copy_failed"));
    });
    return () => { cancelled = true; };
  }, [from]);

  const goNext = () => {
    if (step === 1) {
      if (!credentialId) { toast.error(t("robot.wizard_pick_account")); return; }
      if (symbolBlocked || !symbol.trim()) return; // 交易对未选/山寨未确认/超长 → 不放行
      setStep(2); return;
    }
    if (step === 2) {
      if (boxes.length < 1) { toast.error(t("robot.wizard_need_box")); return; }
      const bad = boxes.findIndex((b) => {
        const e = boxFormErrors(b.value, direction);
        return e.geometry != null || e.activation != null;
      });
      if (bad >= 0) { toast.error(t("robot.wizard_box_invalid", { n: bad + 1 })); setEditing(bad); return; }
      setStep(3); return;
    }
  };
  const goBack = () => setStep((s) => Math.max(1, s - 1));

  const updateBox = (idx: number, value: BoxFormValue) =>
    setBoxes((prev) => prev.map((b, i) => (i === idx ? { ...b, value } : b)));
  const appendBox = () => {
    setBoxes((prev) => [...prev, makeBox(emptyBoxFormValue())]);
    setEditing(boxes.length); // 新箱索引 = 当前长度
  };
  const removeBox = (idx: number) => {
    setBoxes((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      return next.length > 0 ? next : [makeBox(emptyBoxFormValue())];
    });
    // 移除按钮仅在 boxes.length>1 时出现，故移除后新长度>=1，最大有效索引=boxes.length-2
    setEditing((e) => Math.max(0, Math.min(e, boxes.length - 2)));
  };

  const handleCreate = async () => {
    setCreateError(null);
    setSubmitting(true);
    try {
      const res = await robotApi.create({ credentialId, symbol, direction });
      const robotId = res.robotId;
      for (let i = 0; i < boxes.length; i++) {
        try {
          await robotApi.addBox(robotId, boxFormValueToAddBoxInput(boxes[i].value, direction));
        } catch (err) {
          toast.error(t("robot.wizard_box_create_failed", { n: i + 1, reason: (err as Error).message }));
          router.push(`/robots/${robotId}`);
          return;
        }
      }
      toast.success(t("robot.wizard_created"));
      router.push(`/robots/${robotId}`);
    } catch (err) {
      setCreateError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const steps = [t("robot.wizard_step_basic"), t("robot.wizard_step_box"), t("robot.wizard_step_review")];

  return (
    <div style={{ maxWidth: 760, marginTop: 16 }}>
      {/* 步骤指示器：激活青底深字圆点 + 连接线（对齐设计稿 981-989 行） */}
      <div style={{ display: "flex", alignItems: "center", gap: 0, marginBottom: 24 }}>
        {steps.map((label, i) => {
          const n = i + 1;
          const active = step === n;
          const done = step > n;
          const circleBg = active ? "var(--accent)" : done ? "var(--up)" : "var(--bg-3)";
          const circleFg = active || done ? "var(--btn-fg)" : "var(--fg-3)";
          return (
            <React.Fragment key={label}>
              <div data-testid={`wizard-step-${n}`} style={{ display: "flex", alignItems: "center", gap: 9, flexShrink: 0 }}>
                <div style={{
                  width: 26, height: 26, borderRadius: "50%", background: circleBg, color: circleFg,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 600,
                }}>
                  {done ? <Icons.Check size={12} /> : n}
                </div>
                <span style={{ fontSize: 12.5, fontWeight: active ? 600 : 400, color: active ? "var(--fg-0)" : done ? "var(--fg-1)" : "var(--fg-3)" }}>{label}</span>
              </div>
              {n < steps.length && (
                <div style={{ flex: 1, height: 1.5, margin: "0 12px", background: done ? "var(--accent)" : "var(--border-default)" }} />
              )}
            </React.Fragment>
          );
        })}
      </div>

      {step === 1 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {creds.length === 0 && <ReferralRegisterPrompt />}
          <div style={{ background: "var(--bg-1)", border: "1px solid var(--border-subtle)", borderRadius: 14, padding: 20, display: "flex", flexDirection: "column", gap: 18 }}>
            <div style={sectionTitle}>{t("robot.wizard_basics_title")}</div>
            <div>
              <div style={fieldLabel}>{t("robot.wizard_account")}</div>
              <div style={{ position: "relative" }}>
                <select value={credentialId} onChange={(e) => setCredentialId(e.target.value)} data-testid="wizard-cred-select" style={selectStyle}>
                  <option value="">{t("robot.wizard_account_placeholder")}</option>
                  {creds.map((c) => (
                    <option key={c.id} value={c.id}>{[c.exchangeId, c.label, c.accountId].filter(Boolean).join(" / ")}</option>
                  ))}
                </select>
                <span style={{ position: "absolute", right: 11, top: "50%", transform: "translateY(-50%)", color: "var(--fg-3)", pointerEvents: "none", display: "flex" }}><Icons.ChevronDown size={14} /></span>
              </div>
            </div>
            <div>
              <div style={fieldLabel}>{t("ai.symbol")}</div>
              <SymbolPicker value={symbol} exchangeId={selectedExchangeId} onChange={setSymbol} onBlockedChange={setSymbolBlocked} />
            </div>
            <div>
              <div style={fieldLabel}>{t("robot.wizard_direction")}</div>
              <div style={{ display: "flex", gap: 10 }}>
                {(["LONG", "SHORT"] as const).map((d) => {
                  const sel = direction === d;
                  const tint = d === "LONG" ? "var(--up)" : "var(--down)";
                  const tintBg = d === "LONG" ? "var(--up-tint)" : "var(--down-tint)";
                  return (
                    <button
                      key={d}
                      type="button"
                      data-testid={`wizard-dir-${d}`}
                      onClick={() => setDirection(d)}
                      style={{
                        flex: 1, height: 38, borderRadius: 9, cursor: "pointer",
                        fontSize: 13, fontWeight: sel ? 600 : 500, fontFamily: "var(--font-sans)",
                        background: sel ? tintBg : "var(--bg-2)",
                        border: `1px solid ${sel ? tint : "var(--border-subtle)"}`,
                        color: sel ? tint : "var(--fg-2)",
                      }}
                    >
                      {d === "LONG" ? `${t("dir.LONG")} LONG` : `${t("dir.SHORT")} SHORT`}
                    </button>
                  );
                })}
              </div>
              {/* 隐藏 select 保留 testid 与无障碍/测试兼容 */}
              <select
                value={direction}
                onChange={(e) => setDirection(e.target.value === "SHORT" ? "SHORT" : "LONG")}
                data-testid="wizard-dir-select"
                aria-label={t("robot.wizard_direction")}
                style={{ position: "absolute", width: 1, height: 1, padding: 0, margin: -1, overflow: "hidden", clip: "rect(0 0 0 0)", border: 0 }}
              >
                <option value="LONG">{t("dir.LONG")} LONG</option>
                <option value="SHORT">{t("dir.SHORT")} SHORT</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {step === 2 && (
        <div style={{ background: "var(--bg-1)", border: "1px solid var(--border-subtle)", borderRadius: 14, padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={sectionTitle}>{t("robot.wizard_box_params")}</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {boxes.map((b, i) => (
              <span key={b.key} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <Button variant={i === editing ? "primary" : "ghost"} size="sm" onClick={() => setEditing(i)} data-testid={`wizard-box-tab-${i}`}>{t("robot.wizard_box_n", { n: i + 1 })}</Button>
                {boxes.length > 1 && <Button variant="ghost" size="sm" danger onClick={() => removeBox(i)} data-testid={`wizard-box-remove-${i}`} icon={<Icons.X size={12} />} />}
              </span>
            ))}
            <Button variant="ghost" size="sm" onClick={appendBox} data-testid="wizard-box-add" icon={<Icons.Plus size={13} />}>{t("robot.add_box")}</Button>
          </div>
          {boxes[editing] && (
            <BoxForm value={boxes[editing].value} onChange={(v) => updateBox(editing, v)} direction={direction} price={latestPrice} />
          )}
        </div>
      )}

      {step === 3 && (
        <div style={{ background: "var(--bg-1)", border: "1px solid var(--border-subtle)", borderRadius: 14, padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={sectionTitle}>{t("robot.wizard_step_review")}</div>
          <div data-testid="wizard-review" style={{ display: "flex", flexDirection: "column", gap: 11, fontSize: 12 }}>
            <ReviewRow label={t("robot.wizard_account")} value={creds.find((c) => c.id === credentialId)?.label ?? credentialId} />
            <ReviewRow label={t("ai.symbol")} value={symbol} mono />
            <ReviewRow label={t("robot.wizard_direction")} value={t(`dir.${direction}`)} valueColor={direction === "LONG" ? "var(--up)" : "var(--down)"} />
            <ReviewRow label={t("robot.wizard_box_count")} value={String(boxes.length)} mono />
            <div style={{ borderTop: "1px solid var(--border-subtle)", paddingTop: 11, display: "flex", flexDirection: "column", gap: 8 }}>
              {boxes.map((b, i) => (
                <div key={b.key} style={{ fontSize: 11.5, color: "var(--fg-2)", fontFamily: "var(--font-mono)" }}>
                  <span style={{ color: "var(--fg-1)", fontWeight: 600 }}>{t("robot.wizard_box_n", { n: i + 1 })}</span>
                  {"  "}{t("robot.field_take_profit")} {b.value.takeProfitPrice || "—"} · {t("robot.field_grid_count")} {b.value.mainGridCount || "—"}×{b.value.mainGridStep || "—"} · {t("robot.cfg_leverage")} {b.value.leverage}x
                </div>
              ))}
            </div>
          </div>
          {createError && (
            <div data-testid="wizard-create-error" style={{ fontSize: 12, color: "var(--down)", padding: "8px 11px", background: "var(--down-tint)", borderRadius: 8, border: "1px solid var(--down-tint)" }}>{createError}</div>
          )}
        </div>
      )}

      {/* 底部导航 */}
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 22 }}>
        <Button variant="ghost" onClick={() => router.push("/robots")} disabled={submitting}>{t("common.cancel")}</Button>
        {step > 1 && <Button variant="outline" onClick={goBack} data-testid="wizard-back" icon={<Icons.ChevronRight size={14} style={{ transform: "rotate(180deg)" }} />}>{t("robot.wizard_back")}</Button>}
        {step < 3 && <Button variant="primary" onClick={goNext} data-testid="wizard-next" icon={<Icons.ChevronRight size={14} />}>{t("robot.wizard_next")}</Button>}
        {step === 3 && (
          <Button
            variant="primary"
            onClick={() => { if (selectedEnvironment !== "demo") { setShowLiveConfirm(true); } else { handleCreate(); } }}
            loading={submitting}
            data-testid="wizard-create"
            icon={<Icons.Check size={14} />}
          >
            {t("robot.wizard_create")}
          </Button>
        )}
      </div>

      <Modal
        open={showLiveConfirm}
        title={t("robot.live_confirm_title")}
        onClose={() => setShowLiveConfirm(false)}
      >
        <div data-testid="wizard-live-confirm-modal" style={{ fontSize: 13, color: "var(--fg-1)", marginBottom: 16 }}>
          {t("robot.live_confirm_body")}
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Button variant="ghost" data-testid="wizard-live-confirm-cancel" onClick={() => setShowLiveConfirm(false)}>{t("common.cancel")}</Button>
          <Button
            variant="primary"
            data-testid="wizard-live-confirm-ok"
            onClick={() => { setShowLiveConfirm(false); handleCreate(); }}
          >
            {t("common.confirm")}
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function ReviewRow({ label, value, mono, valueColor }: { label: string; value: string; mono?: boolean; valueColor?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
      <span style={{ color: "var(--fg-2)" }}>{label}</span>
      <span style={{ fontWeight: 500, color: valueColor ?? "var(--fg-0)", fontFamily: mono ? "var(--font-mono)" : undefined }}>{value}</span>
    </div>
  );
}
