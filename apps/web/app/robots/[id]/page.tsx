"use client";

import React, { use, useState } from "react";
import Link from "next/link";
import { Shell } from "@/components/shell/shell";
import { useRobot, usePauseRobot, useStartRobot, useStopRobot, useAddBox, useRemoveBox, useEditBox } from "@/lib/hooks/useBots";
import { Button, SectionHeader, ExchangeMark } from "@/components/ui/primitives";
import { TermHelp } from "@/components/ui/term-help";
import { MonitorPanel } from "./_monitor";
import { Icons } from "@/components/ui/icons";
import { toast } from "sonner";
import { deriveLayout, fmt } from "@/lib/store";
import { useLang } from "@/lib/i18n-context";
import { useBotEvents } from "@/lib/hooks/useBotEvents";
import { CopyRobotButton } from "@/components/robots/copy-robot-button";
import { BoxForm } from "@/components/robots/box-form";
import {
  type BoxFormValue,
  emptyBoxFormValue,
  boxFormValueFromBox,
  boxFormValueToAddBoxInput,
  boxFormErrors,
  boxFormPreviewLayout,
} from "@/components/robots/box-form-model";


export default function RobotDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: robot, isLoading } = useRobot(id);
  const startRobot = useStartRobot();
  const pauseRobot = usePauseRobot();
  const stopRobot = useStopRobot();
  const addBox = useAddBox(id);
  const removeBox = useRemoveBox(id);
  const editBox = useEditBox(id);
  const { t } = useLang();

  const [showAddBox, setShowAddBox] = useState(false);
  const [editTarget, setEditTarget] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<string | null>(null);
  const [removeClosePos, setRemoveClosePos] = useState(false);
  const [showStopDialog, setShowStopDialog] = useState(false);
  const [stopClosePos, setStopClosePos] = useState(true);
  const [boxError, setBoxError] = useState<string | null>(null);
  const [boxValue, setBoxValue] = useState<BoxFormValue>(emptyBoxFormValue());

  const liveEvents = useBotEvents(robot?.activeSessionCode ?? null);
  const liveUnrealized = liveEvents.liveStatus?.unrealizedPnl ?? 0;

  if (isLoading || !robot) {
    return (
      <Shell breadcrumb={[t("robot.nav"), id]}>
        <div style={{ padding: 40, textAlign: "center", color: "var(--fg-3)" }}>{t("common.loading")}</div>
      </Shell>
    );
  }

  const openAddBox = () => {
    setBoxValue(emptyBoxFormValue());
    setEditTarget(null);
    setShowAddBox(true);
  };

  const openEditBox = (b: typeof robot.boxes[number]) => {
    setBoxValue(boxFormValueFromBox(b));
    setEditTarget(b.id);
    setShowAddBox(true);
  };

  const submitBox = () => {
    if (editTarget) {
      const { direction: _direction, ...payload } = boxFormValueToAddBoxInput(boxValue, robot.direction);
      editBox.mutate({ configId: editTarget, input: payload }, {
        onSuccess: () => { toast.success(t("robot.toast_box_updated")); setShowAddBox(false); setEditTarget(null); setBoxError(null); },
        onError: (err: Error) => { setBoxError(t("common.update_failed", { reason: err.message })); },
      });
    } else {
      addBox.mutate(boxFormValueToAddBoxInput(boxValue, robot.direction), {
        onSuccess: () => { toast.success(t("robot.toast_box_added")); setShowAddBox(false); setBoxError(null); },
        onError: (err: Error) => { setBoxError(t("common.create_failed", { reason: err.message })); },
      });
    }
  };

  const confirmRemove = () => {
    if (!removeTarget) return;
    const configId = removeTarget;
    removeBox.mutate({ configId, closePosition: removeClosePos }, {
      onSuccess: () => { toast.success(t("robot.toast_box_removed")); setRemoveTarget(null); setRemoveClosePos(false); },
        onError: (err: Error) => { toast.error(t("common.delete_failed", { reason: err.message })); },
    });
  };

  // 几何错误仅在能出预览（参数足够）时才阻止提交，与 BoxForm 的 `layout && errs.geometry` 展示守卫保持一致；激活错误本身已隐含 layout 存在。
  const boxSubmitErrors = boxFormErrors(boxValue, robot.direction);
  const boxSubmitLayout = boxFormPreviewLayout(boxValue, robot.direction);
  const isBoxSubmitDisabled = (!!boxSubmitLayout && !!boxSubmitErrors.geometry) || !!boxSubmitErrors.activation;
  // 归档（STOPPED 终态）为只读：隐藏箱体写操作控件，与后端 ROBOT_ARCHIVED 守卫呼应（纵深防御）。
  const isArchived = robot.status === "STOPPED";

  return (
    <Shell breadcrumb={[t("robot.nav"), robot.symbol]}>
      <Link
        href="/robots"
        style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, color: "var(--fg-2)", marginBottom: 14 }}
      >
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M10 3L5 8l5 5" /></svg>
        {t("robot.nav")}
      </Link>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, marginBottom: 18, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
          <ExchangeMark exchange={(robot.exchangeId === "binance" || robot.exchangeId === "gateio" || robot.exchangeId === "okx") ? robot.exchangeId : "gateio"} size={42} />
          <div>
            <h1 style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 600, letterSpacing: -0.5 }} data-testid="robot-symbol">
              {robot.symbol}
              <span data-testid="robot-exchange" style={{ fontSize: 12, color: "var(--fg-3)", marginLeft: 8, fontWeight: 400, fontFamily: "var(--font-sans)" }}>{fmt.exchangeName(robot.exchangeId)} · {robot.accountLabel}</span>
            </h1>
            <div style={{ fontSize: 12, color: "var(--fg-2)", marginTop: 3 }}>
              {t(`dir.${robot.direction}`)} · <span data-testid="robot-status">{robot.status}</span> · {t("kpi.mark")} <span className="num" style={{ color: "var(--fg-1)" }}>{robot.latestPrice != null ? robot.latestPrice.toFixed(2) : "—"}</span>
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {robot.status === "RUNNING" && (
            <Button variant="ghost" size="md" icon={<Icons.Pause size={13} />} onClick={() => pauseRobot.mutate(robot.id, { onSuccess: () => toast.success(t("robot.toast_paused")) })}>{t("robot.action_pause")}</Button>
          )}
          {robot.status === "PAUSED" && (
            <Button variant="primary" size="md" icon={<Icons.Play size={13} />} onClick={() => startRobot.mutate(robot.id, { onSuccess: () => toast.success(t("robot.toast_started")) })}>{t("robot.action_start")}</Button>
          )}
          {robot.status !== "STOPPED" && (
            <Button danger size="md" icon={<Icons.Stop size={13} />} disabled={robot.status === "STOPPING"} onClick={() => { setStopClosePos(true); setShowStopDialog(true); }}>{t("robot.action_stop")}</Button>
          )}
          {robot.status === "STOPPED" && (
            <CopyRobotButton robotId={robot.id} />
          )}
        </div>
      </div>

      <MonitorPanel robot={robot} mainSlot={
        <div style={{ display: "flex", flexDirection: "column" }}>
          <SectionHeader title={t("robot.boxes_title")} subtitle={t("robot.boxes_subtitle", { n: robot.boxes.length })} action={
            isArchived ? undefined : <Button variant="primary" size="sm" icon={<Icons.Plus size={13} />} onClick={openAddBox} data-testid="add-box-btn">{t("robot.add_box")}</Button>
          } />
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
        {robot.boxes.length === 0 ? (
          <div style={{ padding: 24, textAlign: "center", color: "var(--fg-3)" }}>{t("robot.no_boxes")}</div>
        ) : (
          robot.boxes.map((b) => {
            // 真实箱体边界：用 deriveBoxLines 计算（LONG/SHORT 通用）
            const { boxLowPrice, boxHighPrice } = deriveLayout({
              takeProfitPrice: b.takeProfitPrice,
              direction: ((b.direction ?? "LONG") as "LONG" | "SHORT"),
              mainGridCount: b.mainGridCount,
              mainGridStep: b.mainGridStep,
              stopLossGridCount: b.stopLossGridCount,
              stopLossGridStep: b.stopLossGridStep,
              isolationStep: b.isolationStep ?? b.stopLossGridStep,
            });
            const isActive = b.id === robot.activeBoxId;
            const realized = b.realizedPnl ?? 0;
            const savings = b.totalSavings ?? 0;
            // 活跃箱：箱级总盈亏 = 箱级 net（后端已含手续费扣除）+ 当前实时未实现盈亏。
            // 活跃箱持有全部仓位，故 liveUnrealized 即为该箱的未实现。
            // 非活跃箱：未实现恒为 0，仅展示 box.netPnl（= realized − fees − funding）。
            const boxNetPnl = b.netPnl ?? 0;
            const boxUnrealized = isActive ? liveUnrealized : 0;
            const boxTotal = boxNetPnl + boxUnrealized;
            const money = (v: number) => `${v >= 0 ? "+" : ""}$${v.toFixed(2)}`;
            const pnlColor = (v: number) => (v >= 0 ? "var(--up)" : "var(--down)");
            // 配置压成一行可读文本（箱版 A）；保留全部术语帮助 TermHelp
            const cfg: [string, string | number, string][] = [
              [t("robot.cfg_take_profit"), b.takeProfitPrice, "takeProfit"],
              [t("robot.cfg_main_grid"), `${b.mainGridCount}×${b.mainGridStep}`, "mainGrid"],
              [t("robot.cfg_portion"), b.mainGridPortionSize, "portionSize"],
              [t("robot.cfg_leverage"), `${b.leverage}x`, "leverage"],
              [t("robot.cfg_stop_loss"), b.stopLossGridCount === 0 ? t("robot.cfg_none") : `${b.stopLossGridCount}×${b.stopLossGridStep}`, "stopLoss"],
              [t("robot.cfg_isolation"), b.isolationStep ?? b.stopLossGridStep, "isolation"],
              [t("robot.cfg_activation"), b.activationPrice > 0 ? b.activationPrice : t("robot.cfg_auto"), "activation"],
              [t("robot.cfg_trailing"), b.trailingEntry ? `${(b.trailingCallbackRate * 100).toFixed(2)}%` : "—", "trailingEntry"],
            ];
            return (
              <div key={b.id} data-testid="box-row" style={{ position: "relative", overflow: "hidden", padding: "14px 16px", background: isActive ? "var(--bg-2)" : "var(--bg-1)", border: `1px solid ${isActive ? "var(--accent)" : "var(--border-subtle)"}`, borderRadius: 14, display: "flex", flexDirection: "column", gap: 10 }}>
                {isActive && <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: "var(--accent)" }} />}
                {/* 顶行：身份 + 盈亏分解（左） / 总体盈亏大号 + 操作（右） */}
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: b.direction === "SHORT" ? "var(--down)" : "var(--up)" }}>{b.direction === "SHORT" ? t("dir.SHORT") : t("dir.LONG")}</span>
                      <span className="num" style={{ fontSize: 14 }}>{boxLowPrice.toFixed(2)} — {boxHighPrice.toFixed(2)}</span>
                      {isActive
                        ? <span style={{ fontSize: 11, color: "var(--accent)" }}>● {t("fsm.RUNNING")}</span>
                        : <span style={{ fontSize: 11, color: "var(--fg-3)" }}>{t("robot.box_standby")}</span>}
                      {b.stopLossGridCount === 0 && <span style={{ fontSize: 11, color: "var(--fg-3)" }}>{t("robot.box_no_stop_loss")}</span>}
                      {!b.enabled && <span style={{ fontSize: 11, color: "var(--fg-3)" }}>{t("common.disabled")}</span>}
                    </div>
                    <div className="num" style={{ fontSize: 11.5, display: "flex", gap: 16, flexWrap: "wrap" }}>
                      <span data-testid="box-pnl" style={{ display: "inline-flex", alignItems: "center" }}><span style={{ color: "var(--fg-3)" }}>{t("robot.pnl_realized")} </span><span style={{ color: pnlColor(realized), fontWeight: 500 }}>{money(realized)}</span><TermHelp term="realizedPnl" title={t("kpi.realized")} /></span>
                      <span data-testid="box-pnl" style={{ display: "inline-flex", alignItems: "center" }}><span style={{ color: "var(--fg-3)" }}>{t("robot.pnl_savings")} </span><span style={{ color: pnlColor(savings), fontWeight: 500 }}>{money(savings)}</span><TermHelp term="savings" title={t("bot.fill_savings")} /></span>
                      {isActive && <span data-testid="box-pnl" style={{ display: "inline-flex", alignItems: "center" }}><span style={{ color: "var(--fg-3)" }}>{t("robot.pnl_unrealized")} </span><span style={{ color: pnlColor(boxUnrealized), fontWeight: 500 }}>{money(boxUnrealized)}</span><TermHelp term="unrealizedPnl" title={t("kpi.unrealized")} /></span>}
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8, flexShrink: 0 }}>
                    <div data-testid="box-pnl" style={{ textAlign: "right" }}>
                      {isActive ? (
                        // 活跃箱：值 = netPnl + 未实现；用 robotTotalPnl 术语（含手续费/资金费 + 未实现）
                        <div style={{ fontSize: 10, color: "var(--fg-3)", display: "flex", alignItems: "center", justifyContent: "flex-end" }}>{t("kpi.total_pnl")}<TermHelp term="robotTotalPnl" title={t("kpi.total_pnl")} /></div>
                      ) : (
                        // 非活跃箱：值 = 纯 netPnl（已实现 − 手续费 − 资金费，未实现恒为 0）
                        <div style={{ fontSize: 10, color: "var(--fg-3)", display: "flex", alignItems: "center", justifyContent: "flex-end" }}>{t("kpi.net_pnl")}<TermHelp term="netPnl" title={t("kpi.net_pnl")} /></div>
                      )}
                      <div className="num" style={{ fontSize: 20, fontWeight: 600, color: pnlColor(boxTotal) }}>{money(boxTotal)}</div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <Link href={`/robots/${id}/boxes/${b.id}`} style={{ fontSize: 12, color: "var(--accent)" }} data-testid="box-history-link">{t("robot.box_history")}</Link>
                      {!isArchived && (
                        <>
                          <Button variant="ghost" size="sm" icon={<Icons.Edit size={13} />} onClick={() => openEditBox(b)} data-testid="edit-box-btn">{t("common.edit")}</Button>
                          <Button variant="ghost" size="sm" danger icon={<Icons.Trash size={13} />} onClick={() => { setRemoveTarget(b.id); setRemoveClosePos(false); }} data-testid="remove-box-btn">{t("common.delete")}</Button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
                {/* 配置行：一行可读文本，逐项保留术语帮助 */}
                <div data-testid="box-config" style={{ fontSize: 11.5, color: "var(--fg-3)", borderTop: "1px solid var(--border-subtle)", paddingTop: 9, display: "flex", flexWrap: "wrap", alignItems: "center", rowGap: 2 }}>
                  {cfg.map(([label, value, term], i) => (
                    <span key={label} style={{ display: "inline-flex", alignItems: "center" }}>
                      {i > 0 && <span style={{ margin: "0 8px", color: "var(--border-default)" }}>·</span>}
                      {label}<TermHelp term={term} title={label} />
                      <span className="num" style={{ color: "var(--fg-1)", fontWeight: 500, marginLeft: 4 }}>{value}</span>
                    </span>
                  ))}
                </div>
              </div>
            );
          })
        )}
      </div>
        </div>
      } />

      {/* 新增箱体弹窗 */}
      {showAddBox && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200 }}>
          <div style={{ background: "var(--bg-1)", border: "1px solid var(--border-strong)", borderRadius: 16, padding: 28, width: "100%", maxWidth: 720 }}>
            <div style={{ fontSize: 16, fontWeight: 500, marginBottom: 16 }}>{editTarget ? t("robot.edit_box") : t("robot.add_box_titled", { direction: robot.direction })}</div>
            {editTarget && editTarget === robot.activeBoxId && (
              <div style={{ fontSize: 12, color: "var(--down)", marginBottom: 12, lineHeight: 1.6 }}>
                {t("robot.edit_active_warning")}
              </div>
            )}
            <BoxForm value={boxValue} onChange={setBoxValue} direction={robot.direction === "SHORT" ? "SHORT" : "LONG"} price={robot.latestPrice ?? 0} />
            {boxError && <div data-testid="box-error" style={{ fontSize: 11, color: "var(--down)", marginTop: 8, padding: 8, background: "rgba(239,68,68,0.06)", borderRadius: 4 }}>{boxError}</div>}
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 20 }}>
              <Button variant="ghost" onClick={() => { setShowAddBox(false); setEditTarget(null); }}>{t("common.cancel")}</Button>
              <Button variant="primary" onClick={submitBox} data-testid="add-box-submit" disabled={isBoxSubmitDisabled}>{editTarget ? t("robot.save_changes") : t("robot.confirm_add")}</Button>
            </div>
          </div>
        </div>
      )}

      {/* 删活跃箱平仓选择弹窗 */}
      {removeTarget && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200 }}>
          <div style={{ background: "var(--bg-1)", border: "1px solid var(--border-strong)", borderRadius: 16, padding: 28, width: "100%", maxWidth: 440 }}>
            <div style={{ fontSize: 16, fontWeight: 500, marginBottom: 8 }}>{t("robot.remove_box_title")}</div>
            <div style={{ fontSize: 13, color: "var(--fg-2)", marginBottom: 16, lineHeight: 1.6 }}>
              {removeTarget === robot.activeBoxId
                ? t("robot.remove_active_body")
                : t("robot.remove_body")}
            </div>
            {removeTarget === robot.activeBoxId && (
              <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, fontSize: 13, cursor: "pointer" }}>
                <input type="checkbox" checked={removeClosePos} onChange={(e) => setRemoveClosePos(e.target.checked)} data-testid="close-pos-checkbox" />
                {t("robot.remove_close_pos")}
              </label>
            )}
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <Button variant="ghost" onClick={() => { setRemoveTarget(null); setRemoveClosePos(false); }}>{t("common.cancel")}</Button>
              <Button danger onClick={confirmRemove} data-testid="confirm-remove-box">{t("robot.confirm_remove")}</Button>
            </div>
          </div>
        </div>
      )}

      {/* 停止机器人弹窗 */}
      {showStopDialog && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200 }}>
          <div style={{ background: "var(--bg-1)", border: "1px solid var(--border-strong)", borderRadius: 16, padding: 28, width: "100%", maxWidth: 440 }}>
            <div style={{ fontSize: 16, fontWeight: 500, marginBottom: 8 }}>{t("bot.stop_modal_title")}</div>
            <div style={{ fontSize: 13, color: "var(--fg-2)", marginBottom: 16, lineHeight: 1.6 }}>
              {t("bot.stop_modal_body")}
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, fontSize: 13, cursor: "pointer" }}>
              <input type="checkbox" checked={stopClosePos} onChange={(e) => setStopClosePos(e.target.checked)} data-testid="stop-close-pos-checkbox" />
              {t("bot.stop_close_position")}
            </label>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <Button variant="ghost" onClick={() => { setShowStopDialog(false); setStopClosePos(true); }}>{t("common.cancel")}</Button>
              <Button danger onClick={() => {
                stopRobot.mutate({ id: robot.id, closePosition: stopClosePos }, {
                  onSuccess: () => { toast.success(t("bot.stop_submitted")); },
                });
                setShowStopDialog(false);
                setStopClosePos(true);
              }} data-testid="confirm-stop-robot">{t("common.confirm_stop")}</Button>
            </div>
          </div>
        </div>
      )}
    </Shell>
  );
}
