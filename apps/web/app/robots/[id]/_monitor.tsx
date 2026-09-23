"use client";

import React, { useMemo, useEffect, useState } from "react";
import { useLang } from "@/lib/i18n-context";
import { type Lang } from "@/lib/i18n";
import { useBotEvents } from "@/lib/hooks/useBotEvents";
import { useRobotFills, useRobotFillsPaged } from "@/lib/hooks/useBots";
import { Modal } from "@/components/ui/modal";
// useQueryClient 已移除：WS 不再触发全量重拉
import { type RangeConfig, type LiveState, type PredictResult, fmt, deriveLayout, predictActions, boxLabel } from "@/lib/store";
import { computeTargetPosition, deriveBoxLines, mainGridCumulativeQuantity } from "@gridpilot/shared-types";
import { type BotStatus, type FillRecord, type RobotDetail, type RobotBox, type BoxGeometry } from "@/lib/api";
import { KPI, PriceTicker, Badge, Card, FsmPill, Pulse } from "@/components/ui/primitives";
import { TermHelp } from "@/components/ui/term-help";
import { Icons } from "@/components/ui/icons";
import { GridLadder } from "@/components/charts/grid-ladder";
import { StopLossPanel } from "@/components/panels/stop-loss-panel";
import { SavingsPanel } from "@/components/panels/savings-panel";
import { RebatePnlHint } from "@/components/referral/rebate-pnl-hint";

export function boxToRangeConfig(box: RobotBox, robot: { symbol: string; direction: string; exchangeId: string }): RangeConfig {
  const exchange = (robot.exchangeId === "binance" || robot.exchangeId === "gateio" || robot.exchangeId === "okx")
    ? (robot.exchangeId as "binance" | "gateio" | "okx") : "binance";
  return {
    id: box.id,
    symbol: robot.symbol,
    exchange,
    direction: robot.direction as "LONG" | "SHORT",
    takeProfitPrice: box.takeProfitPrice,
    mainGridCount: box.mainGridCount,
    mainGridStep: box.mainGridStep,
    mainGridPortionSize: box.mainGridPortionSize,
    mainGridPortionValue: box.mainGridPortionSize,
    stopLossGridCount: box.stopLossGridCount ?? 4,
    stopLossGridStep: box.stopLossGridStep ?? 2.5,
    isolationStep: box.isolationStep ?? box.stopLossGridStep ?? 2.5,
    leverage: box.leverage,
    trailingCallbackRate: box.trailingCallbackRate ?? 0.0002,
    excessProfitMultiplier: box.excessProfitMultiplier ?? 2.0,
    reorderThreshold: box.reorderThreshold ?? 0.02,
    activationPrice: box.activationPrice,
  };
}

function buildLiveState(
  range: RangeConfig,
  state: string,
  events: ReturnType<typeof useBotEvents>,
  historicalFills?: FillRecord[],
  status?: BotStatus | null,
  restLatestPrice?: number | null,
  boxes?: Record<string, BoxGeometry>,
): LiveState {
  const layout = deriveLayout(range);
  // 行情优先级：WS 实时价 → REST latestPrice。两者皆无时几何中点仅供布局，
  // 绝不能当标记价展示（曾把 (1300+1800)/2=1550 渲染成"标记价"误导用户）。
  const knownPrice = events.price > 0 ? events.price : (restLatestPrice != null && restLatestPrice > 0 ? restLatestPrice : null);
  const price = knownPrice ?? (layout.boxLowPrice + layout.boxHighPrice) / 2;
  const bestBid = price - layout.gridStep * 0.02;
  const bestAsk = price + layout.gridStep * 0.02;

  const apiFills: LiveState["fills"] = (historicalFills ?? []).map((f, i) => ({
    id: f.id ?? `HF${i}`,
    ts: new Date(f.createdAt).getTime(),
    side: (f.eventData.side ?? "BUY").toLowerCase() as "buy" | "sell",
    gridIndex: f.eventData.gridIndex ?? -1,
    price: f.eventData.fillPrice ?? price,
    qty: f.eventData.fillQty ?? (range.mainGridPortionValue != null ? range.mainGridPortionValue / Math.max(f.eventData.fillPrice ?? price, 1) : range.mainGridPortionSize),
    route: "POC" as const,
    fee: f.eventData.fee ?? 0,
    feeAsset: f.eventData.feeAsset,
    savings: f.eventData.savings,
    savingsRate: f.eventData.savingsRate,
    boxId: f.boxId,
    orderPrice: f.eventData.orderPrice,
    avgGridPrice: f.eventData.avgGridPrice,
  }));
  const allFills = apiFills; // WS 仅作刷新信号，不并入展示

  // 计算目标仓位信息（使用 shared-types computeTargetPosition，positionQty 有符号）
  const targetPosition = computeTargetPosition(price, {
    takeProfitPrice: range.takeProfitPrice,
    direction: range.direction,
    mainGridCount: range.mainGridCount,
    mainGridStep: range.mainGridStep,
    mainGridPortionSize: range.mainGridPortionSize,
    mainGridPortionValue: range.mainGridPortionSize,
    stopLossGridCount: range.stopLossGridCount ?? 0,
    stopLossGridStep: range.stopLossGridStep ?? 0,
    isolationStep: range.isolationStep ?? 0,
  });

  const effectiveStatus = events.liveStatus ?? status;

  return {
    layout,
    price,
    priceKnown: knownPrice != null,
    bestBid,
    bestAsk,
    lastPrice: price,
    priceTrend: 0,
    fsm: (events.fsm || state) as LiveState["fsm"],
    positionQty: effectiveStatus?.positionQty ?? 0,
    positionAvgCost: effectiveStatus?.entryPrice ?? 0,
    unrealizedPnl: effectiveStatus?.unrealizedPnl ?? 0,
    actualLeverage: effectiveStatus?.leverage ?? range.leverage,
    marginType: effectiveStatus?.marginType ?? "CROSS",
    realizedPnl: effectiveStatus?.realizedPnl ?? 0,
    totalWalletBalance: effectiveStatus?.totalWalletBalance,
    makerSavings: 0,
    gtcExcess: 0,
    gridCycles: 0,
    gtcHits: 0,
    reorders: 0,
    activeOrder: effectiveStatus?.activeOrderDetail ?? null,
    fills: allFills,
    algoOrders: effectiveStatus?.algoOrders ?? [],
    trailingExtreme: null,
    sessionStartedAt: Date.now() - 86400000,
    // 新增止损相关字段
    targetBoughtSize: targetPosition.targetBoughtSize,
    targetHoldSize: targetPosition.targetHoldSize,
    currentZone: targetPosition.zone,
    currentGridIndex: targetPosition.gridIndex,
    boxes,
  };
}

