import { describe, it, expect } from 'vitest';
import { BotFsm } from '../fsm/bot-fsm';
import { ETH_RANGE_1, ETH_RANGE_1_DERIVED, positionAt } from './fixtures/strategy-spec-cases';

const fsm = new BotFsm();

const FULL_POSITION_PRICE = ETH_RANGE_1_DERIVED.fullPositionPrice;
const TAKE_PROFIT_PRICE = ETH_RANGE_1.takeProfitPrice;
const MAIN_GRID_DEPTH = TAKE_PROFIT_PRICE - FULL_POSITION_PRICE;

function runningTickAt(price: number, stopLossGridCount = ETH_RANGE_1.stopLossGridCount, baseQty = 1) {
  return fsm.transition(
    { kind: 'RUNNING', since: 0 },
    { type: 'TICK', price, timestamp: Date.now() },
    { takeProfitPrice: TAKE_PROFIT_PRICE, mainGridDepth: MAIN_GRID_DEPTH, stopLossGridCount, direction: 'LONG' },
    positionAt(baseQty),
  );
}

describe('BotFsm (contract, RUNNING → LIQUIDATING trigger)', () => {
  it('triggers LIQUIDATING when price beyond fullPositionPrice AND stopLossGridCount > 0', () => {
    const r = runningTickAt(FULL_POSITION_PRICE - 1, 4);
    expect(r.newState.kind).toBe('LIQUIDATING');
    expect(r.action).toBe('LIQUIDATE_ALL');
  });

  it('does NOT trigger LIQUIDATING when price beyond fullPositionPrice AND stopLossGridCount === 0 (no-stop-loss mode per STRATEGY_SPEC §8.6)', () => {
    const r = runningTickAt(FULL_POSITION_PRICE - 1, 0);
    expect(r.newState.kind).toBe('RUNNING');
    expect(r.action).toBeUndefined();
  });
});

describe('BotFsm (contract, TRAILING_ENTRY exits)', () => {
  const baseTrail = { kind: 'TRAILING_ENTRY' as const, entryPrice: 2400, extremePrice: 2400, trailingCallbackRate: 0.002 };

  it('transitions to RUNNING when price rebounds >= callback rate (LONG)', () => {
    // first tick lowers extreme to 2300
    const r1 = fsm.transition(baseTrail, { type: 'TICK', price: 2300, timestamp: 0 }, { takeProfitPrice: 2800, mainGridDepth: 600, stopLossGridCount: 4, direction: 'LONG' });
    expect(r1.newState.kind).toBe('TRAILING_ENTRY');
    // second tick: 2300 * 1.002 = 2304.6, price 2305 triggers
    const r2 = fsm.transition(r1.newState, { type: 'TICK', price: 2305, timestamp: 0 }, { takeProfitPrice: 2800, mainGridDepth: 600, stopLossGridCount: 4, direction: 'LONG' });
    expect(r2.newState.kind).toBe('RUNNING');
    expect(r2.action).toBe('START_MAIN_GRID');
  });

  it('transitions TRAILING_ENTRY → LIQUIDATING when price falls beyond fullPositionPrice (STRATEGY_SPEC §5.1)', () => {
    const r = fsm.transition(baseTrail, { type: 'TICK', price: 2199, timestamp: 0 }, { takeProfitPrice: 2800, mainGridDepth: 600, stopLossGridCount: 4, direction: 'LONG' });
    expect(r.newState.kind).toBe('LIQUIDATING');
    expect(r.action).toBeUndefined(); // TRAILING_ENTRY path drives liquidation via state, not action — avoid double-firing in runner
  });

  it('stays in TRAILING_ENTRY when price falls beyond fullPositionPrice but stopLossGridCount === 0 (no-stop-loss mode)', () => {
    // STRATEGY_SPEC §8.6: bots configured without stop-loss continue running even beyond fullPositionPrice.
    // Implementation aligns with Go reference (bot_controller.go:579-582) which applies the
    // stopGridCount > 0 guard to both RUNNING and TRAILING_ENTRY uniformly.
    const r = fsm.transition(
      baseTrail,
      { type: 'TICK', price: 2199, timestamp: 0 },
      { takeProfitPrice: 2800, mainGridDepth: 600, stopLossGridCount: 0, direction: 'LONG' },
    );
    expect(r.newState.kind).toBe('TRAILING_ENTRY');
  });
});

