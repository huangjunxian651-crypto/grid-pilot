import { describe, it, expect } from 'vitest';
import { BotFsm } from './bot-fsm';
import type { BotFsmState } from '../types/bot-state.types';

describe('BotFsm', () => {
  const fsm = new BotFsm();

  describe('TRAILING_ENTRY transitions', () => {
    it('should transition to RUNNING when Long price rebounds by callback rate', () => {
      const state: BotFsmState = {
        kind: 'TRAILING_ENTRY',
        entryPrice: 2000,
        extremePrice: 1950,
        trailingCallbackRate: 0.002,
      };
      // trigger = 1950 * 1.002 = 1953.9
      const result = fsm.transition(state, { type: 'TICK', price: 1955, timestamp: Date.now() }, {
        takeProfitPrice: 2200,
        mainGridDepth: 360,
        boxDepth: 400,
        stopLossGridCount: 4,
        direction: 'LONG',
      });
      expect(result.newState.kind).toBe('RUNNING');
      expect(result.action).toBe('START_MAIN_GRID');
    });

    it('should stay in TRAILING_ENTRY when Long rebound is below callback rate', () => {
      const state: BotFsmState = {
        kind: 'TRAILING_ENTRY',
        entryPrice: 2000,
        extremePrice: 1950,
        trailingCallbackRate: 0.002,
      };
      // trigger = 1953.9; price=1952 < trigger
      const result = fsm.transition(state, { type: 'TICK', price: 1952, timestamp: Date.now() }, {
        takeProfitPrice: 2200,
        mainGridDepth: 360,
        boxDepth: 400,
        stopLossGridCount: 4,
        direction: 'LONG',
      });
      expect(result.newState.kind).toBe('TRAILING_ENTRY');
    });

    it('should update extremePrice (lower low) in TRAILING_ENTRY for Long', () => {
      const state: BotFsmState = {
        kind: 'TRAILING_ENTRY',
        entryPrice: 2000,
        extremePrice: 1950,
        trailingCallbackRate: 0.002,
      };
      const result = fsm.transition(state, { type: 'TICK', price: 1940, timestamp: Date.now() }, {
        takeProfitPrice: 2200,
        mainGridDepth: 360,
        boxDepth: 400,
        stopLossGridCount: 4,
        direction: 'LONG',
      });
      expect(result.newState.kind).toBe('TRAILING_ENTRY');
      expect((result.newState as any).extremePrice).toBe(1940);
    });

    it('should transition to RUNNING when Short price falls by callback rate', () => {
      const state: BotFsmState = {
        kind: 'TRAILING_ENTRY',
        entryPrice: 2000,
        extremePrice: 2050,
        trailingCallbackRate: 0.002,
      };
      // trigger = 2050 * (1 - 0.002) = 2045.9
      const result = fsm.transition(state, { type: 'TICK', price: 2045, timestamp: Date.now() }, {
        takeProfitPrice: 1840,
        mainGridDepth: 360,
        boxDepth: 400,
        stopLossGridCount: 4,
        direction: 'SHORT',
      });
      expect(result.newState.kind).toBe('RUNNING');
      expect(result.action).toBe('START_MAIN_GRID');
    });

    it('should stay in TRAILING_ENTRY when Short callback is below rate', () => {
      const state: BotFsmState = {
        kind: 'TRAILING_ENTRY',
        entryPrice: 2000,
        extremePrice: 2050,
        trailingCallbackRate: 0.002,
      };
      // trigger = 2045.9; price=2048 > trigger
      const result = fsm.transition(state, { type: 'TICK', price: 2048, timestamp: Date.now() }, {
        takeProfitPrice: 1840,
        mainGridDepth: 360,
        boxDepth: 400,
        stopLossGridCount: 4,
        direction: 'SHORT',
      });
      expect(result.newState.kind).toBe('TRAILING_ENTRY');
    });

    it('should update extremePrice (higher high) in TRAILING_ENTRY for Short', () => {
      const state: BotFsmState = {
        kind: 'TRAILING_ENTRY',
        entryPrice: 2000,
        extremePrice: 2050,
        trailingCallbackRate: 0.002,
      };
      const result = fsm.transition(state, { type: 'TICK', price: 2060, timestamp: Date.now() }, {
        takeProfitPrice: 1840,
        mainGridDepth: 360,
        boxDepth: 400,
        stopLossGridCount: 4,
        direction: 'SHORT',
      });
      expect(result.newState.kind).toBe('TRAILING_ENTRY');
      expect((result.newState as any).extremePrice).toBe(2060);
    });

    it('should transition to CANCELLED when price rises above activationPrice (LONG, STRATEGY_SPEC §5.1)', () => {
      const state: BotFsmState = {
        kind: 'TRAILING_ENTRY',
        entryPrice: 2000,
        extremePrice: 1950,
        trailingCallbackRate: 0.002,
      };
      // activationPrice defaults to (fullPositionPrice + takeProfitPrice) / 2 = 2020
      const result = fsm.transition(state, { type: 'TICK', price: 2021, timestamp: Date.now() }, {
        takeProfitPrice: 2200,
        mainGridDepth: 360,
        boxDepth: 400,
        stopLossGridCount: 4,
        direction: 'LONG',
      });
      expect(result.newState.kind).toBe('CANCELLED');
      expect((result.newState as any).reason).toBe('trailing_window_closed');
    });

    it('should transition to CANCELLED when price falls below activationPrice (SHORT, STRATEGY_SPEC §5.1)', () => {
      const state: BotFsmState = {
        kind: 'TRAILING_ENTRY',
        entryPrice: 2000,
        extremePrice: 2050,
        trailingCallbackRate: 0.002,
      };
      const result = fsm.transition(state, { type: 'TICK', price: 1999, timestamp: Date.now() }, {
        takeProfitPrice: 1840,
        mainGridDepth: 360,
        boxDepth: 400,
        stopLossGridCount: 4,
        direction: 'SHORT',
      });
      expect(result.newState.kind).toBe('CANCELLED');
    });

    it('should respect explicit activationPrice over default', () => {
      const state: BotFsmState = {
        kind: 'TRAILING_ENTRY',
        entryPrice: 2000,
        extremePrice: 1950,
        trailingCallbackRate: 0.002,
      };
      // activationPrice = 2500, so price 1900 should NOT cancel (below rebound trigger 1953.9)
      const result = fsm.transition(state, { type: 'TICK', price: 1900, timestamp: Date.now() }, {
        takeProfitPrice: 2200,
        mainGridDepth: 360,
        boxDepth: 400,
        stopLossGridCount: 4,
        direction: 'LONG',
        activationPrice: 2500,
      });
      expect(result.newState.kind).toBe('TRAILING_ENTRY');
      expect((result.newState as any).extremePrice).toBe(1900);
    });

    it('should transition to LIQUIDATING on USER_LIQUIDATE', () => {
      const state: BotFsmState = {
        kind: 'TRAILING_ENTRY',
        entryPrice: 2000,
        extremePrice: 1950,
        trailingCallbackRate: 0.002,
      };
      const result = fsm.transition(state, { type: 'USER_LIQUIDATE' }, {
        takeProfitPrice: 2200,
        mainGridDepth: 360,
        boxDepth: 400,
        stopLossGridCount: 4,
        direction: 'LONG',
      });
      expect(result.newState.kind).toBe('LIQUIDATING');
    });

    // TODO-4.1: TRAILING_ENTRY + USER_PAUSE → PAUSED
    it('should transition to PAUSED on USER_PAUSE (TODO-4.1)', () => {
      const state: BotFsmState = {
        kind: 'TRAILING_ENTRY',
        entryPrice: 2000,
        extremePrice: 1950,
        trailingCallbackRate: 0.002,
      };
      const result = fsm.transition(state, { type: 'USER_PAUSE' }, {
        takeProfitPrice: 2200,
        mainGridDepth: 360,
        boxDepth: 400,
        stopLossGridCount: 4,
        direction: 'LONG',
      });
      expect(result.newState.kind).toBe('PAUSED');
    });

    // TODO-4.1: TRAILING_ENTRY + ERROR_FATAL → PAUSED
    it('should transition to PAUSED on ERROR_FATAL (TODO-4.1)', () => {
      const state: BotFsmState = {
        kind: 'TRAILING_ENTRY',
        entryPrice: 2000,
        extremePrice: 1950,
        trailingCallbackRate: 0.002,
      };
      const result = fsm.transition(state, { type: 'ERROR_FATAL', error: { message: 'crash', code: 'FATAL' } }, {
        takeProfitPrice: 2200,
        mainGridDepth: 360,
        boxDepth: 400,
        stopLossGridCount: 4,
        direction: 'LONG',
      });
      expect(result.newState.kind).toBe('PAUSED');
    });

    it('should stay in TRAILING_ENTRY when price is beyond fullPositionPrice but still within the stop-loss zone (regression guard, was: incorrectly liquidated at fullPositionPrice)', () => {
      const state: BotFsmState = {
        kind: 'TRAILING_ENTRY',
        entryPrice: 2000,
        extremePrice: 1900,
        trailingCallbackRate: 0.002,
      };
      // fullPositionPrice = 1840 (d=360); price=1839 → d=361, just past mainGridDepth but well
      // short of boxDepth=400 (liquidationPrice=1800). Must stay in TRAILING_ENTRY, not liquidate.
      const result = fsm.transition(state, { type: 'TICK', price: 1839, timestamp: Date.now() }, {
        takeProfitPrice: 2200,
        mainGridDepth: 360,
        boxDepth: 400,
        stopLossGridCount: 4,
        direction: 'LONG',
      });
      expect(result.newState.kind).toBe('TRAILING_ENTRY');
    });

    it('should transition to LIQUIDATING when price crosses boxDepth (liquidationPrice) before entry', () => {
      const state: BotFsmState = {
        kind: 'TRAILING_ENTRY',
        entryPrice: 2000,
        extremePrice: 1900,
        trailingCallbackRate: 0.002,
      };
      // boxDepth=400 → liquidationPrice=1800; price=1799 → d=401 > boxDepth
      const result = fsm.transition(state, { type: 'TICK', price: 1799, timestamp: Date.now() }, {
        takeProfitPrice: 2200,
        mainGridDepth: 360,
        boxDepth: 400,
        stopLossGridCount: 4,
        direction: 'LONG',
      });
      expect(result.newState.kind).toBe('LIQUIDATING');
    });
  });

  describe('RUNNING transitions', () => {
    it('should stay in RUNNING when price is within range', () => {
      const state: BotFsmState = { kind: 'RUNNING', since: Date.now() };
      const result = fsm.transition(state, { type: 'TICK', price: 2000, timestamp: Date.now() }, {
        takeProfitPrice: 2200,
        mainGridDepth: 360,
        boxDepth: 400,
        stopLossGridCount: 4,
        direction: 'LONG',
      });
      expect(result.newState.kind).toBe('RUNNING');
    });

    it('should transition to TAKE_PROFIT when price >= takeProfitPrice', () => {
      const state: BotFsmState = { kind: 'RUNNING', since: Date.now() };
      const result = fsm.transition(state, { type: 'TICK', price: 2200, timestamp: Date.now() }, {
        takeProfitPrice: 2200,
        mainGridDepth: 360,
        boxDepth: 400,
        stopLossGridCount: 4,
        direction: 'LONG',
      });
      expect(result.newState.kind).toBe('TAKE_PROFIT');
    });

    it('should stay in RUNNING when price is beyond fullPositionPrice but still within the stop-loss zone (regression guard: LIQUIDATING must trigger at boxDepth/liquidationPrice, not at fullPositionPrice)', () => {
      const state: BotFsmState = { kind: 'RUNNING', since: Date.now() };
      // fullPositionPrice = 1840 (d=360); price=1839 → d=361, just past mainGridDepth but
      // boxDepth=400 (liquidationPrice=1800) has not been reached yet.
      const result = fsm.transition(state, { type: 'TICK', price: 1839, timestamp: Date.now() }, {
        takeProfitPrice: 2200,
        mainGridDepth: 360,
        boxDepth: 400,
        stopLossGridCount: 4,
        direction: 'LONG',
      });
      expect(result.newState.kind).toBe('RUNNING');
    });

    it('should transition to LIQUIDATING when price crosses boxDepth (liquidationPrice) and stopLossGridCount > 0', () => {
      const state: BotFsmState = { kind: 'RUNNING', since: Date.now() };
      // boxDepth=400 → liquidationPrice=1800; price=1799 → d=401 > boxDepth
      const result = fsm.transition(state, { type: 'TICK', price: 1799, timestamp: Date.now() }, {
        takeProfitPrice: 2200,
        mainGridDepth: 360,
        boxDepth: 400,
        stopLossGridCount: 4,
        direction: 'LONG',
      });
      expect(result.newState.kind).toBe('LIQUIDATING');
      expect(result.action).toBe('LIQUIDATE_ALL');
    });

    it('should stay in RUNNING when price < fullPositionPrice but stopLossGridCount === 0 (no-stop-loss mode, STRATEGY_SPEC §8.6)', () => {
      const state: BotFsmState = { kind: 'RUNNING', since: Date.now() };
      const result = fsm.transition(state, { type: 'TICK', price: 1839, timestamp: Date.now() }, {
        takeProfitPrice: 2200,
        mainGridDepth: 360,
        boxDepth: 400,
        stopLossGridCount: 0,
        direction: 'LONG',
      });
      expect(result.newState.kind).toBe('RUNNING');
      expect(result.action).toBeUndefined();
    });

    it('SHORT: should transition to TAKE_PROFIT when price <= takeProfitPrice and position is zero', () => {
      const state: BotFsmState = { kind: 'RUNNING', since: Date.now() };
      const result = fsm.transition(state, { type: 'TICK', price: 1840, timestamp: Date.now() }, {
        takeProfitPrice: 1840,
        mainGridDepth: 360,
        boxDepth: 400,
        stopLossGridCount: 4,
        direction: 'SHORT',
      }, { baseAssetQty: 0 });
      expect(result.newState.kind).toBe('TAKE_PROFIT');
    });

    it('SHORT: should stay in RUNNING when price <= takeProfitPrice but position is non-zero', () => {
      const state: BotFsmState = { kind: 'RUNNING', since: Date.now() };
      const result = fsm.transition(state, { type: 'TICK', price: 1840, timestamp: Date.now() }, {
        takeProfitPrice: 1840,
        mainGridDepth: 360,
        boxDepth: 400,
        stopLossGridCount: 4,
        direction: 'SHORT',
      }, { baseAssetQty: -0.05 });
      expect(result.newState.kind).toBe('RUNNING');
    });

    it('SHORT: should stay in RUNNING when price is beyond fullPositionPrice but still within the stop-loss zone (regression guard)', () => {
      const state: BotFsmState = { kind: 'RUNNING', since: Date.now() };
      // fullPositionPrice = 2200 (d=360); price=2201 → d=361, just past mainGridDepth but
      // boxDepth=400 (liquidationPrice=2240) has not been reached yet.
      const result = fsm.transition(state, { type: 'TICK', price: 2201, timestamp: Date.now() }, {
        takeProfitPrice: 1840,
        mainGridDepth: 360,
        boxDepth: 400,
        stopLossGridCount: 4,
        direction: 'SHORT',
      });
      expect(result.newState.kind).toBe('RUNNING');
    });

    it('SHORT: should transition to LIQUIDATING when price crosses boxDepth (liquidationPrice) and stopLossGridCount > 0', () => {
      const state: BotFsmState = { kind: 'RUNNING', since: Date.now() };
      // boxDepth=400 → liquidationPrice=2240; price=2241 → d=401 > boxDepth
      const result = fsm.transition(state, { type: 'TICK', price: 2241, timestamp: Date.now() }, {
        takeProfitPrice: 1840,
        mainGridDepth: 360,
        boxDepth: 400,
        stopLossGridCount: 4,
        direction: 'SHORT',
      });
      expect(result.newState.kind).toBe('LIQUIDATING');
    });

    it('SHORT: should stay in RUNNING when price > fullPositionPrice but stopLossGridCount === 0 (no-stop-loss mode, STRATEGY_SPEC §8.6)', () => {
      const state: BotFsmState = { kind: 'RUNNING', since: Date.now() };
      const result = fsm.transition(state, { type: 'TICK', price: 2201, timestamp: Date.now() }, {
        takeProfitPrice: 1840,
        mainGridDepth: 360,
        boxDepth: 400,
        stopLossGridCount: 0,
        direction: 'SHORT',
      });
      expect(result.newState.kind).toBe('RUNNING');
    });

    it('should transition to PAUSED on USER_PAUSE', () => {
      const state: BotFsmState = { kind: 'RUNNING', since: Date.now() };
      const result = fsm.transition(state, { type: 'USER_PAUSE' }, {
        takeProfitPrice: 2200,
        mainGridDepth: 360,
        boxDepth: 400,
        stopLossGridCount: 4,
        direction: 'LONG',
      });
      expect(result.newState.kind).toBe('PAUSED');
    });

    it('should transition to LIQUIDATING on USER_LIQUIDATE', () => {
      const state: BotFsmState = { kind: 'RUNNING', since: Date.now() };
      const result = fsm.transition(state, { type: 'USER_LIQUIDATE' }, {
        takeProfitPrice: 2200,
        mainGridDepth: 360,
        boxDepth: 400,
        stopLossGridCount: 4,
        direction: 'LONG',
      });
      expect(result.newState.kind).toBe('LIQUIDATING');
    });

    it('should transition to PAUSED on ERROR_FATAL', () => {
      const state: BotFsmState = { kind: 'RUNNING', since: Date.now() };
      const result = fsm.transition(state, { type: 'ERROR_FATAL', error: { message: 'crash', code: 'FATAL' } }, {
        takeProfitPrice: 2200,
        mainGridDepth: 360,
        boxDepth: 400,
        stopLossGridCount: 4,
        direction: 'LONG',
      });
      expect(result.newState.kind).toBe('PAUSED');
    });
  });

  describe('TAKE_PROFIT transitions', () => {
    it('is terminal: stays in TAKE_PROFIT on price fall (Go bot_controller.go:199-203, no outbound edge)', () => {
      const state: BotFsmState = { kind: 'TAKE_PROFIT', startTime: Date.now(), exitPrice: 2200 };
      const result = fsm.transition(state, { type: 'TICK', price: 2199, timestamp: Date.now() }, {
        takeProfitPrice: 2200,
        mainGridDepth: 360,
        boxDepth: 400,
        stopLossGridCount: 4,
        direction: 'LONG',
      });
      expect(result.newState.kind).toBe('TAKE_PROFIT');
    });

    it('should stay in TAKE_PROFIT when price stays at takeProfitPrice', () => {
      const state: BotFsmState = { kind: 'TAKE_PROFIT', startTime: Date.now(), exitPrice: 2200 };
      const result = fsm.transition(state, { type: 'TICK', price: 2200, timestamp: Date.now() }, {
        takeProfitPrice: 2200,
        mainGridDepth: 360,
        boxDepth: 400,
        stopLossGridCount: 4,
        direction: 'LONG',
      });
      expect(result.newState.kind).toBe('TAKE_PROFIT');
    });

    it('should stay in TAKE_PROFIT on USER_RESUME', () => {
      const state: BotFsmState = { kind: 'TAKE_PROFIT', startTime: Date.now(), exitPrice: 2200 };
      const result = fsm.transition(state, { type: 'USER_RESUME' }, {
        takeProfitPrice: 2200,
        mainGridDepth: 360,
        boxDepth: 400,
        stopLossGridCount: 4,
        direction: 'LONG',
      });
      expect(result.newState.kind).toBe('TAKE_PROFIT');
    });
  });

  describe('LIQUIDATING transitions', () => {
    it('should transition to LIQUIDATED when position reaches zero', () => {
      const state: BotFsmState = { kind: 'LIQUIDATING', startTime: Date.now(), attemptCount: 0 };
      const result = fsm.transition(
        state,
        { type: 'ORDER_UPDATE', orderId: 'o1', status: 'FILLED', filledQty: 1 },
        { takeProfitPrice: 2200, mainGridDepth: 360, boxDepth: 400, stopLossGridCount: 4, direction: 'LONG' },
        { baseAssetQty: 0 },
      );
      expect(result.newState.kind).toBe('LIQUIDATED');
    });

    it('should stay in LIQUIDATING when position is still non-zero', () => {
      const state: BotFsmState = { kind: 'LIQUIDATING', startTime: Date.now(), attemptCount: 0 };
      const result = fsm.transition(
        state,
        { type: 'ORDER_UPDATE', orderId: 'o1', status: 'FILLED', filledQty: 0.5 },
        { takeProfitPrice: 2200, mainGridDepth: 360, boxDepth: 400, stopLossGridCount: 4, direction: 'LONG' },
        { baseAssetQty: 0.3 },
      );
      expect(result.newState.kind).toBe('LIQUIDATING');
    });

    it('should transition to LIQUIDATED when position is absent (backward compat)', () => {
      const state: BotFsmState = { kind: 'LIQUIDATING', startTime: Date.now(), attemptCount: 0 };
      const result = fsm.transition(
        state,
        { type: 'ORDER_UPDATE', orderId: 'o1', status: 'FILLED', filledQty: 1 },
        { takeProfitPrice: 2200, mainGridDepth: 360, boxDepth: 400, stopLossGridCount: 4, direction: 'LONG' },
      );
      expect(result.newState.kind).toBe('LIQUIDATED');
    });
  });

  describe('TAKE_PROFIT edge cases', () => {
    it('should NOT transition to TAKE_PROFIT if position is still non-zero', () => {
      const state: BotFsmState = { kind: 'RUNNING', since: Date.now() };
      const result = fsm.transition(
        state,
        { type: 'TICK', price: 2200, timestamp: Date.now() },
        { takeProfitPrice: 2200, mainGridDepth: 360, boxDepth: 400, stopLossGridCount: 4, direction: 'LONG' },
        { baseAssetQty: 0.5 },
      );
      expect(result.newState.kind).toBe('RUNNING');
    });

    it('should transition to TAKE_PROFIT when price >= takeProfitPrice AND position is zero', () => {
      const state: BotFsmState = { kind: 'RUNNING', since: Date.now() };
      const result = fsm.transition(
        state,
        { type: 'TICK', price: 2200, timestamp: Date.now() },
        { takeProfitPrice: 2200, mainGridDepth: 360, boxDepth: 400, stopLossGridCount: 4, direction: 'LONG' },
        { baseAssetQty: 0 },
      );
      expect(result.newState.kind).toBe('TAKE_PROFIT');
    });
  });

  describe('PAUSED transitions', () => {
    it('should transition to TRAILING_ENTRY on USER_RESUME (no position)', () => {
      const state: BotFsmState = { kind: 'PAUSED', reason: 'manual', since: Date.now() };
      const result = fsm.transition(state, { type: 'USER_RESUME' }, {
        takeProfitPrice: 2200,
        mainGridDepth: 360,
        boxDepth: 400,
        stopLossGridCount: 4,
        direction: 'LONG',
      });
      expect(result.newState.kind).toBe('TRAILING_ENTRY');
    });

    // TODO-4.2: PAUSED + USER_RESUME with existing position → RUNNING (not TRAILING_ENTRY)
    it('should transition to RUNNING on USER_RESUME when position exists', () => {
      const state: BotFsmState = { kind: 'PAUSED', reason: 'manual', since: Date.now() };
      const result = fsm.transition(state, { type: 'USER_RESUME' }, {
        takeProfitPrice: 2200,
        mainGridDepth: 360,
        boxDepth: 400,
        stopLossGridCount: 4,
        direction: 'LONG',
      }, { baseAssetQty: 0.05 });
      expect(result.newState.kind).toBe('RUNNING');
      expect(result.action).toBe('START_MAIN_GRID');
    });

    it('should transition to TRAILING_ENTRY on USER_RESUME when no position', () => {
      const state: BotFsmState = { kind: 'PAUSED', reason: 'manual', since: Date.now() };
      const result = fsm.transition(state, { type: 'USER_RESUME' }, {
        takeProfitPrice: 2200,
        mainGridDepth: 360,
        boxDepth: 400,
        stopLossGridCount: 4,
        direction: 'LONG',
      }, { baseAssetQty: 0 });
      expect(result.newState.kind).toBe('TRAILING_ENTRY');
    });
  });

  describe('LIQUIDATING transitions (STRATEGY_SPEC §9.3/§9.5)', () => {
    it('should transition to LIQUIDATED on TICK when position is zero', () => {
      const state: BotFsmState = { kind: 'LIQUIDATING', startTime: Date.now(), attemptCount: 0 };
      const result = fsm.transition(
        state,
        { type: 'TICK', price: 1799, timestamp: Date.now() },
        { takeProfitPrice: 2200, mainGridDepth: 360, boxDepth: 400, stopLossGridCount: 4, direction: 'LONG' },
        { baseAssetQty: 0 },
      );
      expect(result.newState.kind).toBe('LIQUIDATED');
    });

    it('should stay in LIQUIDATING on TICK when position is still non-zero', () => {
      const state: BotFsmState = { kind: 'LIQUIDATING', startTime: Date.now(), attemptCount: 0 };
      const result = fsm.transition(
        state,
        { type: 'TICK', price: 1799, timestamp: Date.now() },
        { takeProfitPrice: 2200, mainGridDepth: 360, boxDepth: 400, stopLossGridCount: 4, direction: 'LONG' },
        { baseAssetQty: 0.3 },
      );
      expect(result.newState.kind).toBe('LIQUIDATING');
    });

    it('should transition to LIQUIDATED on POSITION_UPDATE when position reaches zero', () => {
      const state: BotFsmState = { kind: 'LIQUIDATING', startTime: Date.now(), attemptCount: 0 };
      const result = fsm.transition(
        state,
        { type: 'POSITION_UPDATE', position: { symbol: 'ETH/USDT', baseAssetQty: 0, quoteAssetQty: 0, entryPrice: 0, leverage: 1, marginType: 'CROSS' } },
        { takeProfitPrice: 2200, mainGridDepth: 360, boxDepth: 400, stopLossGridCount: 4, direction: 'LONG' },
        { baseAssetQty: 0 },
      );
      expect(result.newState.kind).toBe('LIQUIDATED');
    });
  });

  describe('LIQUIDATED state', () => {
    it('should remain in LIQUIDATED', () => {
      const state: BotFsmState = { kind: 'LIQUIDATED', finalPnl: 100, closedAt: Date.now() };
      const result = fsm.transition(state, { type: 'TICK', price: 2000, timestamp: Date.now() }, {
        takeProfitPrice: 2200,
        mainGridDepth: 360,
        boxDepth: 400,
        stopLossGridCount: 4,
        direction: 'LONG',
      });
      expect(result.newState.kind).toBe('LIQUIDATED');
    });
  });

  describe('HOLD state', () => {
    it('should remain in HOLD', () => {
      const state: BotFsmState = { kind: 'HOLD', reason: 'boundary exceeded' };
      const result = fsm.transition(state, { type: 'TICK', price: 2000, timestamp: Date.now() }, {
        takeProfitPrice: 2200,
        mainGridDepth: 360,
        boxDepth: 400,
        stopLossGridCount: 4,
        direction: 'LONG',
      });
      expect(result.newState.kind).toBe('HOLD');
    });
  });
});
