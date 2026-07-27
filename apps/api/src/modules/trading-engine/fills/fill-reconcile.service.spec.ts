import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FillReconcileService, RECONCILE_ROLLBACK_MS } from './fill-reconcile.service';

describe('FillReconcileService', () => {
  let prisma: any; let ingestion: any; let notificationService: any; let svc: FillReconcileService;
  beforeEach(() => {
    prisma = { fill: { findFirst: vi.fn() }, run: { findUnique: vi.fn() } };
    ingestion = { ingest: vi.fn().mockResolvedValue(true) };
    notificationService = { createAndBroadcast: vi.fn().mockResolvedValue({}) };
    svc = new FillReconcileService(prisma, ingestion, notificationService);
  });

  it('以「最后一笔 Fill 时间 − 回滚窗口」为起点拉 getMyTrades（不足则钳到 0），并逐笔 ingest，返回新增成交数', async () => {
    prisma.run.findUnique.mockResolvedValue({ id: 'run1', runCode: 'RC1', startedAt: new Date(5_000) });
    prisma.fill.findFirst.mockResolvedValue({ filledAt: new Date(10_000) });
    const adapter = { getMyTrades: vi.fn().mockResolvedValue([
      { orderId: 'o1', fillId: 't1', qty: 0.01, price: 2000, timestamp: 11_000, clientOrderId: 'c1', side: 'BUY' },
      { orderId: 'o1', fillId: 't2', qty: 0.02, price: 2001, timestamp: 11_500, clientOrderId: 'c1', side: 'BUY' },
    ]) };

    const result = await svc.reconcileRun('RC1', 'ETH/USDT', adapter as any);

    expect(adapter.getMyTrades).toHaveBeenCalledWith('ETH/USDT', 0);
    expect(ingestion.ingest).toHaveBeenCalledTimes(2);
    expect(ingestion.ingest).toHaveBeenCalledWith('RC1', expect.objectContaining({ fillId: 't1' }));
    expect(result).toEqual({ newFillsCount: 2 });
  });

  it('ingest 返回 false（已存在/跳过）的不计入 newFillsCount', async () => {
    prisma.run.findUnique.mockResolvedValue({ id: 'run1', runCode: 'RC1', startedAt: new Date(2_000_000) });
    prisma.fill.findFirst.mockResolvedValue(null);
    const adapter = { getMyTrades: vi.fn().mockResolvedValue([
      { orderId: 'o1', fillId: 't1', qty: 1, price: 100, timestamp: 1 },
      { orderId: 'o1', fillId: 't2', qty: 1, price: 100, timestamp: 2 },
    ]) };
    ingestion.ingest.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    const result = await svc.reconcileRun('RC1', 'ETH/USDT', adapter as any);
    expect(result).toEqual({ newFillsCount: 1 });
  });

  it('I-1: 回滚窗口让「曾因 order-before-fill 被跳过、且早于最后成交」的成交可被重拉回', async () => {
    prisma.run.findUnique.mockResolvedValue({ id: 'run1', runCode: 'RC1', startedAt: new Date(500_000) });
    prisma.fill.findFirst.mockResolvedValue({ filledAt: new Date(1_000_000) });
    const adapter = { getMyTrades: vi.fn().mockResolvedValue([
      { orderId: 'o1', fillId: 'skip', qty: 1, price: 100, timestamp: 900_000, clientOrderId: 'c1', side: 'BUY' },
    ]) };

    await svc.reconcileRun('RC1', 'ETH/USDT', adapter as any);

    expect(adapter.getMyTrades).toHaveBeenCalledWith('ETH/USDT', 1_000_000 - RECONCILE_ROLLBACK_MS);
    expect(ingestion.ingest).toHaveBeenCalledWith('RC1', expect.objectContaining({ fillId: 'skip' }));
  });

  it('run 无自有成交时以 startedAt−ROLLBACK 为起点（不再从 0 拉全账户历史，避免外来成交刷屏 WARN）', async () => {
    const startedAt = new Date(2_000_000);
    prisma.run.findUnique.mockResolvedValue({ id: 'run1', runCode: 'RC1', startedAt });
    prisma.fill.findFirst.mockResolvedValue(null);
    const adapter = { getMyTrades: vi.fn().mockResolvedValue([]) };
    await svc.reconcileRun('RC1', 'ETH/USDT', adapter as any);
    expect(adapter.getMyTrades).toHaveBeenCalledWith('ETH/USDT', 2_000_000 - RECONCILE_ROLLBACK_MS);
  });

  it('run 不存在 → 直接返回 { newFillsCount: 0 }，不拉取，不计入失败次数', async () => {
    prisma.run.findUnique.mockResolvedValue(null);
    const adapter = { getMyTrades: vi.fn() };
    const result = await svc.reconcileRun('NOPE', 'ETH/USDT', adapter as any);
    expect(adapter.getMyTrades).not.toHaveBeenCalled();
    expect(result).toEqual({ newFillsCount: 0 });
  });

  it('getMyTrades 抛错 → 吞掉不抛，返回 { newFillsCount: 0 }（对账尽力而为）', async () => {
    prisma.run.findUnique.mockResolvedValue({ id: 'run1', runCode: 'RC1', startedAt: new Date(2_000_000) });
    prisma.fill.findFirst.mockResolvedValue(null);
    const adapter = { getMyTrades: vi.fn().mockRejectedValue(new Error('rest down')) };
    await expect(svc.reconcileRun('RC1', 'ETH/USDT', adapter as any)).resolves.toEqual({ newFillsCount: 0 });
  });

  it('单笔 ingest 抛错不影响其余（逐笔 try/catch），成功的那笔计入 newFillsCount', async () => {
    prisma.run.findUnique.mockResolvedValue({ id: 'run1', runCode: 'RC1', startedAt: new Date(2_000_000) });
    prisma.fill.findFirst.mockResolvedValue(null);
    const adapter = { getMyTrades: vi.fn().mockResolvedValue([
      { orderId: 'o1', fillId: 't1', qty: 1, price: 2000, timestamp: 1 },
      { orderId: 'o1', fillId: 't2', qty: 1, price: 2000, timestamp: 2 },
    ]) };
    ingestion.ingest.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(true);
    const result = await svc.reconcileRun('RC1', 'ETH/USDT', adapter as any);
    expect(ingestion.ingest).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ newFillsCount: 1 });
  });

  it('连续失败 5 次触发一次告警，未到 5 次不触发', async () => {
    prisma.run.findUnique.mockResolvedValue({ id: 'run1', runCode: 'RC1', startedAt: new Date(2_000_000) });
    prisma.fill.findFirst.mockResolvedValue(null);
    const adapter = { getMyTrades: vi.fn().mockRejectedValue(new Error('rest down')) };
    for (let i = 0; i < 4; i++) {
      await svc.reconcileRun('RC1', 'ETH/USDT', adapter as any);
    }
    expect(notificationService.createAndBroadcast).not.toHaveBeenCalled();
    await svc.reconcileRun('RC1', 'ETH/USDT', adapter as any);
    expect(notificationService.createAndBroadcast).toHaveBeenCalledTimes(1);
    expect(notificationService.createAndBroadcast).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'RECONCILE_REPEATED_FAILURE', type: 'alert' }),
    );
  });

  it('达到 5 次告警后继续失败不重复告警；成功一次清零计数，之后再连续失败 5 次会重新告警', async () => {
    prisma.run.findUnique.mockResolvedValue({ id: 'run1', runCode: 'RC1', startedAt: new Date(2_000_000) });
    prisma.fill.findFirst.mockResolvedValue(null);
    const failing = { getMyTrades: vi.fn().mockRejectedValue(new Error('rest down')) };
    const succeeding = { getMyTrades: vi.fn().mockResolvedValue([]) };
    for (let i = 0; i < 6; i++) {
      await svc.reconcileRun('RC1', 'ETH/USDT', failing as any);
    }
    expect(notificationService.createAndBroadcast).toHaveBeenCalledTimes(1);

    await svc.reconcileRun('RC1', 'ETH/USDT', succeeding as any);
    for (let i = 0; i < 5; i++) {
      await svc.reconcileRun('RC1', 'ETH/USDT', failing as any);
    }
    expect(notificationService.createAndBroadcast).toHaveBeenCalledTimes(2);
  });

  it('第 5 次告警发送失败（notificationService.createAndBroadcast reject）不影响 reconcileRun 正常返回，且回滚已告警标记以便下次失败重新尝试告警', async () => {
    prisma.run.findUnique.mockResolvedValue({ id: 'run1', runCode: 'RC1', startedAt: new Date(2_000_000) });
    prisma.fill.findFirst.mockResolvedValue(null);
    const adapter = { getMyTrades: vi.fn().mockRejectedValue(new Error('rest down')) };
    notificationService.createAndBroadcast.mockRejectedValueOnce(new Error('notify failed'));

    for (let i = 0; i < 4; i++) {
      await svc.reconcileRun('RC1', 'ETH/USDT', adapter as any);
    }
    await expect(svc.reconcileRun('RC1', 'ETH/USDT', adapter as any)).resolves.toEqual({ newFillsCount: 0 });
    expect(notificationService.createAndBroadcast).toHaveBeenCalledTimes(1);

    await svc.reconcileRun('RC1', 'ETH/USDT', adapter as any);
    expect(notificationService.createAndBroadcast).toHaveBeenCalledTimes(2);
  });
});
