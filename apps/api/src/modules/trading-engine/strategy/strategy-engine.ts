import type { Position } from '../types/exchange.types';
import type { Decision } from '../types/bot-state.types';
import { calculateOptimalPrice, effectiveGtcThreshold } from '../pricing';
import { isPlaceable } from '../grid-geometry/grid-geometry';
import {
  computeTargetPosition,
  toDistance,
  toPrice,
  type BoxTargetConfig,
} from '@gridpilot/shared-types';

interface StrategyConfig {
  takeProfitPrice: number;
  mainGridCount: number;
  mainGridStep: number;
  mainGridPortionSize: number;
  direction: 'LONG' | 'SHORT';
  reorderThreshold: number;
  stopLossGridCount: number;
  stopLossGridStep: number;
  isolationStep: number;
  gtcThreshold: number;
  minQty?: number;
  stepSize?: number;
  minNotional?: number;
  quantoMultiplier?: number;
  excessProfitMultiplier?: number;
  takerFeeRate?: number;
}

interface MarketInfo {
  tickSize: number;
  bestBid: number;
  bestAsk: number;
}

import { Injectable } from '@nestjs/common';

/**
 * 策略引擎 - 统一下单决策逻辑
 *
 * 设计原则：所有区域（主网格、隔离区、止损区）使用相同的下单决策逻辑
 *
 * 核心流程：
 * 1. computeTargetPosition(price, config) → {targetBoughtSize, targetHoldSize, zone, ...}
 * 2. 比较 actualHeld 与目标范围：
 *    - actualHeld >= targetHoldSize + ε → SELL（减仓）
 *    - actualHeld <= targetBoughtSize - ε → BUY（补仓）
 *    - 否则 → HOLD
 *
 * 关键特性：
 * - 止损区不再是独立的条件单维护逻辑，而是通过统一的仓位计算 + 动态下单实现
 * - 兜底止损单（ensureEmergencyStopLoss）在箱体边缘（liquidationPrice/takeProfitPrice）作为最后防线
 *
 * 参见：docs/superpowers/specs/2026-06-02-stop-loss-unified-design.md
 */
@Injectable()
export class StrategyEngine {
  computeDesiredOrders(
    price: number,
    position: Position,
    config: StrategyConfig,
    marketInfo: MarketInfo,
  ): Decision {
    const { takeProfitPrice, mainGridCount, mainGridStep, mainGridPortionSize, direction, stopLossGridCount, stopLossGridStep, isolationStep } = config;
    const epsilon = config.minQty && config.minQty > 0 ? config.minQty : 1e-8;
    const gtcThreshold = effectiveGtcThreshold({
      gtcThreshold: config.gtcThreshold,
      excessProfitMultiplier: config.excessProfitMultiplier,
      takerFeeRate: config.takerFeeRate,
    });

    const targetConfig: BoxTargetConfig = {
      takeProfitPrice,
      mainGridCount,
      mainGridStep,
      mainGridPortionSize,
      stopLossGridCount,
      stopLossGridStep,
      isolationStep,
      direction,
    };

    const targetPosition = computeTargetPosition(price, targetConfig);
    const { targetBoughtSize, targetHoldSize } = targetPosition;
    const lines = targetPosition.lines;
    const d = toDistance(price, targetConfig);

    // 网格参考价（d 空间单实现）：reduce=向止盈端的刚越过线，add=向亏损端的刚越过线
    let reduceGridPrice: number;
    let addGridPrice: number;

    if (d <= lines.isolationEndDepth) {
      let heldGrids = 0;
      let boughtGrids = 0;
      for (let i = 0; i < mainGridCount; i++) {
        if (d > i * mainGridStep) heldGrids++;
        if (d > (i + 1) * mainGridStep) boughtGrids++;
      }
      reduceGridPrice = toPrice(heldGrids * mainGridStep, targetConfig);
      addGridPrice = toPrice(boughtGrids * mainGridStep, targetConfig);
    } else if (stopLossGridCount > 0 && d < lines.boxDepth) {
      const slGrids = Math.floor((lines.boxDepth - d) / stopLossGridStep + 1e-9);
      reduceGridPrice = toPrice(lines.boxDepth - slGrids * stopLossGridStep, targetConfig);
      addGridPrice = toPrice(lines.boxDepth - (slGrids + 1) * stopLossGridStep, targetConfig);
    } else {
      reduceGridPrice = price;
      addGridPrice = price;
    }

    const sellGridPrice = direction === 'LONG' ? reduceGridPrice : addGridPrice;
    const buyGridPrice = direction === 'LONG' ? addGridPrice : reduceGridPrice;

    const decision = direction === 'LONG'
      ? this.computeLong(targetHoldSize, targetBoughtSize, position.baseAssetQty, epsilon, sellGridPrice, buyGridPrice, gtcThreshold, marketInfo)
      : this.computeShort(targetHoldSize, targetBoughtSize, position.baseAssetQty, epsilon, sellGridPrice, buyGridPrice, gtcThreshold, marketInfo);

    if (decision.action === 'PLACE') {
      const alignedQty = config.stepSize && config.stepSize > 0
        ? Math.floor(decision.qty / config.stepSize + 1e-9) * config.stepSize
        : decision.qty;
      const qty = this.roundQty(alignedQty);
      if (!isPlaceable(qty, decision.price, {
        minQty: config.minQty ?? 0,
        minNotional: config.minNotional ?? 0,
        quantoMultiplier: config.quantoMultiplier ?? 1,
      })) {
        return { action: 'HOLD', reason: 'below_min_order' };
      }
      return { ...decision, qty };
    }
    return decision;
  }

