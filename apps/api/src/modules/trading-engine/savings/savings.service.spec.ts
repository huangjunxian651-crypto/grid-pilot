import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SavingsService } from './savings.service';

const mockPrisma = {
  box: { findUnique: vi.fn(), findMany: vi.fn() },
  run: { findUnique: vi.fn(), findMany: vi.fn() },
  fill: { findMany: vi.fn() },
};

const fillRow = (over: Partial<any> = {}) => ({
  id: 'f1', runId: 'run1', side: 'BUY', qty: 0.01, price: 1950,
  gridIndex: 5, savings: 0.5, savingsRate: 0.02, realizedPnlDelta: 0,
  filledAt: new Date('2024-01-01'),
  ...over,
});

describe('SavingsService (authoritative reads)', () => {
  let service: SavingsService;
  beforeEach(() => {
    vi.clearAllMocks();
    service = new SavingsService(mockPrisma as any);
  });

  describe('getRealizedPnlByConfig', () => {
    it('reads Run aggregates (sum across runs), never EventLog', async () => {
      mockPrisma.box.findUnique.mockResolvedValue({
        id: 'b1',
        runs: [{ realizedPnl: 42, fillCount: 3, totalSavings: 1 }],
      });
      const r = await service.getRealizedPnlByConfig('b1');
      expect(r).toEqual({ realizedPnl: 42, fillCount: 3 });
      expect((mockPrisma as any).eventLog).toBeUndefined();
    });

    it('sums realizedPnl/fillCount across multiple runs', async () => {
      mockPrisma.box.findUnique.mockResolvedValue({
        id: 'b1',
        runs: [
          { realizedPnl: 10, fillCount: 2, totalSavings: 0 },
          { realizedPnl: 5, fillCount: 1, totalSavings: 0 },
        ],
      });
      const r = await service.getRealizedPnlByConfig('b1');
      expect(r.realizedPnl).toBeCloseTo(15, 6);
      expect(r.fillCount).toBe(3);
    });

    it('throws when box not found', async () => {
      mockPrisma.box.findUnique.mockResolvedValue(null);
      await expect(service.getRealizedPnlByConfig('nope')).rejects.toThrow();
    });
  });

  describe('getSavingsSummary', () => {
    it('reads frozen Fill rows + Run aggregate totalSavings; newest first', async () => {
      mockPrisma.box.findUnique.mockResolvedValue({
        id: 'b1',
        runs: [{ id: 'run1', totalSavings: 1.3, fillCount: 2 }],
      });
      mockPrisma.fill.findMany.mockResolvedValue([
        fillRow({ id: 'f2', price: 1890, side: 'BUY', savings: 0.8, filledAt: new Date('2024-01-02') }),
        fillRow({ id: 'f1', price: 1950, side: 'BUY', savings: 0.5, filledAt: new Date('2024-01-01') }),
      ]);
      const r = await service.getSavingsSummary('b1', 100);
      expect(r.totalSavings).toBeCloseTo(1.3, 6); // from Run aggregate
      expect(r.fillCount).toBe(2);
      expect(r.buyCount).toBe(2);
      expect(r.sellCount).toBe(0);
      expect(r.fills).toHaveLength(2);
      expect(r.fills[0].fillPrice).toBe(1890); // newest first (query order preserved)
      // queried the run's fills
      expect(mockPrisma.fill.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ runId: { in: ['run1'] } }) }),
      );
    });

    it('throws when box not found', async () => {
      mockPrisma.box.findUnique.mockResolvedValue(null);
      await expect(service.getSavingsSummary('nope', 100)).rejects.toThrow();
    });

    it('empty when box has no runs', async () => {
      mockPrisma.box.findUnique.mockResolvedValue({ id: 'b1', runs: [] });
      const r = await service.getSavingsSummary('b1', 100);
      expect(r.fillCount).toBe(0);
      expect(r.fills).toHaveLength(0);
      expect(r.totalSavings).toBe(0);
    });
  });

  describe('getSavingsSummaryBySession', () => {
    it('reads the run aggregate + its frozen fills', async () => {
      mockPrisma.run.findUnique.mockResolvedValue({ id: 'run1', runCode: 'RC1', totalSavings: 0.5, fillCount: 1 });
      mockPrisma.fill.findMany.mockResolvedValue([fillRow({ side: 'SELL', savings: 0.5 })]);
      const r = await service.getSavingsSummaryBySession('RC1', 100);
      expect(r.totalSavings).toBeCloseTo(0.5, 6);
      expect(r.sellCount).toBe(1);
      expect(r.fills).toHaveLength(1);
      expect(mockPrisma.fill.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ runId: 'run1' }) }),
      );
    });

    it('throws when run not found', async () => {
      mockPrisma.run.findUnique.mockResolvedValue(null);
      await expect(service.getSavingsSummaryBySession('nope', 100)).rejects.toThrow();
    });
  });

  describe('getRobotSummaryMetrics（轻量两指标）', () => {
    it('alphaTotal = sum(run.totalSavings)，无需扫成交', async () => {
      mockPrisma.run.findMany.mockResolvedValue([
        { id: 'r1', totalSavings: 1.5 },
        { id: 'r2', totalSavings: 2.0 },
      ]);
      mockPrisma.fill.findMany.mockResolvedValue([]);
      const now = new Date('2026-06-16T12:00:00Z');
      const r = await service.getRobotSummaryMetrics('robot-1', now);
      expect(r.alphaTotal).toBeCloseTo(3.5, 6);
      expect(mockPrisma.run.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { box: { robotId: 'robot-1' } } }),
      );
    });

    it('todayRealizedPnl = 今日窗口成交 realizedPnlDelta 之和（带 filledAt gte 过滤）', async () => {
      mockPrisma.run.findMany.mockResolvedValue([{ id: 'r1', totalSavings: 0 }]);
      mockPrisma.fill.findMany.mockResolvedValue([
        { realizedPnlDelta: 4 }, { realizedPnlDelta: -1.5 },
      ]);
      const now = new Date('2026-06-16T12:00:00Z');
      const r = await service.getRobotSummaryMetrics('robot-1', now);
      expect(r.todayRealizedPnl).toBeCloseTo(2.5, 6);
      const call = mockPrisma.fill.findMany.mock.calls.at(-1)[0];
      expect(call.where.runId).toEqual({ in: ['r1'] });
      expect(call.where.filledAt.gte).toBeInstanceOf(Date);
      // gte 应为当日零点（本地时区）
      const gte = call.where.filledAt.gte as Date;
      expect(gte.getHours()).toBe(0);
      expect(gte.getMinutes()).toBe(0);
    });

    it('无 run 时返回 0/0', async () => {
      mockPrisma.run.findMany.mockResolvedValue([]);
      const r = await service.getRobotSummaryMetrics('robot-x', new Date('2026-06-16T12:00:00Z'));
      expect(r).toEqual({ todayRealizedPnl: 0, alphaTotal: 0 });
      expect(mockPrisma.fill.findMany).not.toHaveBeenCalled();
    });
  });
});
