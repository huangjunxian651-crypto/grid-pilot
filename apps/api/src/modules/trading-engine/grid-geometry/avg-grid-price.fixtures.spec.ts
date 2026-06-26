import { describe, it, expect } from 'vitest';
import { computeFillSavings } from './avg-grid-price';
import type { BoxTargetConfig } from '@gridpilot/shared-types';

// 复现并锁定真实线上成交的「平均网格价」口径（按持仓区间归属，与成交价无关）。
// 取自实际出问题的运行：LONG ETH, tp=2000, step=5, portion=0.05。
// 历史 bug：追价成交落在网格线上方一丝、且下单前持仓恰等于该价目标时，旧实现返回 0 → 前端「—」。
const cfg: BoxTargetConfig = {
  takeProfitPrice: 2000, mainGridCount: 78, mainGridStep: 5, mainGridPortionSize: 0.05,
  stopLossGridCount: 4, stopLossGridStep: 2, isolationStep: 2, direction: 'LONG',
};

// 每条来自真实成交（值经用户确认为正确口径）。
const cases = [
  { name: '边界追价买单（旧实现误为 0）→ 终点格线 1750', side: 'BUY' as const, prepos: 2.45, prev: 0, qty: 0.05, expect: 1750 },
  { name: '多份买入 prepos2.35 跨 48/49 格 → 1757.5', side: 'BUY' as const, prepos: 2.35, prev: 0, qty: 0.10, expect: 1757.5 },
  { name: '多份买入 prepos2.45 跨 50/51 格 → 1747.5', side: 'BUY' as const, prepos: 2.45, prev: 0, qty: 0.10, expect: 1747.5 },
  { name: '多份卖出 prepos2.55 跨 50/49 格 → 1752.5', side: 'SELL' as const, prepos: 2.55, prev: 0, qty: 0.10, expect: 1752.5 },
  { name: '多份卖出 prepos2.20 跨 43/42 格 → 1787.5', side: 'SELL' as const, prepos: 2.20, prev: 0, qty: 0.10, expect: 1787.5 },
  { name: '大额买入 prepos0 跨 45 格 → 加权 1885', side: 'BUY' as const, prepos: 0, prev: 0, qty: 2.25, expect: 1885 },
];

describe('computeFillSavings: 真实成交平均网格价口径', () => {
  for (const c of cases) {
    it(c.name, () => {
      // 成交价取格内任意值都不应改变 avgGridPrice（口径与成交价无关）。
      const r = computeFillSavings({ side: c.side, price: 1750.37, config: cfg, preOrderPosition: c.prepos, prevFilledQty: c.prev, thisFillQty: c.qty });
      expect(r.avgGridPrice).toBeCloseTo(c.expect, 4);
    });
  }

  it('avgGridPrice 不随成交价在格内漂移（边界买单：1749.99 / 1750.00 / 1750.37 同为 1750）', () => {
    for (const price of [1749.99, 1750.0, 1750.37, 1750.99]) {
      const r = computeFillSavings({ side: 'BUY', price, config: cfg, preOrderPosition: 2.45, prevFilledQty: 0, thisFillQty: 0.05 });
      expect(r.avgGridPrice, `price=${price}`).toBeCloseTo(1750, 4);
    }
  });
});
