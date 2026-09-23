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

describe('validateBoxAddition — 每格 USDT 名义价值预校验（按箱体真实最低价，不是实时价）', () => {
  // 默认夹具真实范围 [2390, 2800]（见顶部注释），最低价 2390。
  const mc = { minQty: 0.001, minNotional: 20, stepSize: 0.01 };

  it('每格量按箱体最低价折算名义价值不足 minNotional 时拒绝', () => {
    // 每格投入 20 USDT，最低价按 stepSize 截断后仍可能低于交易所门槛 23.90。
    const r = validateBoxAddition(box({ mainGridPortionSize: 20 }), [], 'LONG', mc);
    expect(r.valid).toBe(false);
    expect(r.errors.join()).toMatch(/order (size|value)/i);
  });

  it('每格量在箱体最低价上仍能满足 minNotional（且已是 stepSize 整数倍）时通过', () => {
    // 按最低价换算，23.90 是实际下限；40 USDT 足够。
    const r = validateBoxAddition(box({ mainGridPortionSize: 40 }), [], 'LONG', mc);
    expect(r.valid).toBe(true);
  });

  it('每格量低于 minQty 时拒绝，即便名义价值达标', () => {
    const r = validateBoxAddition(box({ mainGridPortionSize: 1 }), [], 'LONG', { minQty: 0.001, minNotional: 0, stepSize: 0 });
    expect(r.valid).toBe(false);
  });

  it('不传 marketConstraints（交易所规则拉取失败降级）时跳过该项校验', () => {
    const r = validateBoxAddition(box({ mainGridPortionSize: 0.0000001 }), [], 'LONG');
    expect(r.valid).toBe(true);
  });

  it('未提供 mainGridPortionSize 时跳过该项校验（旧调用点兼容）', () => {
    const r = validateBoxAddition(box({}), [], 'LONG', mc);
    expect(r.valid).toBe(true);
  });

  it('SHORT 箱按其真实最低价（takeProfitPrice 端）校验，而非实时价', () => {
    // SHORT 真实范围 [2200, 2610]（见下方 shortBox 夹具注释），最低价即 takeProfitPrice=2200
    // 20 USDT 在最低价按 0.01 stepSize 换算后至少需要 22 USDT，20 USDT 拒绝。
    const b: BoxSpec = {
      direction: 'SHORT', takeProfitPrice: 2200, mainGridCount: 200, mainGridStep: 2,
      stopLossGridCount: 4, stopLossGridStep: 2, isolationStep: 2, mainGridPortionSize: 20,
    };
    const r = validateBoxAddition(b, [], 'SHORT', mc);
    expect(r.valid).toBe(false);
    expect(r.errors.join()).toMatch(/order (size|value)/i);
  });

  it('按最低价和 stepSize 折算出的实际 USDT 下限必须满足', () => {
    const b: BoxSpec = {
      direction: 'LONG', takeProfitPrice: 2200, mainGridCount: 200, mainGridStep: 2,
      stopLossGridCount: 0, stopLossGridStep: 0, isolationStep: 0, mainGridPortionSize: 30,
    };
    const r = validateBoxAddition(b, [], 'LONG', mc);
    expect(r.valid).toBe(false);
    expect(r.errors.join()).toMatch(/order (size|value)/i);
  });

  it('达到按最低价折算后的真实 USDT 下限时通过', () => {
    const b: BoxSpec = {
      direction: 'LONG', takeProfitPrice: 2200, mainGridCount: 200, mainGridStep: 2,
      stopLossGridCount: 0, stopLossGridStep: 0, isolationStep: 0, mainGridPortionSize: 40,
    };
    const r = validateBoxAddition(b, [], 'LONG', mc);
    expect(r.valid).toBe(true);
  });
});

describe('validateBoxAddition — USDT 投入不需要与基础币 stepSize 对齐', () => {
  const mc = { minQty: 0.001, minNotional: 20, stepSize: 0.01 };

  it('任意满足门槛的 USDT 金额都可以输入', () => {
    const r = validateBoxAddition(box({ mainGridPortionSize: 30 }), [], 'LONG', mc);
    expect(r.valid).toBe(true);
  });

  it('更大的 USDT 金额同样通过', () => {
    const r = validateBoxAddition(box({ mainGridPortionSize: 50 }), [], 'LONG', mc);
    expect(r.valid).toBe(true);
  });

  it('stepSize 未提供时仍按最小名义价值校验', () => {
    const r = validateBoxAddition(box({ mainGridPortionSize: 20 }), [], 'LONG', { minQty: 0.001, minNotional: 20, stepSize: 0 });
    expect(r.valid).toBe(true);
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