describe('BotFsm (contract, TAKE_PROFIT conditions)', () => {
  it('transitions RUNNING → TAKE_PROFIT only when price >= takeProfitPrice AND position is zero', () => {
    const withPos = fsm.transition({ kind: 'RUNNING', since: 0 }, { type: 'TICK', price: 2801, timestamp: 0 }, { takeProfitPrice: 2800, mainGridDepth: 600, stopLossGridCount: 4, direction: 'LONG' }, positionAt(0.5));
    expect(withPos.newState.kind).toBe('RUNNING');

    const noPos = fsm.transition({ kind: 'RUNNING', since: 0 }, { type: 'TICK', price: 2801, timestamp: 0 }, { takeProfitPrice: 2800, mainGridDepth: 600, stopLossGridCount: 4, direction: 'LONG' }, positionAt(0));
    expect(noPos.newState.kind).toBe('TAKE_PROFIT');
  });
});

describe('BotFsm (contract) — TAKE_PROFIT is terminal (Go bot_controller.go:199-203)', () => {
  it('LONG: TAKE_PROFIT does NOT transition to LIQUIDATED on price falling back below takeProfitPrice (LONG 止盈线)', () => {
    const tp = { kind: 'TAKE_PROFIT' as const, startTime: 0, exitPrice: 2801 };
    const r = fsm.transition(tp, { type: 'TICK', price: 2799, timestamp: 0 }, { takeProfitPrice: 2800, mainGridDepth: 600, stopLossGridCount: 4, direction: 'LONG' });
    expect(r.newState.kind).toBe('TAKE_PROFIT'); // terminal — stays put
  });
  it('SHORT: TAKE_PROFIT does NOT transition on price rising back above takeProfitPrice (SHORT 止盈线)', () => {
    const tp = { kind: 'TAKE_PROFIT' as const, startTime: 0, exitPrice: 2199 };
    const r = fsm.transition(tp, { type: 'TICK', price: 2201, timestamp: 0 }, { takeProfitPrice: 2200, mainGridDepth: 600, stopLossGridCount: 4, direction: 'SHORT' });
    expect(r.newState.kind).toBe('TAKE_PROFIT');
  });
});

describe('BotFsm SHORT 镜像（d 空间统一后）', () => {
  const shortCfg = { takeProfitPrice: 2200, mainGridDepth: 600, stopLossGridCount: 4, direction: 'SHORT' as const };

  it('RUNNING: 价格升破满仓线（2800）→ LIQUIDATING + LIQUIDATE_ALL', () => {
    const r = fsm.transition({ kind: 'RUNNING', since: 0 }, { type: 'TICK', price: 2801, timestamp: 0 }, shortCfg);
    expect(r.newState.kind).toBe('LIQUIDATING');
    expect(r.action).toBe('LIQUIDATE_ALL');
  });

  it('RUNNING: slCount=0 时升破满仓线不清算（无止损模式）', () => {
    const r = fsm.transition({ kind: 'RUNNING', since: 0 }, { type: 'TICK', price: 2801, timestamp: 0 }, { ...shortCfg, stopLossGridCount: 0 });
    expect(r.newState.kind).toBe('RUNNING');
  });

  it('RUNNING: 价格跌至止盈端（2200）且无持仓 → TAKE_PROFIT', () => {
    const r = fsm.transition({ kind: 'RUNNING', since: 0 }, { type: 'TICK', price: 2199, timestamp: 0 }, shortCfg, { baseAssetQty: 0 });
    expect(r.newState.kind).toBe('TAKE_PROFIT');
  });

  it('TRAILING_ENTRY: 价格从极高点回落 ≥ 回调率 → RUNNING', () => {
    const trail = { kind: 'TRAILING_ENTRY' as const, entryPrice: 2600, extremePrice: 2600, trailingCallbackRate: 0.002 };
    const r1 = fsm.transition(trail, { type: 'TICK', price: 2700, timestamp: 0 }, shortCfg);
    expect(r1.newState.kind).toBe('TRAILING_ENTRY');
    const r2 = fsm.transition(r1.newState, { type: 'TICK', price: 2694, timestamp: 0 }, shortCfg);
    expect(r2.newState.kind).toBe('RUNNING');
  });

  it('TRAILING_ENTRY: 价格跌破激活价（窗口关闭）→ CANCELLED', () => {
    const trail = { kind: 'TRAILING_ENTRY' as const, entryPrice: 2600, extremePrice: 2600, trailingCallbackRate: 0.002 };
    const r = fsm.transition(trail, { type: 'TICK', price: 2400, timestamp: 0 }, { ...shortCfg, activationPrice: 2500 });
    expect(r.newState.kind).toBe('CANCELLED');
  });
});

