import { describe, it, expect, vi } from 'vitest';
import { aggregateRunLedger, PnlLedgerService } from './pnl-ledger.service';

describe('aggregateRunLedger', () => {
  it('net = realized − fees − funding；savings 单列不并入 net', () => {
    const t = aggregateRunLedger([
      { realizedPnl: 10, totalFees: 2, totalSavings: 1, totalFunding: 1 },
      { realizedPnl: 5, totalFees: 1, totalSavings: 0.5, totalFunding: 0.5 },
    ]);
    expect(t).toEqual({ realized: 15, fees: 3, funding: 1.5, savings: 1.5, net: 10.5 });
  });
  it('空集合 → 全 0', () => {
    expect(aggregateRunLedger([])).toEqual({ realized: 0, fees: 0, funding: 0, savings: 0, net: 0 });
  });
  it('totalFunding 缺失时视为 0（向后兼容）', () => {
    const t = aggregateRunLedger([
      { realizedPnl: 10, totalFees: 2, totalSavings: 1, totalFunding: 0 },
    ]);
    expect(t).toEqual({ realized: 10, fees: 2, funding: 0, savings: 1, net: 8 });
  });
});

describe('PnlLedgerService.getBoxesLedger', () => {
  it('boxIds 为空 → 空 Map（不查库）', async () => {
    const prisma = { run: { findMany: vi.fn() } };
    const svc = new PnlLedgerService(prisma as any);
    const out = await svc.getBoxesLedger([]);
    expect(out.size).toBe(0);
    expect(prisma.run.findMany).not.toHaveBeenCalled();
  });

  it('按 boxId 分组汇总，funding 累加，且无 run 的 box 也返回全 0 entry', async () => {
    const prisma = { run: { findMany: vi.fn().mockResolvedValue([
      { boxId: 'box-a', realizedPnl: 10, totalFees: 2, totalSavings: 1, totalFunding: 1 },
      { boxId: 'box-a', realizedPnl: 5, totalFees: 1, totalSavings: 0.5, totalFunding: 0.5 },
    ]) } };
    const svc = new PnlLedgerService(prisma as any);
    const out = await svc.getBoxesLedger(['box-a', 'box-empty']);
    expect(prisma.run.findMany).toHaveBeenCalledWith({ where: { boxId: { in: ['box-a', 'box-empty'] } }, select: { boxId: true, realizedPnl: true, totalFees: true, totalSavings: true, totalFunding: true } });
    expect(out.get('box-a')).toEqual({ realized: 15, fees: 3, funding: 1.5, savings: 1.5, net: 10.5 });
    expect(out.get('box-empty')).toEqual({ realized: 0, fees: 0, funding: 0, savings: 0, net: 0 });
  });
});
