import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FillReconcileService, RECONCILE_ROLLBACK_MS } from './fill-reconcile.service';

describe('FillReconcileService', () => {
  let prisma: any; let ingestion: any; let svc: FillReconcileService;
  beforeEach(() => {
    prisma = { fill: { findFirst: vi.fn() }, run: { findUnique: vi.fn() } };
    ingestion = { ingest: vi.fn().mockResolvedValue(undefined) };
    svc = new FillReconcileService(prisma, ingestion);
  });

  it('以「最后一笔 Fill 时间 − 回滚窗口」为起点拉 getMyTrades（不足则钳到 0），并逐笔 ingest', async () => {
    prisma.run.findUnique.mockResolvedValue({ id: 'run1', runCode: 'RC1', startedAt: new Date(5_000) });
    prisma.fill.findFirst.mockResolvedValue({ filledAt: new Date(10_000) });
    const adapter = { getMyTrades: vi.fn().mockResolvedValue([
      { orderId: 'o1', fillId: 't1', qty: 0.01, price: 2000, timestamp: 11_000, clientOrderId: 'c1', side: 'BUY' },
      { orderId: 'o1', fillId: 't2', qty: 0.02, price: 2001, timestamp: 11_500, clientOrderId: 'c1', side: 'BUY' },
    ]) };

    await svc.reconcileRun('RC1', 'ETH/USDT', adapter as any);

    // 10_000 − ROLLBACK < 0 → 钳到 0
    expect(adapter.getMyTrades).toHaveBeenCalledWith('ETH/USDT', 0);
    expect(ingestion.ingest).toHaveBeenCalledTimes(2);
    expect(ingestion.ingest).toHaveBeenCalledWith('RC1', expect.objectContaining({ fillId: 't1' }));
  });

  it('I-1: 回滚窗口让「曾因 order-before-fill 被跳过、且早于最后成交」的成交可被重拉回', async () => {
    prisma.run.findUnique.mockResolvedValue({ id: 'run1', runCode: 'RC1', startedAt: new Date(500_000) });
    // 最后已落库成交在 T=1_000_000；更早一笔 fillId='skip'(ts=900_000) 曾被跳过。
    // 若起点取 T（旧实现），getMyTrades(T) 会排除 900_000 → 永久丢失。
    prisma.fill.findFirst.mockResolvedValue({ filledAt: new Date(1_000_000) });
    const adapter = { getMyTrades: vi.fn().mockResolvedValue([
      { orderId: 'o1', fillId: 'skip', qty: 1, price: 100, timestamp: 900_000, clientOrderId: 'c1', side: 'BUY' },
    ]) };

    await svc.reconcileRun('RC1', 'ETH/USDT', adapter as any);

    // 起点回滚 ROLLBACK（>sweep 间隔）→ 900_000 落入拉取窗口，被重摄入
    expect(adapter.getMyTrades).toHaveBeenCalledWith('ETH/USDT', 1_000_000 - RECONCILE_ROLLBACK_MS);
    expect(ingestion.ingest).toHaveBeenCalledWith('RC1', expect.objectContaining({ fillId: 'skip' }));
  });

  it('run 无自有成交时以 startedAt−ROLLBACK 为起点（不再从 0 拉全账户历史，避免外来成交刷屏 WARN）', async () => {
    // lastMs=0 时旧实现退化为 getMyTrades(symbol, 0)，OKX 返回账户级最近成交
    // （含旧 run/legacy/手动单），逐笔 ingest 匹配不上而 WARN 刷屏。本 run 的
    // 自有成交不可能早于 startedAt，故起点钉在 startedAt−ROLLBACK。
    const startedAt = new Date(2_000_000);
    prisma.run.findUnique.mockResolvedValue({ id: 'run1', runCode: 'RC1', startedAt });
    prisma.fill.findFirst.mockResolvedValue(null);
    const adapter = { getMyTrades: vi.fn().mockResolvedValue([]) };
    await svc.reconcileRun('RC1', 'ETH/USDT', adapter as any);
    expect(adapter.getMyTrades).toHaveBeenCalledWith('ETH/USDT', 2_000_000 - RECONCILE_ROLLBACK_MS);
  });

  it('run 不存在 → 直接返回，不拉取', async () => {
    prisma.run.findUnique.mockResolvedValue(null);
    const adapter = { getMyTrades: vi.fn() };
    await svc.reconcileRun('NOPE', 'ETH/USDT', adapter as any);
    expect(adapter.getMyTrades).not.toHaveBeenCalled();
  });

  it('getMyTrades 抛错 → 吞掉不抛（对账尽力而为）', async () => {
    prisma.run.findUnique.mockResolvedValue({ id: 'run1', runCode: 'RC1', startedAt: new Date(2_000_000) });
    prisma.fill.findFirst.mockResolvedValue(null);
    const adapter = { getMyTrades: vi.fn().mockRejectedValue(new Error('rest down')) };
    await expect(svc.reconcileRun('RC1', 'ETH/USDT', adapter as any)).resolves.toBeUndefined();
  });

  it('单笔 ingest 抛错不影响其余（逐笔 try/catch）', async () => {
    prisma.run.findUnique.mockResolvedValue({ id: 'run1', runCode: 'RC1', startedAt: new Date(2_000_000) });
    prisma.fill.findFirst.mockResolvedValue(null);
    const adapter = { getMyTrades: vi.fn().mockResolvedValue([
      { orderId: 'o1', fillId: 't1', qty: 1, price: 2000, timestamp: 1 },
      { orderId: 'o1', fillId: 't2', qty: 1, price: 2000, timestamp: 2 },
    ]) };
    ingestion.ingest.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(undefined);
    await expect(svc.reconcileRun('RC1', 'ETH/USDT', adapter as any)).resolves.toBeUndefined();
    expect(ingestion.ingest).toHaveBeenCalledTimes(2);
  });
});