function PositionPanel({ range, live, realizedPnl, t, compact }: { range: RangeConfig; live: LiveState; realizedPnl: number; t: (k: string, p?: Record<string, string | number>) => string; compact?: boolean }) {
  const absQty = Math.abs(live.positionQty);
  const positionValue = absQty * live.price;
  const unrealizedPnl = live.unrealizedPnl;
  let filledGrids = 0;
  for (let i = 1; i <= range.mainGridCount; i++) {
    const targetQty = mainGridCumulativeQuantity(range, i);
    if (absQty + 1e-9 >= targetQty) filledGrids = i;
    else break;
  }
  const fillPct = filledGrids / range.mainGridCount;
  const lev = live.actualLeverage || range.leverage;

  const MMR = 0.004;
  let liqPrice: number | null = null;
  if (live.positionAvgCost && absQty > 0) {
    if (live.marginType === "CROSS") {
      const wb = live.totalWalletBalance;
      if (wb != null && wb > 0) {
        const upnl = unrealizedPnl;
        if (range.direction === "SHORT") {
          liqPrice = live.positionAvgCost + (wb + upnl) / (absQty * (1 + MMR));
        } else {
          liqPrice = live.positionAvgCost - (wb + upnl) / (absQty * (1 - MMR));
        }
      } else {
        const estBalance = positionValue / lev + unrealizedPnl;
        liqPrice = range.direction === "SHORT"
          ? live.positionAvgCost + (estBalance - absQty * live.positionAvgCost * MMR) / (absQty * (1 - MMR))
          : (absQty * live.positionAvgCost - estBalance) / (absQty * (1 - MMR));
      }
      liqPrice = liqPrice > 0 ? liqPrice : null;
    } else {
      liqPrice = range.direction === "SHORT"
        ? live.positionAvgCost * (1 + 1 / lev - MMR)
        : live.positionAvgCost * (1 - 1 / lev + MMR);
    }
  }

  return (
    <Card pad={compact ? 14 : 16}>
      <div style={{ fontSize: 10.5, color: "var(--fg-2)", textTransform: "uppercase", letterSpacing: 0.9, fontWeight: 600, marginBottom: 11 }}>{t("bot.position_panel")}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4 }}>
        <span className="num" style={{ fontSize: 24, fontWeight: 500, letterSpacing: -0.5 }}>{absQty.toFixed(3)}</span>
        <span style={{ fontSize: 13, color: "var(--fg-2)" }}>{range.symbol.split("/")[0]} {t(`dir.${range.direction}`)}</span>
      </div>
      <div style={{ fontSize: 12, color: "var(--fg-2)" }}>
        {t("bot.avg_cost")} <span className="num" style={{ color: "var(--accent)", fontWeight: 600 }}>${(live.positionAvgCost || 0).toFixed(2)}</span> · {t("bot.value")} <span className="num" style={{ color: "var(--fg-1)" }}>${positionValue.toFixed(2)}</span>
      </div>
      <div style={{ marginTop: 12, marginBottom: 12, height: 6, background: "var(--bg-3)", borderRadius: 3, overflow: "hidden" }}>
        <div style={{ width: `${Math.min(fillPct * 100, 100)}%`, height: "100%", background: "linear-gradient(90deg, var(--accent), var(--accent-hi))" }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--fg-2)" }}>
        <span>{t("bot.grids_filled", { n: filledGrids, total: range.mainGridCount })}</span>
        <span className="num">{(fillPct * 100).toFixed(1)}%</span>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5" style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border-subtle)" }}>
        <SmallMetric label={t("kpi.unrealized")} value={`${unrealizedPnl >= 0 ? "+" : ""}$${unrealizedPnl.toFixed(2)}`} tone={unrealizedPnl >= 0 ? "up" : "down"} />
        <SmallMetric label={t("kpi.realized")} value={`${realizedPnl >= 0 ? "+" : ""}$${realizedPnl.toFixed(2)}`} tone={realizedPnl >= 0 ? "up" : "down"} />
        <SmallMetric label={t("kpi.margin_used")} value={`$${(positionValue / lev).toFixed(2)}`} />
        <SmallMetric label={t("kpi.liq_price")} value={liqPrice ? `$${liqPrice.toFixed(2)}` : "—"} tone="down" />
        {live.totalWalletBalance != null && <SmallMetric label={t("bot.wallet_balance")} value={`$${live.totalWalletBalance.toFixed(2)}`} />}
        <SmallMetric label={t("bot.margin_mode")} value={live.marginType === "ISOLATED" ? t("bot.isolated_mode") : t("bot.cross_mode")} />
      </div>
    </Card>
  );
}

function SmallMetric({ label, value, tone }: { label: string; value: string; tone?: string }) {
  const fg = tone === "up" ? "var(--up)" : tone === "down" ? "var(--down)" : tone === "alpha" ? "var(--alpha)" : "var(--fg-0)";
  return (
    <div>
      <div style={{ fontSize: 10.5, color: "var(--fg-3)", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 3 }}>{label}</div>
      <div className="num" style={{ fontSize: 15, fontWeight: 500, color: fg }}>{value}</div>
    </div>
  );
}