  private computeLong(
    targetHoldSize: number,
    targetBoughtSize: number,
    actualHeld: number,
    epsilon: number,
    sellGridPrice: number,
    buyGridPrice: number,
    gtcThreshold: number,
    marketInfo: MarketInfo,
  ): Decision {
    if (actualHeld >= targetHoldSize + epsilon) {
      const decision = calculateOptimalPrice({
        side: 'SELL',
        gridPrice: sellGridPrice,
        marketPrice: marketInfo.bestBid,
        tickSize: marketInfo.tickSize,
        gtcThreshold,
      });
      if (decision.zone === 'BLOCKED') {
        return { action: 'HOLD', reason: 'melt_zone' };
      }
      return {
        action: 'PLACE',
        side: 'SELL',
        qty: this.roundQty(actualHeld - targetHoldSize),
        price: decision.actualPrice,
        gridPrice: sellGridPrice,
        tif: decision.tif as 'POC' | 'GTC',
        reason: `${decision.zone.toLowerCase()}_zone`,
      };
    }

    if (actualHeld <= targetBoughtSize - epsilon) {
      const decision = calculateOptimalPrice({
        side: 'BUY',
        gridPrice: buyGridPrice,
        marketPrice: marketInfo.bestAsk,
        tickSize: marketInfo.tickSize,
        gtcThreshold,
      });
      if (decision.zone === 'BLOCKED') {
        return { action: 'HOLD', reason: 'melt_zone' };
      }
      return {
        action: 'PLACE',
        side: 'BUY',
        qty: this.roundQty(targetBoughtSize - actualHeld),
        price: decision.actualPrice,
        gridPrice: buyGridPrice,
        tif: decision.tif as 'POC' | 'GTC',
        reason: `${decision.zone.toLowerCase()}_zone`,
      };
    }

    return { action: 'HOLD', reason: 'within_buffer_zone' };
  }

  private computeShort(
    targetHoldSize: number,
    targetBoughtSize: number,
    actualHeld: number,
    epsilon: number,
    sellGridPrice: number,
    buyGridPrice: number,
    gtcThreshold: number,
    marketInfo: MarketInfo,
  ): Decision {
    const shortPosition = -actualHeld;

    if (shortPosition >= targetHoldSize + epsilon) {
      const decision = calculateOptimalPrice({
        side: 'BUY',
        gridPrice: buyGridPrice,
        marketPrice: marketInfo.bestAsk,
        tickSize: marketInfo.tickSize,
        gtcThreshold,
      });
      if (decision.zone === 'BLOCKED') {
        return { action: 'HOLD', reason: 'melt_zone' };
      }
      return {
        action: 'PLACE',
        side: 'BUY',
        qty: this.roundQty(shortPosition - targetHoldSize),
        price: decision.actualPrice,
        gridPrice: buyGridPrice,
        tif: decision.tif as 'POC' | 'GTC',
        reason: `${decision.zone.toLowerCase()}_zone`,
      };
    }

    if (shortPosition <= targetBoughtSize - epsilon) {
      const decision = calculateOptimalPrice({
        side: 'SELL',
        gridPrice: sellGridPrice,
        marketPrice: marketInfo.bestBid,
        tickSize: marketInfo.tickSize,
        gtcThreshold,
      });
      if (decision.zone === 'BLOCKED') {
        return { action: 'HOLD', reason: 'melt_zone' };
      }
      return {
        action: 'PLACE',
        side: 'SELL',
        qty: this.roundQty(targetBoughtSize - shortPosition),
        price: decision.actualPrice,
        gridPrice: sellGridPrice,
        tif: decision.tif as 'POC' | 'GTC',
        reason: `${decision.zone.toLowerCase()}_zone`,
      };
    }

    return { action: 'HOLD', reason: 'within_buffer_zone' };
  }

  shouldReorder(currentPrice: number, newPrice: number, threshold: number): boolean {
    const deviation = Math.abs(currentPrice - newPrice) / currentPrice;
    return deviation > threshold;
  }

  computeReorder(args: {
    side: 'BUY' | 'SELL';
    gridPrice: number;
    placedPrice: number;
    marketPrice: number;
    tickSize: number;
    gtcThreshold: number;
    reorderThreshold: number;
  }): { shouldReorder: boolean; blocked?: boolean; newPrice?: number; tif?: 'POC' | 'GTC' } {
    const decision = calculateOptimalPrice({
      side: args.side,
      gridPrice: args.gridPrice,
      marketPrice: args.marketPrice,
      tickSize: args.tickSize,
      gtcThreshold: args.gtcThreshold,
    });

    if (decision.zone === 'BLOCKED') {
      return { shouldReorder: true, blocked: true };
    }

    if (decision.tif === 'GTC') {
      return { shouldReorder: true, blocked: false, newPrice: decision.actualPrice, tif: 'GTC' };
    }

    if (this.shouldReorder(args.placedPrice, decision.actualPrice, args.reorderThreshold)) {
      return { shouldReorder: true, blocked: false, newPrice: decision.actualPrice, tif: 'POC' };
    }

    return { shouldReorder: false };
  }

  private roundQty(qty: number): number {
    return Math.round(qty * 1e8) / 1e8;
  }
}
