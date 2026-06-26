import { describe, it, expect } from 'vitest';
import { decideBoxActivation, type BoxCandidate } from './decide-box-activation';

// 箱体: takeProfitPrice=2800, mainGridCount=200, mainGridStep=2 → fullPositionPrice=2400, high=2800
// 真实箱底 liquidationPrice = 2400 - 隔离2 - 止损4×2 = 2390（spec §三 BoxLowPrice）
// activationPrice 默认 = (2400+2800)/2 = 2600。激活窗口: 2390 < price < 2600（spec §4.1）
const box = (overrides?: Partial<BoxCandidate>): BoxCandidate => ({
  configId: 'box-1',
  direction: 'LONG',
  takeProfitPrice: 2800,
  mainGridCount: 200,
  mainGridStep: 2,
  stopLossGridCount: 4,
  stopLossGridStep: 2,
  isolationStep: 2,
  activationPrice: 0,
  trailingEntry: true,
  ...overrides,
});

describe('decideBoxActivation', () => {
  it('returns null when a box is already active', () => {
    const out = decideBoxActivation({ price: 2500, lastPrice: 2510, hasActiveBox: true, boxes: [box()] });
    expect(out).toBeNull();
  });

  it('returns null when price is outside every activation window', () => {
    const out = decideBoxActivation({ price: 2700, lastPrice: 2710, hasActiveBox: false, boxes: [box()] });
    expect(out).toBeNull();
  });

  it('returns null when price is below the true box bottom (incl. isolation + stop-loss)', () => {
    const out = decideBoxActivation({ price: 2380, lastPrice: 2350, hasActiveBox: false, boxes: [box()] });
    expect(out).toBeNull();
  });

  it('activates when price is inside the stop-loss zone (BoxLowPrice < price < ActivationPrice, spec §4.1)', () => {
    // 2390 < 2395 < 2400：价格在止损区内，按 spec 应激活
    const out = decideBoxActivation({ price: 2395, lastPrice: 2380, hasActiveBox: false, boxes: [box()] });
    expect(out).toEqual({ configId: 'box-1', mode: 'RUNNING' });
  });

  it('activates with TRAILING_ENTRY when price drops into the window (price < lastPrice)', () => {
    const out = decideBoxActivation({ price: 2500, lastPrice: 2550, hasActiveBox: false, boxes: [box()] });
    expect(out).toEqual({ configId: 'box-1', mode: 'TRAILING_ENTRY' });
  });

  it('activates with RUNNING when price rises into the window (price >= lastPrice)', () => {
    const out = decideBoxActivation({ price: 2500, lastPrice: 2450, hasActiveBox: false, boxes: [box()] });
    expect(out).toEqual({ configId: 'box-1', mode: 'RUNNING' });
  });

  it('uses TRAILING_ENTRY on first tick (lastPrice null) when entering from above semantics', () => {
    const out = decideBoxActivation({ price: 2500, lastPrice: null, hasActiveBox: false, boxes: [box()] });
    expect(out).toEqual({ configId: 'box-1', mode: 'TRAILING_ENTRY' });
  });

  it('always RUNNING when box has trailingEntry disabled, regardless of direction', () => {
    const out = decideBoxActivation({ price: 2500, lastPrice: 2550, hasActiveBox: false, boxes: [box({ trailingEntry: false })] });
    expect(out).toEqual({ configId: 'box-1', mode: 'RUNNING' });
  });

  it('respects an explicit activationPrice over the default midpoint', () => {
    const out = decideBoxActivation({ price: 2500, lastPrice: 2550, hasActiveBox: false, boxes: [box({ activationPrice: 2450 })] });
    expect(out).toBeNull();
  });

  it('picks the box whose window contains the price among multiple non-overlapping boxes', () => {
    const lower = box({ configId: 'lower', takeProfitPrice: 2800 });
    const upper = box({ configId: 'upper', takeProfitPrice: 3400, mainGridCount: 200, mainGridStep: 2 });
    const out = decideBoxActivation({ price: 3100, lastPrice: 3050, hasActiveBox: false, boxes: [lower, upper] });
    expect(out).toEqual({ configId: 'upper', mode: 'RUNNING' });
  });

});

describe('decideBoxActivation SHORT', () => {
  const shortBox = {
    configId: 'short-1',
    direction: 'SHORT' as const,
    takeProfitPrice: 2200,
    mainGridCount: 10,
    mainGridStep: 60,        // 满仓线 2800
    stopLossGridCount: 4,
    stopLossGridStep: 15,
    isolationStep: 60,       // 清算线 2200+600+60+60=2920
    activationPrice: 0,      // 默认主网格中点 d=300 → 2500
    trailingEntry: false,
  };

  it('激活窗口：activationPrice(2500) < price < liquidation(2920) 内激活', () => {
    const r = decideBoxActivation({ price: 2600, lastPrice: null, hasActiveBox: false, boxes: [shortBox] });
    expect(r).toEqual({ configId: 'short-1', mode: 'RUNNING' });
  });

  it('价格低于激活价（止盈侧）不激活', () => {
    expect(decideBoxActivation({ price: 2450, lastPrice: null, hasActiveBox: false, boxes: [shortBox] })).toBeNull();
  });

  it('价格越过清算线不激活', () => {
    expect(decideBoxActivation({ price: 2930, lastPrice: null, hasActiveBox: false, boxes: [shortBox] })).toBeNull();
  });

  it('trailingEntry: 价格仍在上行（向亏损方向）→ TRAILING_ENTRY；回落 → RUNNING', () => {
    const box = { ...shortBox, trailingEntry: true };
    const up = decideBoxActivation({ price: 2600, lastPrice: 2580, hasActiveBox: false, boxes: [box] });
    expect(up?.mode).toBe('TRAILING_ENTRY');
    const down = decideBoxActivation({ price: 2600, lastPrice: 2620, hasActiveBox: false, boxes: [box] });
    expect(down?.mode).toBe('RUNNING');
  });
});
