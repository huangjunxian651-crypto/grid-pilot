"use client";

import React from "react";
import { type PredictResult, type PredictAction } from "@gridpilot/shared-types";
import { type BoxLayout } from "@/lib/store";
import { type ActiveOrder } from "@/lib/store";
import { useIsMobile } from "@/hooks/useMediaQuery";

interface Props {
  /** 箱体几何（deriveLayout 产出）。两处共用：实时面板传 live.layout，弹窗传 previewLayout。 */
  layout: BoxLayout;
  /** 当前价（实时面板=标记价；弹窗=robot.latestPrice）。 */
  price: number;
  /** 活跃挂单（仅实时面板有；弹窗预览传 undefined）。 */
  activeOrder?: ActiveOrder | null;
  /** 预测的下一步买卖（predictActions 产出）；弹窗以仓位0预览初始买卖档。 */
  prediction?: PredictResult | null;
  t: (k: string, p?: Record<string, string | number>) => string;
  compact?: boolean;
  /** 标题，默认"行动预览"。 */
  title?: string;
}

export function GridLadder({ layout: L, price, activeOrder, prediction, t, compact, title }: Props) {
  const isMobile = useIsMobile();

  // 使用绝对价格边界（对 LONG/SHORT 均正确）
  const boxHighPrice = L.boxHighPrice;   // 箱体上沿（绝对价格）
  const boxLowPrice = L.boxLowPrice;     // 箱体下沿（绝对价格）
  const totalRange = boxHighPrice - boxLowPrice;

  // 辅助函数：将绝对价格转为底部百分比（0 = boxLow，100 = boxHigh）
  const toPct = (p: number) => totalRange > 0 ? ((p - boxLowPrice) / totalRange) * 100 : 0;

  // 四条语义线的绝对价格
  const takeProfitPrice = L.takeProfitPrice;       // 止盈线
  const fullPositionPrice = L.fullPositionPrice;   // 满仓线
  const stopLossStartPrice = L.stopLossStartPrice; // 止损区起点
  const liquidationPrice = L.liquidationPrice;     // 清算线

  // 各区的高度百分比（从 boxLow 往上）
  const takeProfitPct = toPct(takeProfitPrice);
  const fullPositionPct = toPct(fullPositionPrice);
  const stopLossStartPct = toPct(stopLossStartPrice);
  // liquidationPrice 对 LONG = boxLow，对 SHORT = boxHigh

  // 主网格区：止盈线到满仓线之间（对 LONG: top→bottom；对 SHORT: bottom→top，绝对价格自然排布）
  const mainZoneTopPct = Math.max(takeProfitPct, fullPositionPct);
  const mainZoneBottomPct = Math.min(takeProfitPct, fullPositionPct);
  const mainZoneHeight = mainZoneTopPct - mainZoneBottomPct;

  // 隔离带：满仓线到止损区起点
  const isoZoneTopPct = Math.max(fullPositionPct, stopLossStartPct);
  const isoZoneBottomPct = Math.min(fullPositionPct, stopLossStartPct);
  const isoZoneHeight = isoZoneTopPct - isoZoneBottomPct;
  const hasIso = isoZoneHeight > 0.01;

  // 止损区：止损区起点到清算线
  const liqPct = toPct(liquidationPrice);
  const slZoneTopPct = Math.max(stopLossStartPct, liqPct);
  const slZoneBottomPct = Math.min(stopLossStartPct, liqPct);
  const slZoneHeight = slZoneTopPct - slZoneBottomPct;
  const hasSl = slZoneHeight > 0.01;

  const priceRaw = toPct(price);
  const pricePct = Math.max(0, Math.min(100, priceRaw));
  const priceAbove = price > boxHighPrice;
  const priceBelow = price < boxLowPrice;
  const height = compact ? (isMobile ? 220 : 300) : (isMobile ? 280 : 440);

  // 主网格线（等间距分布在主网格区内）
  const gridLineCount = compact ? 8 : 12;
  const mainGridLines = Array.from({ length: gridLineCount }, (_, i) => {
    // 在止盈线到满仓线之间均匀分布
    const p = takeProfitPrice + (fullPositionPrice - takeProfitPrice) * ((i + 1) / (gridLineCount + 1));
    const pct = toPct(p);
    const isActive = activeOrder?.gridPrice != null && Math.abs(activeOrder.gridPrice - p) < L.gridStep * 0.6;
    return { price: p, pct, isActive, zone: "MAIN" as const };
  });

  // 止损网格线（在止损区内均匀分布）
  const slLineCount = compact ? 3 : 5;
  const slGridLines = Array.from({ length: slLineCount }, (_, i) => {
    const p = stopLossStartPrice + (liquidationPrice - stopLossStartPrice) * ((i + 1) / (slLineCount + 1));
    const pct = toPct(p);
    return { price: p, pct, isActive: false, zone: "STOP_LOSS" as const };
  });

  const actionLabel = (a: PredictAction) => {
    if (a.side === "HOLD") return null;
    const prefix = a.side === "SELL" ? "≥" : "≤";
    const verb = a.side === "SELL" ? t("side.SELL") : t("side.BUY");
    return `${prefix} $${a.price.toFixed(0)} ${verb} ${a.qty.toFixed(3)}`;
  };

  const nearestSell = prediction?.nearestSell;
  const nearestBuy = prediction?.nearestBuy;
  const actionLines: Array<{ pct: number; action: PredictAction }> = [];
  if (nearestSell) {
    const pct = toPct(nearestSell.price);
    if (pct >= 0 && pct <= 100) actionLines.push({ pct, action: nearestSell });
  }
  if (nearestBuy) {
    const pct = toPct(nearestBuy.price);
    if (pct >= 0 && pct <= 100) actionLines.push({ pct, action: nearestBuy });
  }

  // 结构边界（四条语义线）
  const rawBounds = [
    { key: "liquidationPrice", label: "清算线", price: liquidationPrice, color: "var(--down)", pct: liqPct },
    ...(hasSl ? [{ key: "stopLossStartPrice", label: "止损区起点", price: stopLossStartPrice, color: "var(--fg-3)", pct: stopLossStartPct }] : []),
    { key: "fullPositionPrice", label: "满仓线", price: fullPositionPrice, color: "var(--accent)", pct: fullPositionPct },
    { key: "takeProfitPrice", label: "止盈线", price: takeProfitPrice, color: "var(--up)", pct: takeProfitPct },
  ];
  // 去掉重合线（pct 差 < 0.1）
  const seenPct = new Set<number>();
  const bounds = rawBounds.filter((b) => { const r = Math.round(b.pct * 10); if (seenPct.has(r)) return false; seenPct.add(r); return true; });
  const LABEL_GAP = 6;
  // 碰撞调整前先按 pct 升序排列，确保 LONG/SHORT 都正确（SHORT 的 rawBounds 是降序排列的）
  const sortedBounds = [...bounds].sort((a, b) => a.pct - b.pct);
  const sortedLabelPct = sortedBounds.map((b) => b.pct);
  for (let i = 1; i < sortedLabelPct.length; i++) if (sortedLabelPct[i] < sortedLabelPct[i - 1] + LABEL_GAP) sortedLabelPct[i] = sortedLabelPct[i - 1] + LABEL_GAP;
  for (let i = sortedLabelPct.length - 2; i >= 0; i--) if (sortedLabelPct[i] > sortedLabelPct[i + 1] - LABEL_GAP) sortedLabelPct[i] = sortedLabelPct[i + 1] - LABEL_GAP;
  // 将调整后的 labelPct 映射回原始 bounds 顺序（横线渲染用原顺序）
  const labelPctByKey = new Map(sortedBounds.map((b, i) => [b.key, sortedLabelPct[i]]));
  const labelPct = bounds.map((b) => labelPctByKey.get(b.key)!);

  const priceLabel = priceAbove
    ? `↑ ${price.toFixed(2)}（越过止盈端）`
    : priceBelow
    ? `↓ ${price.toFixed(2)}（越过清算线）`
    : price.toFixed(2);

  return (
    <div style={{ background: "var(--bg-1)", border: "1px solid var(--border-subtle)", borderRadius: 14, overflow: "hidden" }}>
      <div style={{ padding: "14px 17px", borderBottom: "1px solid var(--border-subtle)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 10.5, color: "var(--fg-2)", textTransform: "uppercase", letterSpacing: 0.9, fontWeight: 600 }}>{title ?? t("bot.action_preview")}</span>
        <span className="num" style={{ fontSize: 10.5, color: "var(--fg-3)", fontFamily: "var(--font-mono)" }}>{t("bot.step")} ${L.gridStep.toFixed(2)}</span>
      </div>

      <div style={{ position: "relative", height, margin: "0 14px 14px", marginTop: 14 }}>
        {/* 主网格区 */}
        <div style={{ position: "absolute", left: 0, right: 0, bottom: `${mainZoneBottomPct}%`, height: `${mainZoneHeight}%`, background: "var(--accent-tint)", borderRadius: 4 }} />

        {/* 隔离带 */}
        {hasIso && <div style={{ position: "absolute", left: 0, right: 0, bottom: `${isoZoneBottomPct}%`, height: `${isoZoneHeight}%`, background: "var(--bg-3)", opacity: 0.6 }} />}

        {/* 止损区 */}
        {hasSl && <div style={{ position: "absolute", left: 0, right: 0, bottom: `${slZoneBottomPct}%`, height: `${slZoneHeight}%`, background: "var(--down-tint)", borderRadius: 4 }} />}

        {/* 区域标签 */}
        <div style={{ position: "absolute", left: 6, bottom: `${mainZoneBottomPct + mainZoneHeight - 4}%`, fontSize: 10, color: "var(--accent)", fontWeight: 500 }}>{t("bot.main_grid_zone")}</div>
        {hasIso && <div style={{ position: "absolute", left: 6, bottom: `${isoZoneBottomPct}%`, fontSize: 10, color: "var(--fg-3)", transform: "translateY(50%)" }}>{t("bot.isolation_zone")}</div>}
        {hasSl && <div style={{ position: "absolute", left: 6, bottom: `${slZoneBottomPct + 2}%`, fontSize: 10, color: "var(--down)" }}>{t("bot.stop_loss_zone")}</div>}

        {/* 结构边界：横线 + 居中价签 */}
        {bounds.map((b, i) => (
          <React.Fragment key={b.key}>
            <div data-testid={`bound-line-${b.key}`} style={{ position: "absolute", left: 0, right: 0, bottom: `${b.pct}%`, borderTop: `1px solid ${b.color}`, opacity: 0.55, zIndex: 3 }} />
            <span data-testid={`bound-label-${b.key}`} className="num" style={{ position: "absolute", left: "50%", bottom: `${labelPct[i]}%`, transform: "translate(-50%, 50%)", fontSize: 9, color: b.color, background: "var(--bg-1)", padding: "0 4px", whiteSpace: "nowrap", zIndex: 4 }}>{b.label} ${b.price.toFixed(0)}</span>
          </React.Fragment>
        ))}

        {/* 主网格线 */}
        {mainGridLines.map((gl, i) => (
          <div key={`mg-${i}`} style={{ position: "absolute", left: 0, right: 0, bottom: `${gl.pct}%`, borderTop: "1px dashed var(--accent)", opacity: gl.isActive ? 0.8 : 0.3 }}>
            {gl.isActive && activeOrder && (
              <div style={{ position: "absolute", right: 0, top: -10, display: "flex", alignItems: "center", gap: 4, padding: "1px 5px", background: "var(--accent)", borderRadius: 3, fontSize: 10, color: "var(--btn-fg)", fontFamily: "var(--font-mono)" }}>
                <span>{activeOrder.side === "buy" ? t("side.BUY") : t("side.SELL")}</span>
                <span>{activeOrder.price.toFixed(2)}</span>
              </div>
            )}
          </div>
        ))}

        {/* 止损网格线 */}
        {hasSl && slGridLines.map((gl, i) => (
          <div key={`sl-${i}`} style={{ position: "absolute", left: 0, right: 0, bottom: `${gl.pct}%`, borderTop: "1px dashed var(--down)", opacity: 0.35 }} />
        ))}

        {/* 预测行动线 */}
        {actionLines.map((al, i) => {
          const isSell = al.action.side === "SELL";
          const color = isSell ? "var(--down)" : "var(--up)";
          const label = actionLabel(al.action);
          if (!label) return null;
          return (
            <div key={`action-${i}`} style={{ position: "absolute", left: 0, right: 0, bottom: `${al.pct}%`, height: 1, borderTop: `1.5px dashed ${color}`, zIndex: 5 }}>
              <div style={{ position: "absolute", right: 0, top: -11, display: "flex", alignItems: "center", gap: 3, padding: "1px 6px", background: color, borderRadius: 4, fontSize: 9.5, color: isSell ? "#fff" : "var(--btn-fg)", fontFamily: "var(--font-mono)", whiteSpace: "nowrap" }}>
                <span>{label}</span>
              </div>
            </div>
          );
        })}

        {/* 当前价格线 */}
        <div style={{ position: "absolute", left: -14, right: -14, bottom: `${pricePct}%`, height: 2, background: "var(--accent)", boxShadow: "0 0 8px var(--accent)", transition: "bottom .3s", zIndex: 10 }}>
          <div style={{ position: "absolute", right: 14, top: -12, padding: "2px 6px", background: "var(--accent)", color: "var(--btn-fg)", fontSize: 11, borderRadius: 3, fontFamily: "var(--font-mono)", fontWeight: 600, whiteSpace: "nowrap" }}>
            {priceLabel}
          </div>
          <div style={{ position: "absolute", left: 0, top: -4, width: 8, height: 8, borderRadius: "50%", background: "var(--accent)", boxShadow: "0 0 8px var(--accent)" }} />
        </div>

        {/* 激活价标记 */}
        {L.activationPrice > 0 && (
          <div style={{ position: "absolute", left: 0, right: 0, bottom: `${toPct(L.activationPrice)}%`, borderTop: "1px dashed var(--fg-3)", opacity: 0.4 }}>
            <span className="num" style={{ position: "absolute", left: 0, top: 2, fontSize: 9, color: "var(--fg-3)" }}>{t("bot.act_price", { price: L.activationPrice.toFixed(0) })}</span>
          </div>
        )}
      </div>
    </div>
  );
}
