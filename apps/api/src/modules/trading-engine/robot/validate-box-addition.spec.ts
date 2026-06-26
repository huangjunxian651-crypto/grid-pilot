import { describe, it, expect } from 'vitest';
import { validateBoxAddition, type BoxSpec } from './validate-box-addition';

// 真实箱底 = takeProfitPrice - step*count - isolationStep - slCount*slStep（spec §三 BoxLowPrice）
// 默认夹具: 2800 - 400 - 2 - 8 = 2390，真实范围 [2390, 2800]
const box = (o: Partial<BoxSpec>): BoxSpec => ({
  direction: 'LONG', takeProfitPrice: 2800, mainGridCount: 200, mainGridStep: 2,
  stopLossGridCount: 4, stopLossGridStep: 2, isolationStep: 2, ...o,
});

describe('validateBoxAddition', () => {
  it('accepts the first box (no existing) with stop-loss', () => {
    const r = validateBoxAddition(box({}), [], 'LONG');
    expect(r.valid).toBe(true);
  });

  it('accepts the first box even without stop-loss (it is the lowest)', () => {
    const r = validateBoxAddition(box({ stopLossGridCount: 0 }), [], 'LONG');
    expect(r.valid).toBe(true);
  });

  it('rejects direction mismatch with robot', () => {
    const r = validateBoxAddition(box({ direction: 'SHORT' }), [], 'LONG');
    expect(r.valid).toBe(false);
    expect(r.errors.join()).toMatch(/direction/i);
  });

  it('rejects overlap with an existing box', () => {
    // existing: 2400..2800. new: 2600..3000 overlaps.
    const existing = box({ takeProfitPrice: 2800 }); // bottom 2400
    const newBox = box({ takeProfitPrice: 3000, mainGridCount: 200, mainGridStep: 2 }); // bottom 2600
    const r = validateBoxAddition(newBox, [existing], 'LONG');
    expect(r.valid).toBe(false);
    expect(r.errors.join()).toMatch(/overlap|重叠/i);
  });

  it('accepts a non-overlapping box stacked above', () => {
    // existing [2390, 2800]; new takeProfitPrice 3210 → 真实箱底 3210-400-2-8 = 2800（边界相接，不算重叠）
    const existing = box({ takeProfitPrice: 2800 });
    const newBox = box({ takeProfitPrice: 3210, mainGridCount: 200, mainGridStep: 2 });
    const r = validateBoxAddition(newBox, [existing], 'LONG');
    expect(r.valid).toBe(true);
  });

  it('rejects a box whose isolation + stop-loss zone overlaps the box below (spec §三/§12.1)', () => {
    // existing [2390, 2800]; new takeProfitPrice 3200 → 主网格底 2800，但隔离+止损区下探到 2790，
    // 与下方箱的主网格顶部重叠——旧实现只比主网格区间会误放行
    const existing = box({ takeProfitPrice: 2800 });
    const newBox = box({ takeProfitPrice: 3200, mainGridCount: 200, mainGridStep: 2 });
    const r = validateBoxAddition(newBox, [existing], 'LONG');
    expect(r.valid).toBe(false);
    expect(r.errors.join()).toMatch(/overlap|重叠/i);
  });

  it('rejects adding a box below an existing lowest box that has no stop-loss', () => {
    // existing lowest 无止损，真实箱底 2400-2 = 2398（仅隔离带）
    const existing = box({ takeProfitPrice: 2800, stopLossGridCount: 0 });
    // new box below: 顶 2398 与 existing 真实箱底相接，自身真实箱底 1988
    const newBelow = box({ takeProfitPrice: 2398, mainGridCount: 200, mainGridStep: 2, stopLossGridCount: 4 });
    const r = validateBoxAddition(newBelow, [existing], 'LONG');
    expect(r.valid).toBe(false);
    expect(r.errors.join()).toMatch(/stop.?loss|止损/i);
  });

  it('accepts adding a box below when the existing (soon non-lowest) box has stop-loss', () => {
    const existing = box({ takeProfitPrice: 2800, stopLossGridCount: 4 }); // 真实箱底 2390
    const newBelow = box({ takeProfitPrice: 2390, mainGridCount: 200, mainGridStep: 2, stopLossGridCount: 4 });
    const r = validateBoxAddition(newBelow, [existing], 'LONG');
    expect(r.valid).toBe(true);
  });

  it('rejects a non-lowest new box without stop-loss', () => {
    // existing lowest 真实范围 [1990, 2400]（有止损）；new above 无止损，真实箱底 2802-400-2 = 2400
    const existing = box({ takeProfitPrice: 2400, mainGridCount: 200, mainGridStep: 2, stopLossGridCount: 4 });
    const newAbove = box({ takeProfitPrice: 2802, stopLossGridCount: 0 }); // 不是最低箱，无止损 → invalid
    const r = validateBoxAddition(newAbove, [existing], 'LONG');
    expect(r.valid).toBe(false);
    expect(r.errors.join()).toMatch(/stop.?loss|止损/i);
  });

  it('箱激活价越界 → validateBoxAddition 失败', () => {
    const b = { direction: 'LONG', takeProfitPrice: 2500, mainGridCount: 60, mainGridStep: 10, stopLossGridCount: 0, stopLossGridStep: 0, isolationStep: 0, activationPrice: 2500 };
    const r = validateBoxAddition(b as any, [], 'LONG');
    expect(r.valid).toBe(false);
    expect(r.errors.some(e => /activationPrice/.test(e))).toBe(true);
  });
});

