"use client";

import React from "react";
import Link from "next/link";
import { Shell } from "@/components/shell/shell";
import { useRobots, usePauseRobot, useStartRobot, useStopRobot, useArchivedRobots } from "@/lib/hooks/useBots";
import { CopyRobotButton } from "@/components/robots/copy-robot-button";
import { PnlCell } from "@/components/robots/pnl-cell";
import { Button, FsmPill, Pulse, ExchangeMark } from "@/components/ui/primitives";
import { Icons } from "@/components/ui/icons";
import { toast } from "sonner";
import { fmt } from "@/lib/store";
import { useLang } from "@/lib/i18n-context";
import type { Robot } from "@/lib/api";

/**
 * 列表数据只有 robot.status（RUNNING/PAUSED/STOPPING/STOPPED）+ activeBoxId，
 * 没有箱体级 FSM。映射到设计稿的状态 pill：
 * RUNNING+活跃箱体 → RUNNING（绿脉冲）；RUNNING 但无活跃箱体 → TRAILING_ENTRY（金，追踪建仓）；
 * PAUSED → PAUSED；其余沿用原状态字符串。
 */
function pillState(r: Robot): string {
  if (r.status === "RUNNING") return r.activeBoxId ? "RUNNING" : "TRAILING_ENTRY";
  return r.status;
}

const DIR_TONE: Record<string, string> = { LONG: "var(--up)", SHORT: "var(--down)" };

function exchangeKey(id: string): "binance" | "gateio" | "okx" {
  return id === "binance" || id === "gateio" || id === "okx" ? id : "gateio";
}

function StatusPill({ r, t }: { r: Robot; t: (k: string) => string }) {
  const state = pillState(r);
  // STOPPING 没有 fsm.* 文案，单独渲染一个降级 pill。
  if (state === "STOPPING") {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "2px 8px", fontSize: 11, fontWeight: 500, color: "var(--down)", background: "var(--down-tint)", borderRadius: 999 }}>
        <Pulse color="var(--down)" size={6} />
        {t("robot.action_stopping")}
      </span>
    );
  }
  return <FsmPill state={state} size="sm" t={t} />;
}

function statusSubtitle(r: Robot, t: (k: string) => string): string {
  if (r.status === "RUNNING") return r.activeBoxId ? t("robot.status_active") : t("robot.status_monitoring");
  if (r.status === "PAUSED") return t("robot.status_paused_hint");
  if (r.status === "STOPPING") return t("robot.action_stopping");
  return t("robot.status_monitoring");
}