function ActiveOrderPanel({ range, live, t, prediction }: { range: RangeConfig; live: LiveState; t: (k: string, p?: Record<string, string | number>) => string; prediction: PredictResult | null }) {
  const o = live.activeOrder;
  if (!o) {
    const nb = prediction?.nearestBuy;
    const ns = prediction?.nearestSell;
    return (
      <Card pad={14}>
        <div style={{ fontSize: 10.5, color: "var(--fg-2)", textTransform: "uppercase", letterSpacing: 0.9, fontWeight: 600, marginBottom: 11 }}>{t("bot.next_action")}</div>
        <div style={{ display: "flex", gap: 9 }}>
          {ns ? (
            <div style={{ flex: 1, padding: "10px 12px", background: "var(--down-tint)", border: "1px solid var(--down-tint)", borderRadius: 9 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10, color: "var(--down)", marginBottom: 5, fontWeight: 600 }}>
                <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M8 12V4M4 8l4-4 4 4" /></svg>
                {t("bot.sell_up")}
              </div>
              <div className="num" style={{ fontSize: 15, fontWeight: 600, color: "var(--fg-0)" }}>≥ {ns.price.toFixed(2)}</div>
              <div className="num" style={{ fontSize: 10, color: "var(--fg-3)", marginTop: 2 }}>{t("side.SELL")} {ns.qty.toFixed(3)} {range.symbol.split("/")[0]}</div>
            </div>
          ) : (
            <div style={{ flex: 1, padding: 10, background: "var(--bg-2)", borderRadius: 9, textAlign: "center", color: "var(--fg-3)", fontSize: 11 }}>—</div>
          )}
          {nb ? (
            <div style={{ flex: 1, padding: "10px 12px", background: "var(--up-tint)", border: "1px solid var(--up-tint)", borderRadius: 9 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10, color: "var(--up)", marginBottom: 5, fontWeight: 600 }}>
                <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M8 4v8M4 8l4 4 4-4" /></svg>
                {t("bot.buy_down")}
              </div>
              <div className="num" style={{ fontSize: 15, fontWeight: 600, color: "var(--fg-0)" }}>≤ {nb.price.toFixed(2)}</div>
              <div className="num" style={{ fontSize: 10, color: "var(--fg-3)", marginTop: 2 }}>{t("side.BUY")} {nb.qty.toFixed(3)} {range.symbol.split("/")[0]}</div>
            </div>
          ) : (
            <div style={{ flex: 1, padding: 10, background: "var(--bg-2)", borderRadius: 9, textAlign: "center", color: "var(--fg-3)", fontSize: 11 }}>—</div>
          )}
        </div>
      </Card>
    );
  }
  const isBuy = o.side === "buy";
  const c = isBuy ? "var(--up)" : "var(--down)";
  const deviation = isBuy ? (o.gridPrice - o.price) / o.gridPrice : (o.price - o.gridPrice) / o.gridPrice;
  return (
    <Card pad={14}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div style={{ fontSize: 10.5, color: "var(--fg-2)", textTransform: "uppercase", letterSpacing: 0.9, fontWeight: 600 }}>{t("bot.active_order")}</div>
        <Pulse size={6} color={c} />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <Badge tone={o.route === "POC" ? "maker" : "taker"}>{o.route}</Badge>
        <span style={{ color: c, fontSize: 13, fontWeight: 500 }}>{isBuy ? t("side.BUY") : t("side.SELL")}</span>
        <span className="num" style={{ fontSize: 13 }}>{o.qty.toFixed(3)} {range.symbol.split("/")[0]}</span>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-2" style={{ fontSize: 11 }}>
        <div><div style={{ color: "var(--fg-3)" }}>{t("bot.order_price")}</div><div className="num" style={{ color: c, fontWeight: 500 }}>{o.price.toFixed(2)}</div></div>
        <div><div style={{ color: "var(--fg-3)" }}>{t("bot.grid_target")}</div><div className="num">{o.gridPrice.toFixed(2)}</div></div>
        <div><div style={{ color: "var(--fg-3)" }}>{t("bot.deviation")}</div><div className="num" style={{ color: deviation > 0 ? "var(--alpha)" : "var(--fg-1)" }}>{(deviation * 100).toFixed(3)}%</div></div>
      </div>
    </Card>
  );
}

/** 成交流单行展示模型（含 orderId/clientOrderId，供详情与搜索）。 */
type FillRow = {
  id: string; ts: number; side: "buy" | "sell"; gridIndex: number; price: number; qty: number;
  route: "POC" | "GTC"; fee: number; feeAsset?: string; savings?: number; savingsRate?: number;
  boxId?: string; orderPrice?: number; avgGridPrice?: number; orderId?: string; clientOrderId?: string; live?: boolean;
};

function fillRecordToRow(f: FillRecord): FillRow {
  return {
    id: f.id,
    ts: new Date(f.createdAt).getTime(),
    side: (f.eventData.side ?? "BUY").toLowerCase() as "buy" | "sell",
    gridIndex: f.eventData.gridIndex ?? -1,
    price: f.eventData.fillPrice ?? 0,
    qty: f.eventData.fillQty ?? 0,
    route: "POC",
    fee: f.eventData.fee ?? 0,
    feeAsset: f.eventData.feeAsset,
    savings: f.eventData.savings,
    savingsRate: f.eventData.savingsRate,
    boxId: f.boxId,
    orderPrice: f.eventData.orderPrice,
    avgGridPrice: f.eventData.avgGridPrice,
    orderId: f.eventData.orderId,
    clientOrderId: f.eventData.clientOrderId,
  };
}

interface WsFill { id?: string; side?: "buy" | "sell"; price?: number; qty?: number; gridIndex?: number; route?: "POC" | "GTC"; fee?: number; ts?: number; orderId?: string; avgGridPrice?: number; savings?: number; savingsRate?: number }
function wsFillToRow(f: WsFill): FillRow {
  return {
    id: f.id ?? `WS${f.ts ?? 0}`,
    ts: f.ts ?? Date.now(),
    side: f.side ?? "buy",
    gridIndex: f.gridIndex ?? -1,
    price: f.price ?? 0,
    qty: f.qty ?? 0,
    route: f.route ?? "POC",
    fee: f.fee ?? 0,
    orderId: f.orderId,
    // runner 广播已带这些字段（grid-bot-runner FillPayload）；接上后实时行直接展示，
    // 不必等 REST 回填，避免顶部新成交短暂显示「—」。
    avgGridPrice: f.avgGridPrice,
    savings: f.savings,
    savingsRate: f.savingsRate,
    live: true,
  };
}

