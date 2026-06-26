import { applyFillToPnlState, type PnlState } from './compute-pnl-delta';
import { computeRealizedPnl, type FillLite } from '../savings/compute-realized-pnl';

describe('applyFillToPnlState', () => {
  it('开多后平多结算正确 delta', () => {
    let s: PnlState = { signedPosition: 0, avgCost: 0 };
    const r1 = applyFillToPnlState(s, { side: 'BUY', qty: 2, price: 100 });
    expect(r1.delta).toBe(0);
    s = r1.state;
    const r2 = applyFillToPnlState(s, { side: 'SELL', qty: 2, price: 110 });
    expect(r2.delta).toBeCloseTo(20, 8); // (110-100)*2
  });

  it('逐笔累加 delta == computeRealizedPnl 整批结果', () => {
    const fills: FillLite[] = [
      { side: 'BUY', fillQty: 1, fillPrice: 100, ts: 1 },
      { side: 'BUY', fillQty: 1, fillPrice: 120, ts: 2 },
      { side: 'SELL', fillQty: 1, fillPrice: 130, ts: 3 },
      { side: 'SELL', fillQty: 1, fillPrice: 90, ts: 4 },
    ];
    let s: PnlState = { signedPosition: 0, avgCost: 0 };
    let sum = 0;
    for (const f of fills) {
      const r = applyFillToPnlState(s, { side: f.side, qty: f.fillQty, price: f.fillPrice });
      sum += r.delta;
      s = r.state;
    }
    expect(sum).toBeCloseTo(computeRealizedPnl(fills), 8);
  });

  it('SHORT 开仓后平仓结算正确', () => {
    let s: PnlState = { signedPosition: 0, avgCost: 0 };
    s = applyFillToPnlState(s, { side: 'SELL', qty: 3, price: 200 }).state;
    const r = applyFillToPnlState(s, { side: 'BUY', qty: 3, price: 180 });
    expect(r.delta).toBeCloseTo(60, 8); // short profit (200-180)*3
  });
});