export default function RobotsPage() {
  const { t } = useLang();
  const { data: robots, isLoading } = useRobots();
  const startRobot = useStartRobot();
  const pauseRobot = usePauseRobot();
  const stopRobot = useStopRobot();
  const list = robots ?? [];
  const { data: archived } = useArchivedRobots();
  const recentArchived = (archived ?? []).slice(0, 3);

  const runningCount = list.filter((r) => r.status === "RUNNING").length;

  return (
    <Shell breadcrumb={[t("robot.nav")]}>
      {/* ── 页头 ─────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, marginBottom: 20, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontFamily: "var(--font-display)", fontSize: 23, fontWeight: 600, letterSpacing: -0.6, marginBottom: 4 }}>
            {t("robot.page_title")}
          </h1>
          <p style={{ fontSize: 13, color: "var(--fg-2)" }}>
            {t("robot.page_subtitle")}
            {list.length > 0 ? ` · ${t("robot.count_summary", { total: list.length, running: runningCount })}` : ""}
          </p>
        </div>
        <div style={{ display: "flex", gap: 9 }}>
          <Link href="/robots/archived"><Button variant="secondary" size="lg" icon={<Icons.History size={14} />}>{t("robot.nav_archived")}</Button></Link>
          <Link href="/robots/new">
            <Button variant="primary" size="lg" icon={<Icons.Plus size={14} sw={2} />} style={{ boxShadow: "0 0 0 1px var(--accent), 0 6px 18px var(--accent-tint-strong)" }}>
              {t("common.new_bot")}
            </Button>
          </Link>
        </div>
      </div>

      {/* ── 机器人卡片列表 ───────────────────────────────── */}
      {isLoading ? (
        <div style={{ padding: 40, textAlign: "center", color: "var(--fg-3)" }}>{t("common.loading")}</div>
      ) : list.length === 0 ? (
        <div style={{ padding: 40, textAlign: "center", color: "var(--fg-3)" }}>{t("robot.empty")}</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
          {list.map((r) => {
            const dimmed = r.status === "PAUSED";
            return (
              <div
                key={r.id}
                data-testid="robot-card"
                style={{
                  display: "flex", alignItems: "center", gap: 16, padding: "16px 18px",
                  background: "var(--bg-1)", border: "1px solid var(--border-subtle)", borderRadius: 13,
                  opacity: dimmed ? 0.78 : 1,
                }}
              >
                <ExchangeMark exchange={exchangeKey(r.exchangeId)} size={36} />

                {/* 交易对 + 元信息 + 状态 */}
                <Link href={`/robots/${r.id}`} style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 600 }}>
                    {r.symbol}
                    <span data-testid="robot-exchange" style={{ fontSize: 11, color: "var(--fg-3)", fontWeight: 400, fontFamily: "var(--font-mono)", marginLeft: 8 }}>
                      · {fmt.exchangeName(r.exchangeId)} · {r.accountLabel}
                      {r.activeSessionCode ? ` · ${r.activeSessionCode}` : ""}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: "var(--fg-2)", marginTop: 3, display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                    <span style={{ color: DIR_TONE[r.direction] ?? "var(--fg-1)" }}>{t(`dir.${r.direction}`)}</span>
                    ·
                    <span data-testid="robot-status"><StatusPill r={r} t={t} /></span>
                    ·
                    <span style={{ color: "var(--fg-2)" }}>{statusSubtitle(r, t)}</span>
                    ·
                    <span data-testid="robot-boxcount">{t("robot.manage_boxes", { n: r.boxCount })}</span>
                  </div>
                </Link>

                {/* 总盈亏 / 已实现 / 手续费 / 未实现 */}
                <div data-testid="robot-pnl">
                  <PnlCell realizedPnl={r.realizedPnl} totalFees={r.totalFees} netPnl={r.netPnl} totalPnl={r.totalPnl} lastUnrealizedPnl={r.lastUnrealizedPnl} />
                </div>

                {/* 标记价 */}
                <div style={{ textAlign: "right", minWidth: 84 }}>
                  <div style={{ fontSize: 10, color: "var(--fg-3)", textTransform: "uppercase", letterSpacing: 0.6 }}>{t("kpi.mark")}</div>
                  <div className="num" data-testid="robot-price" style={{ fontSize: 16 }}>
                    {r.latestPrice != null ? r.latestPrice.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"}
                  </div>
                </div>

                {/* 操作按钮 */}
                <div style={{ display: "flex", gap: 7, flexShrink: 0 }}>
                  {r.status === "RUNNING" && (
                    <>
                      <IconButton
                        ariaLabel={t("robot.action_pause")}
                        title={t("robot.action_pause")}
                        onClick={() => pauseRobot.mutate(r.id, { onSuccess: () => toast.success(t("robot.toast_paused")) })}
                      >
                        <Icons.Pause size={14} />
                      </IconButton>
                      <IconButton
                        ariaLabel={t("robot.action_stop")}
                        title={t("robot.action_stop")}
                        danger
                        onClick={() => stopRobot.mutate({ id: r.id, closePosition: true }, { onSuccess: () => toast.success(t("robot.toast_stop_submitted")) })}
                      >
                        <Icons.Stop size={13} />
                      </IconButton>
                    </>
                  )}
                  {r.status === "STOPPING" && (
                    <IconButton ariaLabel={t("robot.action_stopping")} title={t("robot.action_stopping")} danger disabled>
                      <Icons.Stop size={13} />
                    </IconButton>
                  )}
                  {r.status === "PAUSED" && (
                    <Button
                      variant="primary"
                      size="md"
                      icon={<Icons.Play size={12} />}
                      onClick={() => startRobot.mutate(r.id, { onSuccess: () => toast.success(t("robot.toast_started")) })}
                    >
                      {t("robot.action_start")}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── 最近归档 ─────────────────────────────────────── */}
      {recentArchived.length > 0 && (
        <div style={{ marginTop: 28 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderTop: "1px dashed var(--border-subtle)", paddingTop: 14, marginBottom: 12 }}>
            <span style={{ fontSize: 10.5, color: "var(--fg-3)", textTransform: "uppercase", letterSpacing: 0.7, fontWeight: 600 }}>{t("robot.recent_archived")}</span>
            <Link href="/robots/archived" style={{ fontSize: 12, color: "var(--accent)" }}>{t("robot.view_all_archived")}</Link>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            {recentArchived.map((r) => (
              <div key={r.id} data-testid="recent-archived-card" style={{ display: "flex", alignItems: "center", gap: 11, padding: "11px 15px", background: "var(--bg-1)", border: "1px solid var(--border-subtle)", borderRadius: 9, opacity: 0.75 }}>
                <ExchangeMark exchange={exchangeKey(r.exchangeId)} size={24} />
                <Link href={`/robots/${r.id}`} style={{ flex: 1, fontSize: 13 }}>
                  {r.symbol}
                  <span style={{ fontSize: 11, color: "var(--fg-3)", fontFamily: "var(--font-mono)", marginLeft: 8 }}>
                    · {fmt.exchangeName(r.exchangeId)} · {r.accountLabel} · {r.status} · {t("robot.preview_realized_boxes", { realized: `${r.realizedPnl >= 0 ? "+" : ""}${r.realizedPnl.toFixed(2)}`, n: r.boxCount })}
                  </span>
                </Link>
                <CopyRobotButton robotId={r.id} />
              </div>
            ))}
          </div>
        </div>
      )}
    </Shell>
  );
}

/** 设计稿里的 32×32 图标方块按钮（暂停=次级底，停止=红 tint）。 */
function IconButton({
  children,
  onClick,
  danger,
  disabled,
  ariaLabel,
  title,
}: {
  children: React.ReactNode;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  danger?: boolean;
  disabled?: boolean;
  ariaLabel: string;
  title: string;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      title={title}
      disabled={disabled}
      onClick={onClick}
      style={{
        width: 32, height: 32, borderRadius: 8,
        background: danger ? "var(--down-tint)" : "var(--bg-2)",
        border: danger ? "none" : "1px solid var(--border-subtle)",
        display: "flex", alignItems: "center", justifyContent: "center",
        color: danger ? "var(--down)" : "var(--fg-1)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.4 : 1,
        flexShrink: 0,
      }}
    >
      {children}
    </button>
  );
}
