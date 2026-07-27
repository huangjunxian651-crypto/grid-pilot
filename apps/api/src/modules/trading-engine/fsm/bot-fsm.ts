import type { BotFsmState, Event } from '../types/bot-state.types';
import { toDistance, toPrice } from '@gridpilot/shared-types';

interface FsmConfig {
  takeProfitPrice: number;
  /** 主网格深度（d 空间，= mainGridCount × mainGridStep）。d > mainGridDepth 即越过满仓线
   * （fullPositionPrice），仅用于 TRAILING_ENTRY 的默认激活深度计算，不是清算阈值。 */
  mainGridDepth: number;
  /** 箱体深度（d 空间，= mainGridDepth + isolationStep + stopLossGridCount × stopLossGridStep）。
   * d > boxDepth 即越过清算线（liquidationPrice），是清算触发阈值——止损区内应由
   * StrategyEngine.computeDesiredOrders 逐格递减仓位（STRATEGY_SPEC §8），这里只是兜底。 */
  boxDepth: number;
  stopLossGridCount: number;
  direction: 'LONG' | 'SHORT';
  activationPrice?: number;
}

interface TransitionResult {
  newState: BotFsmState;
  action?: string;
}

import { Injectable } from '@nestjs/common';

@Injectable()
export class BotFsm {
  transition(
    state: BotFsmState,
    event: Event,
    config: FsmConfig,
    position?: { baseAssetQty: number },
  ): TransitionResult {
    switch (state.kind) {
      case 'TRAILING_ENTRY':
        return this.handleTrailingEntry(state, event, config);
      case 'RUNNING':
        return this.handleRunning(state, event, config, position);
      case 'TAKE_PROFIT':
        return this.handleTakeProfit(state, event, config);
      case 'LIQUIDATING':
        return this.handleLiquidating(state, event, config, position);
      case 'PAUSED':
        return this.handlePaused(state, event, config, position);
      case 'LIQUIDATED':
        return { newState: state };
      case 'CANCELLED':
        return { newState: state };
      default:
        return { newState: state };
    }
  }

  private handleTrailingEntry(state: Extract<BotFsmState, { kind: 'TRAILING_ENTRY' }>, event: Event, config: FsmConfig): TransitionResult {
    if (event.type === 'USER_LIQUIDATE') {
      return { newState: { kind: 'LIQUIDATING', startTime: Date.now(), attemptCount: 0 }, action: 'LIQUIDATE_ALL' };
    }

    if (event.type === 'USER_PAUSE') {
      return { newState: { kind: 'PAUSED', reason: 'user', since: Date.now() } };
    }
    if (event.type === 'ERROR_FATAL') {
      return { newState: { kind: 'PAUSED', reason: event.error.message, since: Date.now() } };
    }

    if (event.type === 'TICK') {
      const price = event.price;

      const d = toDistance(price, config);
      const activationDepth = config.activationPrice != null
        ? toDistance(config.activationPrice, config)
        : config.mainGridDepth / 2;

      // d < 激活深度：价格越过激活价回到止盈侧，追踪窗口关闭
      if (d < activationDepth) {
        return { newState: { kind: 'CANCELLED', reason: 'trailing_window_closed', since: Date.now() } };
      }

      // d > 箱体深度：价格跌穿清算线（亏损方向），触发清算
      if (d > config.boxDepth && config.stopLossGridCount > 0) {
        return { newState: { kind: 'LIQUIDATING', startTime: Date.now(), attemptCount: 0 } };
      }

      const rate = state.trailingCallbackRate > 0 ? state.trailingCallbackRate : 0.002;

      if (config.direction === 'LONG') {
        const extremePrice = Math.min(state.extremePrice, price);
        const triggerPrice = extremePrice * (1 + rate);
        if (price >= triggerPrice) {
          return { newState: { kind: 'RUNNING', since: Date.now() }, action: 'START_MAIN_GRID' };
        }
        return { newState: { ...state, extremePrice } };
      } else {
        const extremePrice = Math.max(state.extremePrice, price);
        const triggerPrice = extremePrice * (1 - rate);
        if (price <= triggerPrice) {
          return { newState: { kind: 'RUNNING', since: Date.now() }, action: 'START_MAIN_GRID' };
        }
        return { newState: { ...state, extremePrice } };
      }
    }

    return { newState: state };
  }

  private handleRunning(
    state: Extract<BotFsmState, { kind: 'RUNNING' }>,
    event: Event,
    config: FsmConfig,
    position?: { baseAssetQty: number },
  ): TransitionResult {
    if (event.type === 'USER_PAUSE') {
      return { newState: { kind: 'PAUSED', reason: 'user', since: Date.now() } };
    }

    if (event.type === 'USER_LIQUIDATE') {
      return { newState: { kind: 'LIQUIDATING', startTime: Date.now(), attemptCount: 0 }, action: 'LIQUIDATE_ALL' };
    }

    if (event.type === 'ERROR_FATAL') {
      return { newState: { kind: 'PAUSED', reason: event.error.message, since: Date.now() } };
    }

    if (event.type === 'TICK') {
      const price = event.price;

      const d = toDistance(price, config);

      // d ≤ 0：价格到达止盈端
      if (d <= 0) {
        if (!position || Math.abs(position.baseAssetQty) <= 1e-12) {
          return { newState: { kind: 'TAKE_PROFIT', startTime: Date.now(), exitPrice: price } };
        }
        return { newState: state };
      }

      // d > 箱体深度：价格跌穿清算线（亏损方向），触发清算
      if (d > config.boxDepth && config.stopLossGridCount > 0) {
        return { newState: { kind: 'LIQUIDATING', startTime: Date.now(), attemptCount: 0 }, action: 'LIQUIDATE_ALL' };
      }
    }

    return { newState: state };
  }

  private handleTakeProfit(state: Extract<BotFsmState, { kind: 'TAKE_PROFIT' }>, _event: Event, _config: FsmConfig): TransitionResult {
    return { newState: state };
  }

  private handleLiquidating(
    state: Extract<BotFsmState, { kind: 'LIQUIDATING' }>,
    event: Event,
    config: FsmConfig,
    position?: { baseAssetQty: number },
  ): TransitionResult {
    if (event.type === 'ORDER_UPDATE' && event.status === 'FILLED') {
      if (position && Math.abs(position.baseAssetQty) > 1e-12) {
        return { newState: state };
      }
      return { newState: { kind: 'LIQUIDATED', finalPnl: 0, closedAt: Date.now() } };
    }

    if ((event.type === 'TICK' || event.type === 'POSITION_UPDATE') && position) {
      if (Math.abs(position.baseAssetQty) <= 1e-12) {
        return { newState: { kind: 'LIQUIDATED', finalPnl: 0, closedAt: Date.now() } };
      }
    }

    return { newState: state };
  }

  private handlePaused(state: Extract<BotFsmState, { kind: 'PAUSED' }>, event: Event, config: FsmConfig, position?: { baseAssetQty: number }): TransitionResult {
    if (event.type === 'USER_RESUME') {
      if (position && Math.abs(position.baseAssetQty) > 1e-12) {
        return { newState: { kind: 'RUNNING', since: Date.now() }, action: 'START_MAIN_GRID' };
      }
      const entryPrice = toPrice(config.mainGridDepth, config);
      return { newState: { kind: 'TRAILING_ENTRY', entryPrice, extremePrice: entryPrice, trailingCallbackRate: 0.002 } };
    }

    return { newState: state };
  }
}