export function FillStream({ robotId, boxes: boxesProp, wsFills, t, lang }: {
  robotId: string;
  boxes?: Record<string, BoxGeometry>;
  wsFills: WsFill[];
  t: (k: string) => string;
  lang: Lang;
}) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<FillRow | null>(null);
  const orderSearch = search.trim() || undefined;
  const searching = !!orderSearch;
  const q = useRobotFillsPaged(robotId, { orderSearch });

  const pages = q.data?.pages ?? [];
  const pageRows = pages.flatMap((p) => p.data).map(fillRecordToRow);
  const boxes = boxesProp ?? (pages[0]?.boxes as Record<string, BoxGeometry> | undefined);
  const pageIds = new Set(pageRows.map((r) => r.id));
  // 搜索态只显示服务端过滤结果；非搜索态把 WS 新成交按 id 去重插顶。
  const liveRows = searching ? [] : wsFills.map(wsFillToRow).filter((r) => !pageIds.has(r.id));
  const rows = [...liveRows, ...pageRows];

  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 80 && q.hasNextPage && !q.isFetchingNextPage) {
      q.fetchNextPage();
    }
  };

  return (
    <Card pad={0} style={{ display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderBottom: "1px solid var(--border-subtle)", flexShrink: 0, gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Pulse size={6} />
          <span style={{ fontSize: 10.5, color: "var(--fg-2)", textTransform: "uppercase", letterSpacing: 0.9, fontWeight: 600 }}>{t("bot.live_fill_stream")}</span>
        </div>
        <input
          data-testid="fill-search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("bot.fill_search_placeholder")}
          style={{ flex: 1, maxWidth: 220, fontSize: 11, padding: "4px 8px", background: "var(--bg-3)", border: "1px solid var(--border-subtle)", borderRadius: 6, color: "var(--fg-1)" }}
        />
      </div>
      <div data-testid="fill-stream-scroll" onScroll={onScroll} style={{ overflow: "auto", maxHeight: 420 }}>
        {rows.length === 0 && (
          <div style={{ padding: "20px 14px", textAlign: "center", fontSize: 11, color: "var(--fg-3)" }}>
            {q.isLoading ? "…" : searching ? t("bot.fill_search_empty") : "—"}
          </div>
        )}
        {rows.map((f, i) => {
          const buy = f.side === "buy";
          const c = buy ? "var(--up)" : "var(--down)";
          const notional = f.price * f.qty;
          return (
            <div
              key={f.id}
              data-testid={`fill-row-${f.id}`}
              onClick={() => setSelected(f)}
              style={{ display: "flex", alignItems: "stretch", borderTop: i > 0 ? "1px solid var(--border-subtle)" : "none", cursor: "pointer" }}
            >
              <div style={{ width: 4, flexShrink: 0, background: c, borderRadius: 0 }} />
              <div style={{ flex: 1, padding: "8px 12px", minWidth: 0 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ color: c, fontWeight: 600, fontSize: 12 }}>{buy ? t("side.BUY") : t("side.SELL")}</span>
                    {f.boxId && boxes?.[f.boxId] && (
                      <span style={{ fontSize: 10, color: "var(--fg-2)" }}>{boxLabel(boxes[f.boxId])}</span>
                    )}
                    <span style={{ fontSize: 10, color: "var(--fg-3)" }}>{f.gridIndex >= 0 ? `G${f.gridIndex}` : "—"}</span>
                  </div>
                  <span className="num" style={{ fontSize: 10.5, color: "var(--fg-3)" }} suppressHydrationWarning>{fmt.ago(f.ts, lang)}</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "2px 12px", fontSize: 11 }}>
                  <div>
                    <div style={{ color: "var(--fg-3)", fontSize: 10 }}>{t("bot.avg_grid_price")}<TermHelp term="avgGridPrice" title={t("bot.avg_grid_price")} /></div>
                    <div className="num" style={{ fontWeight: 500 }}>{f.avgGridPrice != null ? f.avgGridPrice.toFixed(2) : "—"}</div>
                  </div>
                  <div>
                    <div style={{ color: "var(--fg-3)", fontSize: 10 }}>{t("bot.fill_price")}</div>
                    <div className="num" style={{ color: c, fontWeight: 500 }}>{f.price.toFixed(2)}</div>
                  </div>
                  <div>
                    <div style={{ color: "var(--fg-3)", fontSize: 10 }}>Qty</div>
                    <div className="num">{fmt.coin(f.qty)}</div>
                  </div>
                  <div>
                    <div style={{ color: "var(--fg-3)", fontSize: 10 }}>Value</div>
                    <div className="num">${fmt.usd(notional)}</div>
                  </div>
                  <div>
                    <div style={{ color: "var(--fg-3)", fontSize: 10 }}>{t("bot.fill_fee")}<TermHelp term="fee" title={t("bot.fill_fee")} /></div>
                    <div className="num" style={{ color: "var(--fg-3)" }}>{f.fee > 0 ? `$${fmt.usd(f.fee)}${f.feeAsset && f.feeAsset !== "USDT" ? ` ${f.feeAsset}` : ""}` : "—"}</div>
                  </div>
                  <div>
                    <div style={{ color: "var(--fg-3)", fontSize: 10 }}>{t("bot.fill_savings")}<TermHelp term="savings" title={t("bot.fill_savings")} /></div>
                    <div className="num" style={{ color: (f.savings ?? 0) >= 0 ? "var(--up)" : "var(--down)", fontWeight: 500 }}>
                      {f.savings != null ? `${f.savings >= 0 ? "+" : ""}$${fmt.usd(f.savings)}${f.savingsRate != null ? ` (${(f.savingsRate * 100).toFixed(2)}%)` : ""}` : "—"}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
        {q.isFetchingNextPage && (
          <div style={{ padding: "10px 14px", textAlign: "center", fontSize: 11, color: "var(--fg-3)" }}>…</div>
        )}
        {!searching && rows.length > 0 && !q.hasNextPage && (
          <div style={{ padding: "10px 14px", textAlign: "center", fontSize: 10.5, color: "var(--fg-3)" }}>{t("bot.fill_end")}</div>
        )}
      </div>
      <Modal open={!!selected} title={t("bot.fill_detail")} onClose={() => setSelected(null)}>
        {selected && <FillDetail row={selected} boxes={boxes} t={t} lang={lang} />}
      </Modal>
    </Card>
  );
}

function FillDetail({ row, boxes, t, lang }: { row: FillRow; boxes?: Record<string, BoxGeometry>; t: (k: string) => string; lang: Lang }) {
  const buy = row.side === "buy";
  const c = buy ? "var(--up)" : "var(--down)";
  const items: Array<[string, React.ReactNode, string?]> = [
    [t("side.BUY") + "/" + t("side.SELL"), <span key="s" style={{ color: c, fontWeight: 600 }}>{buy ? t("side.BUY") : t("side.SELL")}</span>],
    [t("bot.fill_price"), <span key="p" className="num">{row.price.toFixed(2)}</span>, "fillPrice"],
    ["Qty", <span key="q" className="num">{fmt.coin(row.qty)}</span>],
    [t("bot.avg_grid_price"), <span key="agp" className="num">{row.avgGridPrice != null ? row.avgGridPrice.toFixed(2) : "—"}</span>, "avgGridPrice"],
    [t("bot.order_price"), <span key="op" className="num">{row.orderPrice != null ? row.orderPrice.toFixed(2) : "—"}</span>, "orderPrice"],
    ["Grid", <span key="g" className="num">{row.gridIndex >= 0 ? `G${row.gridIndex}` : "—"}</span>],
    [t("bot.fill_route"), <span key="r" className="num">{row.route}</span>, "makerTaker"],
    [t("bot.fill_fee"), <span key="f" className="num">{row.fee > 0 ? `$${fmt.usd(row.fee)}${row.feeAsset && row.feeAsset !== "USDT" ? ` ${row.feeAsset}` : ""}` : "—"}</span>, "fee"],
    [t("bot.fill_savings"), <span key="sv" className="num">{row.savings != null ? `${row.savings >= 0 ? "+" : ""}$${fmt.usd(row.savings)}` : "—"}</span>, "savings"],
    [t("bot.fill_box"), <span key="b">{row.boxId && boxes?.[row.boxId] ? boxLabel(boxes[row.boxId]) : "—"}</span>],
    [t("bot.fill_order_id"), <span key="oi" className="num" style={{ wordBreak: "break-all" }}>{row.orderId || "—"}</span>],
    [t("bot.fill_client_order_id"), <span key="ci" className="num" style={{ wordBreak: "break-all" }}>{row.clientOrderId || "—"}</span>],
    [t("bot.fill_time"), <span key="t" className="num" suppressHydrationWarning>{fmt.ago(row.ts, lang)}</span>],
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "8px 14px", fontSize: 12, alignItems: "baseline" }}>
      {items.map(([labelText, value, term], i) => (
        <React.Fragment key={i}>
          <div style={{ color: "var(--fg-3)", display: "flex", alignItems: "center", gap: 2 }}>
            {labelText}{term && <TermHelp term={term} title={labelText} />}
          </div>
          <div style={{ textAlign: "right" }}>{value}</div>
        </React.Fragment>
      ))}
    </div>
  );
}

export const __FillDetailForTest = FillDetail;

// ── FSM timeline display model ────────────────────────────────
// 线性主生命线：建仓 → 运行 → 平仓中 → 已平仓。分支/终态(PAUSED/TAKE_PROFIT/
// CANCELLED/HOLD)挂靠在主线对应位置高亮标注；未知/遗留态(SLEEPING)无挂靠点，
// 渲染为显著徽标，避免「全灰无进度」的破损态。
export const LINEAR_FSM_STATES = ["TRAILING_ENTRY", "RUNNING", "LIQUIDATING", "LIQUIDATED"] as const;

// 分支态在主生命线上的挂靠位置（来源：docs/STRATEGY_SPEC.md §9.2 状态转换）
export const BRANCH_FSM_ANCHOR_INDEX: Record<string, number> = {
  HOLD: 0, // 启动检测到继承持仓待激活，处于建仓阶段
  CANCELLED: 0, // TRAILING_ENTRY 追踪窗口关闭，未建仓即退出
  PAUSED: 1, // RUNNING/TRAILING_ENTRY 暂停，挂靠 RUNNING
  TAKE_PROFIT: 1, // RUNNING 止盈退出（终态）
};

export type FsmTimelineModel =
  | { mode: "timeline"; states: readonly string[]; activeIndex: number }
  | { mode: "branch"; kind: string; anchorIndex: number | null };

/**
 * 给定 fsm kind 返回时间线展示模型（纯函数，便于单测）。
 * - 线性主状态 → timeline，activeIndex 为其在主生命线中的位置。
 * - 分支/终态(PAUSED/TAKE_PROFIT/CANCELLED/HOLD) → branch，anchorIndex 为主线挂靠位置。
 * - 未知/遗留态(SLEEPING) → branch 且 anchorIndex=null（脱线徽标兜底）。
 */
export function deriveFsmTimeline(fsm: string): FsmTimelineModel {
  const activeIndex = (LINEAR_FSM_STATES as readonly string[]).indexOf(fsm);
  if (activeIndex >= 0) {
    return { mode: "timeline", states: LINEAR_FSM_STATES, activeIndex };
  }
  return { mode: "branch", kind: fsm, anchorIndex: BRANCH_FSM_ANCHOR_INDEX[fsm] ?? null };
}

function FsmTimeline({ live, t }: { live: LiveState; t: (k: string) => string }) {
  const model = deriveFsmTimeline(live.fsm);
  if (model.mode === "branch" && model.anchorIndex == null) {
    return (
      <Card pad={14}>
        <div style={{ fontSize: 10.5, color: "var(--fg-2)", textTransform: "uppercase", letterSpacing: 0.9, fontWeight: 600, marginBottom: 14 }}>{t("fsm.state")}</div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: "12px 0" }}>
          <FsmPill state={model.kind} t={t} />
          <span style={{ fontSize: 10.5, color: "var(--fg-3)", textAlign: "center", lineHeight: 1.3 }}>{t("fsm.branch_note")}</span>
        </div>
      </Card>
    );
  }
  const activeIndex = model.mode === "timeline" ? model.activeIndex : (model.anchorIndex as number);
  const branchKind = model.mode === "branch" ? model.kind : null;
  return (
    <Card pad={14}>
      <div style={{ fontSize: 11, color: "var(--fg-2)", textTransform: "uppercase", letterSpacing: 0.7, fontWeight: 500, marginBottom: 12 }}>{t("fsm.state")}</div>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        {LINEAR_FSM_STATES.map((s, i) => {
          const done = i < activeIndex, active = i === activeIndex;
          const color = active ? "var(--accent)" : done ? "var(--up)" : "var(--fg-3)";
          return (
            <React.Fragment key={s}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                <div style={{ width: 22, height: 22, borderRadius: "50%", background: active ? "var(--accent-tint)" : "transparent", border: `1.5px solid ${color}`, display: "flex", alignItems: "center", justifyContent: "center", color, boxShadow: active ? `0 0 0 4px var(--accent-tint)` : "none" }}>
                  {done ? <Icons.Check size={11} /> : active && !branchKind ? <Pulse color={color} size={6} /> : <span style={{ width: 6, height: 6, borderRadius: "50%", background: color }} />}
                </div>
                <span style={{ fontSize: 10, color, letterSpacing: 0.3, fontWeight: active ? 600 : 400, textAlign: "center", lineHeight: 1.2 }}>{t(`fsm.${s}`)}</span>
                {active && branchKind && <FsmPill state={branchKind} size="sm" t={t} />}
              </div>
              {i < LINEAR_FSM_STATES.length - 1 && <div style={{ flex: 1, height: 1.5, background: i < activeIndex ? "var(--up)" : "var(--border-default)", margin: "10px 4px 0" }} />}
            </React.Fragment>
          );
        })}
      </div>
    </Card>
  );
}

