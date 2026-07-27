import { Injectable } from '@nestjs/common';
import type { Position, OrderResult } from '../types/exchange.types';
import type { SyncResult } from '../exchange-truth-service/exchange-truth.service';
import type { BotFsmState, ActiveOrder } from '../types/bot-state.types';
import { sessionToken, parseClientOrderId } from "../../exchange/adapters/utils";
import { deriveBoxLines, toDistance } from '@gridpilot/shared-types';

export interface RecoveryResult {
  fsmState: BotFsmState;
  position: Position;
  activeOrder: ActiveOrder | null;
  lastPrice: number;
  ordersToCancel: OrderResult[];
  nextSeq: number;
  gridActiveSince: number | undefined;
  stats: {
    totalOrdersPlaced: number;
    totalFills: number;
    totalReorders: number;
    lastPersistTime: number;
    realizedPnl: number;
  };
}

@Injectable()
export class BotStateReconstructor {
  reconstruct(
    syncResult: SyncResult,
    tickerLast: number,
    config: Record<string, unknown>,
    options?: { persistedMaxSeq?: number },
  ): RecoveryResult {
    const runCode = String(config.runCode ?? '');
    const prefix = sessionToken(runCode);

    const myOrders = syncResult.openOrders.filter(
      (o) => o.clientOrderId?.startsWith(prefix),
    );

    // nextSeq 必须越过本 run 历史最大序号（DB 已落库订单 + 交易所在挂订单），
    // 否则重启后复用 clientOrderId：新订单因 (runId, clientOrderId) 唯一约束
    // 落库失败，其成交被错误归属到旧 Order 行（filledQty 超量累加）。
    let maxSeq = options?.persistedMaxSeq ?? 0;
    for (const o of myOrders) {
      const parsed = o.clientOrderId ? parseClientOrderId(o.clientOrderId) : null;
      if (parsed && parsed.seq > maxSeq) maxSeq = parsed.seq;
    }

    let activeOrder: ActiveOrder | null = null;
    const ordersToCancel: OrderResult[] = [];

    if (myOrders.length > 0) {
      const keep = myOrders[myOrders.length - 1];
      for (const o of myOrders) {
        if (o !== keep) {
          ordersToCancel.push(o);
        }
      }

      const parsed = keep.clientOrderId ? parseClientOrderId(keep.clientOrderId) : null;
      const side = parsed?.side === 'SELL' ? 'SELL' as const : 'BUY' as const;
      const remainingQty = keep.qty != null ? Math.max(0, keep.qty - (keep.filledQty ?? 0)) : 0;
      const price = keep.price ?? keep.avgFillPrice ?? 0;

      activeOrder = {
        orderId: keep.orderId,
        clientOrderId: keep.clientOrderId,
        side,
        qty: remainingQty,
        price,
        tif: 'GTC',
        placedAt: Date.now(),
      };
    }

    const fsmState = this.determineFsmState(tickerLast, config, syncResult.position);

    return {
      fsmState,
      position: syncResult.position,
      activeOrder,
      lastPrice: tickerLast,
      ordersToCancel,
      nextSeq: maxSeq + 1,
      gridActiveSince: undefined,
      stats: {
        totalOrdersPlaced: 0,
        totalFills: 0,
        totalReorders: 0,
        lastPersistTime: 0,
        realizedPnl: 0,
      },
    };
  }

  private determineFsmState(
    price: number,
    config: Record<string, unknown>,
    position: Position | null,
  ): BotFsmState {
    const takeProfitPrice = Number(config.takeProfitPrice ?? 0);
    const mainGridStep = Number(config.mainGridStep ?? 0);
    const mainGridCount = Number(config.mainGridCount ?? 0);
    const trailingEntry = Boolean(config.trailingEntry ?? false);
    const entryPrice = Number(config.entryPrice ?? 0);
    const stopLossGridCount = Number(config.stopLossGridCount ?? 0);
    const direction = config.direction as 'LONG' | 'SHORT' | undefined;

    if (position && direction) {
      const positionDirection = position.baseAssetQty > 0 ? 'LONG' : position.baseAssetQty < 0 ? 'SHORT' : undefined;
      if (positionDirection && positionDirection !== direction) {
        return {
          kind: 'PAUSED',
          reason: `Position direction (${positionDirection}) conflicts with config (${direction})`,
          since: Date.now(),
        };
      }
    }

    const hasPosition = !!position && Math.abs(position.baseAssetQty) > 1e-12;
    const isRecovery = Boolean(config.isRecovery ?? false);
    const skipTrailing = hasPosition || isRecovery;

    const anchor = { takeProfitPrice, direction: direction as 'LONG' | 'SHORT' };
    const lines = deriveBoxLines({
      takeProfitPrice,
      mainGridStep,
      mainGridCount,
      stopLossGridCount,
      stopLossGridStep: Number(config.stopLossGridStep ?? 1),
      isolationStep: Number(config.isolationStep ?? 0),
      direction: direction as 'LONG' | 'SHORT',
    });
    const d = toDistance(price, anchor);

    const priceBeyondEntry = direction === 'SHORT' ? price > entryPrice : price < entryPrice;
    const prev = config.previousPrice != null ? Number(config.previousPrice) : undefined;
    const movingInFromUnfavorableSide = prev === undefined
      ? true
      : direction === 'SHORT' ? price > prev : price < prev;
    const shouldTrail = priceBeyondEntry && movingInFromUnfavorableSide;
    if (trailingEntry && shouldTrail && !skipTrailing) {
      const activationDepth = Number(config.activationPrice)
        ? toDistance(Number(config.activationPrice), anchor)
        : lines.mainGridDepth / 2;
      const windowClosed = d < activationDepth;
      if (windowClosed) {
        return { kind: 'CANCELLED', reason: 'trailing_window_closed_on_reconnect', since: Date.now() };
      }
      return {
        kind: 'TRAILING_ENTRY',
        entryPrice,
        extremePrice: price,
        trailingCallbackRate: Number(config.trailingCallbackRate ?? 0.002),
      };
    }

    // d > 箱体深度：价格跌穿清算线（亏损方向），触发清算（与 bot-fsm.ts 的判定口径一致）
    if (d > lines.boxDepth && stopLossGridCount > 0) {
      return {
        kind: 'LIQUIDATING',
        startTime: Date.now(),
        attemptCount: 0,
      };
    }

    // d ≤ 0：价格到达止盈端
    if (d <= 0) {
      if (!position || Math.abs(position.baseAssetQty) <= 1e-12) {
        return {
          kind: 'TAKE_PROFIT',
          startTime: Date.now(),
          exitPrice: price,
        };
      }
    }

    return {
      kind: 'RUNNING',
      since: Date.now(),
    };
  }
}
