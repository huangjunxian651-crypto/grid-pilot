import { describe, it, expect } from 'vitest';
import { computeFillSavings } from './avg-grid-price';
import type { BoxTargetConfig as TargetPositionConfig } from '@gridpilot/shared-types';

// tp=2000, step=10, portion=0.01, mainGridCount=50；卖出下沿线 gridIndexToBuyPrice(17,18,19)=1820,1810,1800
const cfg: TargetPositionConfig = {
  takeProfitPrice: 2000, mainGridCount: 50, mainGridStep: 10, mainGridPortionSize: 0.01,
  stopLossGridCount: 4, stopLossGridStep: 5, isolationStep: 5, direction: 'LONG',
};
const P = 0.01; // portion

describe('computeFillSavings - SELL', () => {
  it('单格卖出：成交价正好落在该格网格线 → savings 0', () => {
    // 持仓 19→18，跨越第 18 格(reduce)，网格线 = toPrice(18·step) = 1820（按持仓区间归属，与成交价无关）
    const r = computeFillSavings({ side: 'SELL', price: 1820, config: cfg, preOrderPosition: 19 * P, prevFilledQty: 0, thisFillQty: 1 * P });
    expect(r.avgGridPrice).toBeCloseTo(1820, 4);
    expect(r.savings).toBeCloseTo(0, 6);
  });
  it('多格一次成交 gap=2.5 → avg 1812', () => {
    const r = computeFillSavings({ side: 'SELL', price: 1820.1, config: cfg, preOrderPosition: 20.5 * P, prevFilledQty: 0, thisFillQty: 2.5 * P });
    expect(r.avgGridPrice).toBeCloseTo(1812, 4);
    expect(r.savings).toBeCloseTo((1820.1 - 1812) * 2.5 * P, 6);
  });
  it('部分成交 2.0 远线优先 → avg 1810', () => {
    const r = computeFillSavings({ side: 'SELL', price: 1820.1, config: cfg, preOrderPosition: 20.5 * P, prevFilledQty: 0, thisFillQty: 2.0 * P });
    expect(r.avgGridPrice).toBeCloseTo(1810, 4);
    expect(r.savings).toBeCloseTo((1820.1 - 1810) * 2.0 * P, 6);
  });
  it('撤单重挂续单 gap=0.5 → avg 1820', () => {
    const r = computeFillSavings({ side: 'SELL', price: 1820.1, config: cfg, preOrderPosition: 18.5 * P, prevFilledQty: 0, thisFillQty: 0.5 * P });
    expect(r.avgGridPrice).toBeCloseTo(1820, 4);
    expect(r.savings).toBeCloseTo((1820.1 - 1820) * 0.5 * P, 6);
  });
  it('多次 fill 累计：先1.5再0.5，savings 之和 = 一次2.0', () => {
    const a = computeFillSavings({ side: 'SELL', price: 1820.1, config: cfg, preOrderPosition: 20.5 * P, prevFilledQty: 0, thisFillQty: 1.5 * P });
    const b = computeFillSavings({ side: 'SELL', price: 1820.1, config: cfg, preOrderPosition: 20.5 * P, prevFilledQty: 1.5 * P, thisFillQty: 0.5 * P });
    expect(a.savings + b.savings).toBeCloseTo((1820.1 - 1810) * 2.0 * P, 6);
  });
  it('按持仓区间归属：旧实现 gap<=0 兜底为 0 的场景，现返回该格真实网格线', () => {
    // 持仓 18→17，跨越第 17 格(reduce)，网格线 = toPrice(17·step) = 1830（旧实现此处错误返回 0/"—"）
    const r = computeFillSavings({ side: 'SELL', price: 1820.1, config: cfg, preOrderPosition: 18 * P, prevFilledQty: 0, thisFillQty: 1 * P });
    expect(r.avgGridPrice).toBeCloseTo(1830, 4);
    expect(r.savings).toBeCloseTo((1820.1 - 1830) * 1 * P, 6);
  });
});

describe('computeFillSavings - BUY (镜像)', () => {
  it('多格一次买入 gap=2.5 → avg 1788', () => {
    const r = computeFillSavings({ side: 'BUY', price: 1779.9, config: cfg, preOrderPosition: 19.5 * P, prevFilledQty: 0, thisFillQty: 2.5 * P });
    expect(r.avgGridPrice).toBeCloseTo(1788, 4);
    expect(r.savings).toBeCloseTo((1788 - 1779.9) * 2.5 * P, 6);
  });
  it('部分买入 2.0 远线优先 → avg 1790', () => {
    const r = computeFillSavings({ side: 'BUY', price: 1779.9, config: cfg, preOrderPosition: 19.5 * P, prevFilledQty: 0, thisFillQty: 2.0 * P });
    expect(r.avgGridPrice).toBeCloseTo(1790, 4);
    expect(r.savings).toBeCloseTo((1790 - 1779.9) * 2.0 * P, 6);
  });
});

