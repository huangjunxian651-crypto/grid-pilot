import { describe, it, expect } from 'vitest';
import type {
  BotFsmState,
  Event,
  Decision,
  SideEffect,
  OrderManagerState,
} from './bot-state.types';

describe('bot-state types', () => {
  it('should define all FSM states', () => {
    const states: BotFsmState[] = [
      { kind: 'TRAILING_ENTRY', entryPrice: 2000, extremePrice: 1950, trailingCallbackRate: 0.002 },
      { kind: 'RUNNING', since: Date.now() },
      { kind: 'LIQUIDATING', startTime: Date.now(), attemptCount: 0 },
      { kind: 'LIQUIDATED', finalPnl: 100, closedAt: Date.now() },
      { kind: 'TAKE_PROFIT', startTime: Date.now(), exitPrice: 2500 },
      { kind: 'PAUSED', reason: 'WS disconnect', since: Date.now() },
      { kind: 'HOLD', reason: 'GTC boundary exceeded' },
    ];
    expect(states).toHaveLength(7);
  });

  it('should define TICK event', () => {
    const event: Event = { type: 'TICK', price: 2000, timestamp: Date.now() };
    expect(event.type).toBe('TICK');
  });

  it('should define FILL event', () => {
    const event: Event = {
      type: 'FILL',
      orderId: 'o1',
      fillQty: 0.01,
      fillPrice: 2000,
      side: 'BUY',
    };
    expect(event.type).toBe('FILL');
  });

  it('should define ORDER_UPDATE event', () => {
    const event: Event = {
      type: 'ORDER_UPDATE',
      orderId: 'o1',
      status: 'FILLED',
      filledQty: 0.01,
    };
    expect(event.type).toBe('ORDER_UPDATE');
  });

  it('should define CANCEL event', () => {
    const event: Event = { type: 'CANCEL', orderId: 'o1', reason: 'reorder' };
    expect(event.type).toBe('CANCEL');
  });

  it('should define TIMER_RECONCILE event', () => {
    const event: Event = { type: 'TIMER_RECONCILE', full: true };
    expect(event.type).toBe('TIMER_RECONCILE');
  });

  it('should define TIMER_PERSIST event', () => {
    const event: Event = { type: 'TIMER_PERSIST' };
    expect(event.type).toBe('TIMER_PERSIST');
  });

  it('should define USER_PAUSE event', () => {
    const event: Event = { type: 'USER_PAUSE' };
    expect(event.type).toBe('USER_PAUSE');
  });

  it('should define USER_RESUME event', () => {
    const event: Event = { type: 'USER_RESUME' };
    expect(event.type).toBe('USER_RESUME');
  });

  it('should define USER_LIQUIDATE event', () => {
    const event: Event = { type: 'USER_LIQUIDATE' };
    expect(event.type).toBe('USER_LIQUIDATE');
  });

  it('should define CONFIG_UPDATE event', () => {
    const event: Event = { type: 'CONFIG_UPDATE', config: { reorderThreshold: 0.0005 } };
    expect(event.type).toBe('CONFIG_UPDATE');
  });

  it('should define WS_RECONNECT event', () => {
    const event: Event = {
      type: 'WS_RECONNECT',
      syncResult: {
        position: { symbol: 'ETH/USDT', baseAssetQty: 1, quoteAssetQty: 0, entryPrice: 0, leverage: 1, marginType: 'CROSS' },
        openOrders: [],
        algoOrders: [],
        timestamp: Date.now(),
      },
    };
    expect(event.type).toBe('WS_RECONNECT');
  });

  it('should define ERROR_RECOVERABLE event', () => {
    const event: Event = {
      type: 'ERROR_RECOVERABLE',
      error: { message: 'Rate limited', code: 'RATE_LIMIT' },
    };
    expect(event.type).toBe('ERROR_RECOVERABLE');
  });

  it('should define ERROR_FATAL event', () => {
    const event: Event = {
      type: 'ERROR_FATAL',
      error: { message: 'Exchange down', code: 'EXCHANGE_DOWN' },
    };
    expect(event.type).toBe('ERROR_FATAL');
  });

  it('should define PLACE decision', () => {
    const decision: Decision = {
      action: 'PLACE',
      side: 'BUY',
      qty: 0.01,
      price: 2000,
      tif: 'POC',
      reason: 'increase_position',
    };
    expect(decision.action).toBe('PLACE');
  });

  it('should define CANCEL decision', () => {
    const decision: Decision = { action: 'CANCEL', reason: 'reorder' };
    expect(decision.action).toBe('CANCEL');
  });

  it('should define HOLD decision', () => {
    const decision: Decision = { action: 'HOLD', reason: 'within_buffer' };
    expect(decision.action).toBe('HOLD');
  });

  it('should define LIQUIDATE decision', () => {
    const decision: Decision = { action: 'LIQUIDATE', reason: 'stop_loss' };
    expect(decision.action).toBe('LIQUIDATE');
  });

  it('should define PLACE_ORDER side effect', () => {
    const effect: SideEffect = {
      type: 'PLACE_ORDER',
      request: {
        symbol: 'ETH/USDT',
        side: 'BUY',
        qty: 0.01,
        price: 2000,
        tif: 'POC',
        clientOrderId: 'bot_1_BUY_1',
      },
    };
    expect(effect.type).toBe('PLACE_ORDER');
  });

  it('should define CANCEL_ORDER side effect', () => {
    const effect: SideEffect = { type: 'CANCEL_ORDER', orderId: 'o1' };
    expect(effect.type).toBe('CANCEL_ORDER');
  });

  it('should define OrderManagerState with scalar activeOrder', () => {
    const state: OrderManagerState = {
      activeOrder: {
        orderId: 'o1',
        clientOrderId: 'bot_1_BUY_1',
        side: 'BUY',
        qty: 0.01,
        price: 2000,
        tif: 'POC',
        placedAt: Date.now(),
      },
      recentlyCancelled: new Set(['o0']),
    };
    expect(state.activeOrder).not.toBeNull();
    expect(state.activeOrder!.side).toBe('BUY');
  });

  it('should allow null activeOrder', () => {
    const state: OrderManagerState = {
      activeOrder: null,
      recentlyCancelled: new Set(),
    };
    expect(state.activeOrder).toBeNull();
  });
});