describe('validateBoxAddition SHORT', () => {
  // SHORT 真实范围 [boxLowPrice, boxHighPrice] = [takeProfitPrice, liquidationPrice]
  // takeProfitPrice=2200, mainGridCount=200, mainGridStep=2 → mainGridDepth=400 → fullPosition=2600
  // isolation=2, stopLoss=4x2 → boxDepth=410 → liquidation=2610 → 真实范围 [2200, 2610]
  const shortBox = (o: Partial<BoxSpec>): BoxSpec => ({
    direction: 'SHORT', takeProfitPrice: 2200, mainGridCount: 200, mainGridStep: 2,
    stopLossGridCount: 4, stopLossGridStep: 2, isolationStep: 2, ...o,
  });

  it('accepts a valid SHORT box on a SHORT robot', () => {
    const r = validateBoxAddition(shortBox({}), [], 'SHORT');
    expect(r.valid).toBe(true);
  });

  it('rejects two overlapping SHORT boxes', () => {
    // existing [2200, 2610]; new takeProfitPrice=2500 → fullPosition=2900, liquidation=2910 → [2500, 2910]
    // 2500 < 2610 → overlap
    const existing = shortBox({});
    const overlapping = shortBox({ takeProfitPrice: 2500 });
    const r = validateBoxAddition(overlapping, [existing], 'SHORT');
    expect(r.valid).toBe(false);
    expect(r.errors.join()).toMatch(/overlap|重叠/i);
  });

  it('rejects direction mismatch (SHORT box on LONG robot)', () => {
    const r = validateBoxAddition(shortBox({}), [], 'LONG');
    expect(r.valid).toBe(false);
    expect(r.errors.join()).toMatch(/direction/i);
  });

  it('on a SHORT robot, only the loss-edge box (highest boxHighPrice) may skip stop-loss', () => {
    // boxA: [2200, 2610]（有止损，非亏损边缘）
    const boxA = shortBox({ stopLossGridCount: 4 });
    // boxB: takeProfitPrice=2610（与 boxA 边界相接，不重叠），无止损 → fullPosition=3010，
    // isolation=2 → liquidation = 2610 + 400 + 2 = 3012 → [2610, 3012]，boxHighPrice 最大 → 亏损边缘箱
    const boxB = shortBox({ takeProfitPrice: 2610, stopLossGridCount: 0, stopLossGridStep: 0 });
    const accepted = validateBoxAddition(boxB, [boxA], 'SHORT');
    expect(accepted.valid).toBe(true);

    // 反例：非亏损边缘箱（boxA）无止损 → 拒绝
    const boxANoStopLoss = shortBox({ stopLossGridCount: 0, stopLossGridStep: 0 });
    const rejected = validateBoxAddition(boxB, [boxANoStopLoss], 'SHORT');
    expect(rejected.valid).toBe(false);
    expect(rejected.errors.join()).toMatch(/stop.?loss|止损/i);
  });
});