describe('computeFillSavings - 进场建仓 / 关闭平仓不计超额收益', () => {
  // 进入箱体的市价建仓（从 0 仓位 BUY 到目标）：传统网格也会同样建仓，非网格往返超额收益 → 记 0。
  it('进场建仓 isEntry=true → savings/avgGridPrice 全 0', () => {
    const base = { side: 'BUY' as const, price: 1850, config: cfg, preOrderPosition: 0, prevFilledQty: 0, thisFillQty: 20 * P };
    // 不带标记时本会算出非零 savings（说明此前被错误计入）
    const without = computeFillSavings(base);
    expect(Math.abs(without.savings)).toBeGreaterThan(0);
    // 带 isEntry 标记 → 全 0
    const entry = computeFillSavings({ ...base, isEntry: true });
    expect(entry.savings).toBe(0);
    expect(entry.savingsRate).toBe(0);
    expect(entry.avgGridPrice).toBe(0);
  });

  // 关闭机器人时的平仓（CLOSE，从满仓 SELL 回 0）：非网格往返 → 记 0。
  it('关闭平仓 orderType=CLOSE → savings/avgGridPrice 全 0', () => {
    const base = { side: 'SELL' as const, price: 1900, config: cfg, preOrderPosition: 20 * P, prevFilledQty: 0, thisFillQty: 20 * P };
    const without = computeFillSavings(base);
    expect(Math.abs(without.savings)).toBeGreaterThan(0);
    const close = computeFillSavings({ ...base, orderType: 'CLOSE' });
    expect(close.savings).toBe(0);
    expect(close.savingsRate).toBe(0);
    expect(close.avgGridPrice).toBe(0);
  });

  // 普通网格单（GRID_SELL，非进场）不受影响，仍按原口径计算。
  it('普通网格单 orderType=GRID_SELL 不受影响', () => {
    const r = computeFillSavings({ side: 'SELL', price: 1820, config: cfg, preOrderPosition: 19 * P, prevFilledQty: 0, thisFillQty: 1 * P, orderType: 'GRID_SELL', isEntry: false });
    expect(r.avgGridPrice).toBeCloseTo(1820, 4);
    expect(r.savings).toBeCloseTo(0, 6);
  });
});

const cfgShort: TargetPositionConfig = { ...cfg, direction: 'SHORT' };

describe('computeFillSavings - SHORT (镜像)', () => {
  // SHORT 卖出=加空（add）。price 2030.1: grids=3, targetBought=3*P；posMag=0.5*P
  // 线 gridIndexToBuyPrice(SHORT,3,2,1)=2030,2020,2010；计划{2030:1,2020:1,2010:0.5} → avg 2022
  it('SHORT 卖出加空 gap=2.5 → avg 2022', () => {
    const r = computeFillSavings({ side: 'SELL', price: 2030.1, config: cfgShort, preOrderPosition: -0.5 * P, prevFilledQty: 0, thisFillQty: 2.5 * P });
    expect(r.avgGridPrice).toBeCloseTo(2022, 4);
    expect(r.savings).toBeCloseTo((2030.1 - 2022) * 2.5 * P, 6);
  });

  it('SHORT 卖出部分 2.0 远线优先 → avg 2020', () => {
    const r = computeFillSavings({ side: 'SELL', price: 2030.1, config: cfgShort, preOrderPosition: -0.5 * P, prevFilledQty: 0, thisFillQty: 2.0 * P });
    // 远线优先 2010:0.5,2020:1,2030:0.5 → avg 2020
    expect(r.avgGridPrice).toBeCloseTo(2020, 4);
    expect(r.savings).toBeCloseTo((2030.1 - 2020) * 2.0 * P, 6);
  });

  // SHORT 买入=平空（reduce/cover）。price 2010.1: grids=1, targetHold=2*P；posMag=4.5*P
  // 线 gridIndexToSellPrice(SHORT,1,2,3)=2020,2030,2040；计划{2020:1,2030:1,2040:0.5} → avg 2028
  it('SHORT 买入平空 gap=2.5 → avg 2028，savings=(avg−price)×量', () => {
    const r = computeFillSavings({ side: 'BUY', price: 2010.1, config: cfgShort, preOrderPosition: -4.5 * P, prevFilledQty: 0, thisFillQty: 2.5 * P });
    expect(r.avgGridPrice).toBeCloseTo(2028, 4);
    expect(r.savings).toBeCloseTo((2028 - 2010.1) * 2.5 * P, 6);
  });
});