describe('BotFsm (contract) — PAUSED 恢复分支（domain-guide §2.3）', () => {
  const LONG_CFG = {
    takeProfitPrice: TAKE_PROFIT_PRICE,
    mainGridDepth: MAIN_GRID_DEPTH,
    stopLossGridCount: ETH_RANGE_1.stopLossGridCount,
    direction: 'LONG' as const,
  };
  const SHORT_CFG = { takeProfitPrice: 2200, mainGridDepth: 600, stopLossGridCount: 4, direction: 'SHORT' as const };
  const paused = () => ({ kind: 'PAUSED' as const, reason: 'manual', since: 0 });

  // C1：恢复且有仓 → RUNNING + START_MAIN_GRID
  it('C1: USER_RESUME with position → RUNNING + START_MAIN_GRID', () => {
    const r = fsm.transition(paused(), { type: 'USER_RESUME' }, LONG_CFG, positionAt(1));
    expect(r.newState.kind).toBe('RUNNING');
    expect(r.action).toBe('START_MAIN_GRID');
  });

  // C2：恢复且空仓 → TRAILING_ENTRY，无 action
  it('C2: USER_RESUME with zero position → TRAILING_ENTRY, no action', () => {
    const r = fsm.transition(paused(), { type: 'USER_RESUME' }, LONG_CFG, positionAt(0));
    expect(r.newState.kind).toBe('TRAILING_ENTRY');
    expect(r.action).toBeUndefined();
  });

  // C3：SHORT 镜像，空仓恢复 → TRAILING_ENTRY
  it('C3: SHORT mirror, zero position resume → TRAILING_ENTRY', () => {
    const r = fsm.transition(paused(), { type: 'USER_RESUME' }, SHORT_CFG, { baseAssetQty: 0 });
    expect(r.newState.kind).toBe('TRAILING_ENTRY');
  });

  // C4：position 缺省（undefined）→ 保守按空仓 → TRAILING_ENTRY
  it('C4: USER_RESUME with undefined position → TRAILING_ENTRY (treated as flat)', () => {
    const r = fsm.transition(paused(), { type: 'USER_RESUME' }, LONG_CFG);
    expect(r.newState.kind).toBe('TRAILING_ENTRY');
  });

  // C5：PAUSED 稳定性——TICK 不触发任何转移/动作（暂停=停手）
  it.each([
    ['inside box', 2500],
    ['beyond stop-loss', 2200],
    ['at take-profit', 2801],
  ])('C5: PAUSED + TICK (%s) stays PAUSED, no action', (_label, price) => {
    const r = fsm.transition(paused(), { type: 'TICK', price, timestamp: 0 }, LONG_CFG, positionAt(1));
    expect(r.newState.kind).toBe('PAUSED');
    expect(r.action).toBeUndefined();
  });

  // C6：阈值边界 |qty|=1e-12 视为空仓 → TRAILING_ENTRY
  it('C6: |qty| == 1e-12 boundary is treated as flat → TRAILING_ENTRY', () => {
    const r = fsm.transition(paused(), { type: 'USER_RESUME' }, LONG_CFG, { baseAssetQty: 1e-12 });
    expect(r.newState.kind).toBe('TRAILING_ENTRY');
  });
});