export function MonitorPanel({ robot, mainSlot }: { robot: RobotDetail; mainSlot?: React.ReactNode }) {
  const { t, lang } = useLang();
  const activeBox = robot.boxes.find((b) => b.id === robot.activeBoxId) ?? null;
  const events = useBotEvents(robot.activeSessionCode);
  const { data: robotFills } = useRobotFills(robot.id);
  // 成交流改为游标分页(useRobotFillsPaged)+ WS 插顶，不再每条 WS 成交都重拉全量。
  // robotFills 仅供 buildLiveState 的 boxes/几何，按其自身节流刷新即可。

  const range = useMemo(() => (activeBox ? boxToRangeConfig(activeBox, robot) : null), [activeBox, robot]);
  const live = useMemo(
    // fsm 取值链：WS 实时转换(events.fsm) 优先；为空时用 REST 播种值 robot.activeFsmState，
    // 解决刷新已运行机器人时收不到转换事件、FSM 显示空 `fsm.` 脱线徽标的 bug。
    () => {
      if (!range) return null;
      // WS 断线/尚未收到 status 时，使用详情 REST 返回的最后可信台账仓位，
      // 避免 `liveStatus ?? 0` 把真实空头仓位渲染成 0.000。
      const restPosition = robot.lastPositionQty != null
        ? ({
            positionQty: robot.lastPositionQty,
            entryPrice: robot.lastEntryPrice ?? undefined,
            unrealizedPnl: robot.lastUnrealizedPnl ?? undefined,
          } as BotStatus)
        : null;
      return buildLiveState(
        range,
        robot.activeFsmState ?? "",
        events,
        (robotFills?.data ?? []) as FillRecord[],
        restPosition,
        robot.latestPrice,
        robotFills?.boxes,
      );
    },
    // 依赖 events 的具体字段而非每渲染都重建的包装对象(useBotEvents 返回 {connected, ...state}),
    // 避免父组件轮询重渲染时无谓重算 buildLiveState。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [range, events.price, events.fsm, events.fills, events.liveStatus, robot.activeFsmState, robot.lastPositionQty, robot.lastEntryPrice, robot.lastUnrealizedPnl, robotFills],
  );
  const prediction = useMemo<PredictResult | null>(() => {
    if (!range || !live) return null;
    return predictActions({
      takeProfitPrice: range.takeProfitPrice,
      mainGridCount: range.mainGridCount,
      mainGridStep: range.mainGridStep,
      mainGridPortionSize: range.mainGridPortionSize,
      mainGridPortionValue: range.mainGridPortionSize,
      stopLossGridCount: range.stopLossGridCount,
      stopLossGridStep: range.stopLossGridStep,
      isolationStep: range.isolationStep,
      direction: range.direction as "LONG" | "SHORT",
      price: live.price,
      positionQty: live.positionQty, // 有符号（LONG ≥ 0，SHORT ≤ 0）
    });
  }, [range, live]);

  // 空态:无活跃箱(监控中 / 暂停 / 停止)
  if (!activeBox || !range || !live || !robot.activeSessionCode) {
    const isStopped = robot.status === "STOPPED";
    const isStopping = robot.status === "STOPPING";
    // 停止那一刻是否确实没抓到持仓快照（持久化后的精确判据，取代旧的时间衰减启发式）
    const snapMissing = robot.lastSnapshotAt == null;
    const stageKey = robot.stopStage ? `bot.stop_stage.${robot.stopStage.toLowerCase()}` : null;
    const warnKey = robot.stopWarning ? `bot.stop_warning.${robot.stopWarning.toLowerCase()}` : null;
    return (
      <div style={{ marginBottom: 16 }}>
        {/* 空态去掉恒为 — 的「改单次数」格（设计 §36），与活跃态同语言只留关键项 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-0" style={{ background: "var(--bg-1)", border: "1px solid var(--border-subtle)", borderRadius: 10 }}>
          <KPI label={t("kpi.mark")} value={robot.latestPrice != null ? robot.latestPrice.toFixed(2) : "—"} icon={<Icons.TrendingUp size={11} />} help="markPrice" />
          <KPI label={t("kpi.position")} value={isStopped && robot.lastPositionQty != null ? robot.lastPositionQty.toFixed(4) : "—"} icon={<Icons.Wallet size={11} />} help="position" />
          <KPI label={t("kpi.unrealized")} value={isStopped && robot.lastUnrealizedPnl != null ? `${robot.lastUnrealizedPnl >= 0 ? "+" : ""}$${robot.lastUnrealizedPnl.toFixed(2)}` : "—"} help="unrealizedPnl" />
          <KPI label={t("kpi.realized")} value={`${robot.realizedPnl >= 0 ? "+" : ""}$${robot.realizedPnl.toFixed(2)}`} tone={robot.realizedPnl >= 0 ? "up" : "down"} help="realizedPnl" />
        </div>
        <div style={{ padding: "28px 18px", textAlign: "center", color: "var(--fg-2)", background: "var(--bg-1)", border: "1px solid var(--border-subtle)", borderRadius: 10, marginTop: 12 }}>
          {isStopping ? (
            <div style={{ fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
              <span style={{ display: "inline-flex", animation: "spin 0.8s linear infinite" }}><Icons.Refresh size={13} /></span>
              {stageKey ? t(stageKey) : t("bot.stopping")}
            </div>
          ) : isStopped ? (
            <>
              <div style={{ fontSize: 13 }}>{t("bot.stopped")}</div>
              {robot.lastPositionQty != null && robot.lastPositionQty !== 0 ? (
                <div style={{ fontSize: 12, color: "var(--fg-3)", marginTop: 8 }}>
                  {t("bot.last_position_before_stop")} <span className="num">{robot.lastPositionQty.toFixed(4)}</span>
                  {robot.lastUnrealizedPnl != null && (
                    <span>
                      {" "}· {t("bot.unrealized_pnl")}{" "}
                      <span className="num" style={{ color: robot.lastUnrealizedPnl >= 0 ? "var(--up)" : "var(--down)" }}>
                        {robot.lastUnrealizedPnl >= 0 ? "+" : ""}${robot.lastUnrealizedPnl.toFixed(2)}
                      </span>
                    </span>
                  )}
                </div>
              ) : null}
              {/* 有具体 stopWarning 码时显示码文案；否则若停止那刻确实没抓到快照，显示通用 snapshot_stale */}
              {warnKey && (
                <div style={{ fontSize: 11, color: "var(--down)", marginTop: 8 }}>{t(warnKey)}</div>
              )}
              {snapMissing && !warnKey && (
                <div style={{ fontSize: 11, color: "var(--down)", marginTop: 8 }}>{t("bot.snapshot_stale")}</div>
              )}
            </>
          ) : (
            <>
              <div style={{ fontSize: 13 }}>{t("robot.monitor_waiting")}</div>
              <div style={{ fontSize: 11, color: "var(--fg-3)", marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
                {robot.boxes.map((b) => {
                  const lines = deriveBoxLines({
                    takeProfitPrice: b.takeProfitPrice,
                    direction: ((b.direction ?? "LONG") as "LONG" | "SHORT"),
                    mainGridCount: b.mainGridCount,
                    mainGridStep: b.mainGridStep,
                    stopLossGridCount: b.stopLossGridCount,
                    stopLossGridStep: b.stopLossGridStep,
                    isolationStep: b.isolationStep ?? b.stopLossGridStep,
                  });
                  return <span key={b.id} className="num">{lines.boxLowPrice.toFixed(2)} — {lines.boxHighPrice.toFixed(2)}{t("robot.activation_window", { price: b.activationPrice || lines.takeProfitPrice })}</span>;
                })}
              </div>
            </>
          )}
        </div>
        {/* 无活跃箱（等待/停止/归档）态也渲染策略箱体区，与活跃态一致 */}
        {mainSlot}
      </div>
    );
  }

  const alpha = robotFills?.summary?.alphaTotal ?? 0;
  // 顶部头部金额串：优先用后端 totalPnl（netPnl + 未实现），不可得时降级用 netPnl。
  // 前端不再自算 realizedPnl + unrealizedPnl。
  const displayTotalPnl = robot.totalPnl ?? robot.netPnl ?? 0;
  const money = (v: number) => `${v >= 0 ? "+" : ""}$${v.toFixed(2)}`;
  const pnlColor = (v: number) => (v >= 0 ? "var(--up)" : "var(--down)");
  const headLabel = { fontSize: 10, color: "var(--fg-3)", textTransform: "uppercase" as const, letterSpacing: 0.6, fontWeight: 600 };
  const sym = robot.symbol.split("/")[0];
  // 改单/循环辅助行仅在 >0 时显示（剔除恒 0 噪音）。注意 buildLiveState 目前把
  // reorders/gridCycles 硬编码为 0（真实值尚未从 WS/status 接线），故该行当前不渲染，
  // 待数据接线后自动激活——这是前瞻分支，不是 bug。
  const showActivity = live.reorders > 0 || live.gridCycles > 0;
  return (
    <div style={{ marginBottom: 16 }}>
      {/* 顶部控制面板：状态+标记价 / 总体盈亏 / 持仓+Alpha 三区，剔除恒 0 的改单/循环噪音 */}
      <div style={{ marginBottom: 16, background: "var(--bg-1)", border: "1px solid var(--border-subtle)", borderRadius: 14, padding: "18px 20px", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 24 }}>
        {/* 左：运行状态 + 标记价 */}
        <div style={{ display: "flex", flexDirection: "column", gap: 9, paddingRight: 24, borderRight: "1px solid var(--border-subtle)" }}>
          {live.fsm ? <div><FsmPill state={live.fsm} t={t} /></div> : null}
          <div>
            <div style={{ ...headLabel, display: "flex", alignItems: "center", gap: 3 }}>{t("kpi.mark")}<TermHelp term="markPrice" title={t("kpi.mark")} /></div>
            <div style={{ marginTop: 2 }}>
              {live.priceKnown
                ? <PriceTicker price={live.price} prev={live.price - live.priceTrend} size={26} />
                : <span className="num" style={{ fontSize: 26, fontWeight: 600 }}>—</span>}
            </div>
            {live.priceKnown && (
              <div className="num" style={{ fontSize: 11, color: "var(--fg-3)", marginTop: 2 }}>{t("bot.v3_bid")} {live.bestBid.toFixed(2)} · {t("bot.v3_ask")} {live.bestAsk.toFixed(2)}</div>
            )}
          </div>
        </div>
        {/* 中：总体盈亏（英雄数字）+ 已实现/未实现分解 */}
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "center" }}>
          <div style={{ ...headLabel, display: "flex", alignItems: "center", gap: 3 }}>{t("kpi.total_pnl")}<TermHelp term="totalPnl" title={t("kpi.total_pnl")} /></div>
          <div className="num" style={{ fontSize: 32, fontWeight: 600, letterSpacing: -1, lineHeight: 1.1, color: pnlColor(displayTotalPnl) }}>{money(displayTotalPnl)}</div>
          <div className="num" style={{ fontSize: 12, marginTop: 3 }}>
            <span style={{ color: "var(--fg-3)" }}>{t("kpi.realized")} </span>
            <span style={{ color: pnlColor(robot.realizedPnl) }}>{money(robot.realizedPnl)}</span>
            <span style={{ color: "var(--fg-3)" }}> · {t("kpi.fees")} </span>
            <span style={{ color: pnlColor(-robot.totalFees) }}>{robot.totalFees > 0 ? "-" : ""}{robot.totalFees.toFixed(2)}</span>
            <TermHelp term="fee" title={t("kpi.fees")} />
            <span style={{ color: "var(--fg-3)" }}> · {t("kpi.unrealized")} </span>
            <span style={{ color: pnlColor(live.unrealizedPnl) }}>{money(live.unrealizedPnl)}</span>
          </div>
        </div>
        {/* 右：持仓 + Alpha 超额（+ 仅在 >0 时的本会话改单/循环辅助行） */}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 28 }}>
          <div>
            <div style={{ ...headLabel, display: "flex", alignItems: "center", gap: 3 }}>{t("kpi.position")}<TermHelp term="position" title={t("kpi.position")} /></div>
            <div className="num" style={{ fontSize: 16, fontWeight: 500, marginTop: 2 }}>{Math.abs(live.positionQty).toFixed(3)} {sym}</div>
            <div className="num" style={{ fontSize: 11, color: "var(--fg-3)" }}>avg ${(live.positionAvgCost || 0).toFixed(2)}</div>
          </div>
          <div>
            <div style={{ ...headLabel, color: "var(--alpha)", display: "flex", alignItems: "center", gap: 3 }}><Icons.Sparkles size={10} />{t("kpi.alpha_short")}<TermHelp term="alpha" title={t("kpi.alpha_short")} /></div>
            <div className="num" style={{ fontSize: 18, fontWeight: 600, marginTop: 2, color: alpha >= 0 ? "var(--alpha)" : "var(--down)" }}>{money(alpha)}</div>
            <div style={{ fontSize: 11, color: "var(--fg-3)" }}>maker+gtc</div>
          </div>
          {showActivity && (
            <div>
              <div style={headLabel}>{t("common.this_session")}</div>
              <div className="num" style={{ fontSize: 12, marginTop: 2, color: "var(--fg-2)" }}>
                {live.reorders > 0 && <span>{t("kpi.reorders")} {live.reorders.toLocaleString()}</span>}
                {live.reorders > 0 && live.gridCycles > 0 && " · "}
                {live.gridCycles > 0 && <span>{t("bot.cycles_short", { n: live.gridCycles })}</span>}
              </div>
            </div>
          )}
        </div>
      </div>
      {/* 监控区：主区(梯图 1fr + 成交流 2fr 嵌套) + 右栏 320（对齐设计稿 pageDetail 2 列嵌套） */}
      <div className="bot-monitor-grid">
        <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
          <div className="bot-monitor-main">
            <div style={{ minWidth: 0 }}>
              <GridLadder layout={live.layout} price={live.price} activeOrder={live.activeOrder} prediction={prediction} t={t} />
            </div>
            <div style={{ minWidth: 0 }}>
              <FillStream robotId={robot.id} boxes={live.boxes ?? robotFills?.boxes} wsFills={events.fills} t={t} lang={lang} />
            </div>
          </div>
          {/* 止损缓冲区·算法哨兵：客户关注的挂单，置于实时成交流下方、箱体之上 */}
          <StopLossPanel live={live} />
          {/* 策略箱体区：随主区宽度（设计稿 pageDetail 主列底部），不横跨整页 */}
          {mainSlot}
        </div>
        {/* 右栏：持仓 → Alpha 归因 → 下一步操作 → 活跃委托 → 生命周期（对齐设计稿 pageDetail 右栏） */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <PositionPanel range={range} live={live} realizedPnl={robot.realizedPnl} t={t} />
          <SavingsPanel summary={robotFills?.summary} />
          <RebatePnlHint exchangeId={robot.exchangeId} feesPaid={robot.totalFees} />
          <ActiveOrderPanel range={range} live={live} t={t} prediction={prediction} />
          <FsmTimeline live={live} t={t} />
        </div>
      </div>
    </div>
  );
}
