import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RunBalanceSnapshotService } from './run-balance-snapshot.service';

function makeMock() {
  return { runBalanceSnapshot: { upsert: vi.fn().mockResolvedValue({}) } };
}

function makeAdapter(over: Record<string, unknown> = {}) {
  return {
    getBalance: vi.fn().mockResolvedValue({ asset: 'USDT', free: 100, locked: 20, totalWalletBalance: 120, totalUnrealizedProfit: 5 }),
    getPosition: vi.fn().mockResolvedValue({ symbol: 'ETH/USDT', baseAssetQty: 0.5, quoteAssetQty: -1000, entryPrice: 2000, leverage: 10, unrealizedPnl: 5, marginType: 'CROSS' }),
    getTicker: vi.fn().mockResolvedValue({ symbol: 'ETH/USDT', bid: 2009, ask: 2011, last: 2010, timestamp: 1 }),
    ...over,
  } as any;
}

const base = {
  runId: 'run1', symbol: 'ETH/USDT', credentialId: 'acct1', boxId: 'box1', robotId: 'robot1',
  ledger: { realizedPnl: 3, totalFees: 1, totalSavings: 2 },
};

/** upsert 调用的写入数据（create 含 runId/event + 全字段）。 */
function writtenData(prisma: ReturnType<typeof makeMock>) {
  return prisma.runBalanceSnapshot.upsert.mock.calls[0][0].create;
}

describe('RunBalanceSnapshotService.capture', () => {
  let prisma: ReturnType<typeof makeMock>;
  let svc: RunBalanceSnapshotService;
  beforeEach(() => { prisma = makeMock(); svc = new RunBalanceSnapshotService(prisma as any); });

  it('START：余额/持仓/价格映射正确并 upsert 一行', async () => {
    const adapter = makeAdapter();
    await svc.capture({ ...base, event: 'START', adapter });
    expect(prisma.runBalanceSnapshot.upsert).toHaveBeenCalledTimes(1);
    // 幂等键 (runId, event)
    expect(prisma.runBalanceSnapshot.upsert.mock.calls[0][0].where).toEqual({ runId_event: { runId: 'run1', event: 'START' } });
    expect(writtenData(prisma)).toMatchObject({
      runId: 'run1', event: 'START', symbol: 'ETH/USDT',
      totalWalletBalance: 120, totalEquity: 125, availableUsdt: 100, marginUsed: 20,
      positionQty: 0.5, entryPrice: 2000, unrealizedPnl: 5, markPrice: 2010,
      realizedPnl: 3, totalFees: 1, totalSavings: 2,
      credentialId: 'acct1', boxId: 'box1', robotId: 'robot1',
    });
  });

  it('价格优先用 lastTickerPrice（省一次 getTicker）', async () => {
    const adapter = makeAdapter();
    await svc.capture({ ...base, event: 'START', adapter, lastTickerPrice: 1999 });
    expect(writtenData(prisma).markPrice).toBe(1999);
    expect(adapter.getTicker).not.toHaveBeenCalled();
  });

  it('getTicker 失败时回退到持仓 entryPrice', async () => {
    const adapter = makeAdapter({ getTicker: vi.fn().mockRejectedValue(new Error('no ticker')) });
    await svc.capture({ ...base, event: 'START', adapter });
    expect(writtenData(prisma).markPrice).toBe(2000);
  });

  it('持仓为空（getPosition=null）时 positionQty=0、entryPrice=null', async () => {
    const adapter = makeAdapter({ getPosition: vi.fn().mockResolvedValue(null) });
    await svc.capture({ ...base, event: 'STOP', adapter, lastTickerPrice: 2010, exitReason: 'TAKE_PROFIT', liquidationOk: true });
    const d = writtenData(prisma);
    expect(d.positionQty).toBe(0);
    expect(d.unrealizedPnl).toBe(0);
    expect(d.entryPrice).toBeNull();
  });

  it('无仓但 adapter 返回 {qty:0,entryPrice:0} 时按空仓处理（entryPrice=null，不误记 0 实仓）', async () => {
    const adapter = makeAdapter({ getPosition: vi.fn().mockResolvedValue({ symbol: 'ETH/USDT', baseAssetQty: 0, quoteAssetQty: 0, entryPrice: 0, leverage: 1, unrealizedPnl: 0, marginType: 'CROSS' }) });
    await svc.capture({ ...base, event: 'STOP', adapter, lastTickerPrice: 2010 });
    const d = writtenData(prisma);
    expect(d.positionQty).toBe(0);
    expect(d.entryPrice).toBeNull();
  });

  it('STOP 行带 exitReason/liquidationOk', async () => {
    const adapter = makeAdapter();
    await svc.capture({ ...base, event: 'STOP', adapter, exitReason: 'USER_CLOSE', liquidationOk: true });
    expect(writtenData(prisma)).toMatchObject({ event: 'STOP', exitReason: 'USER_CLOSE', liquidationOk: true });
  });

  it('best-effort：getBalance 抛错时不抛、不写库（仅告警）', async () => {
    const adapter = makeAdapter({ getBalance: vi.fn().mockRejectedValue(new Error('exchange 5xx')) });
    await expect(svc.capture({ ...base, event: 'START', adapter })).resolves.toBeUndefined();
    expect(prisma.runBalanceSnapshot.upsert).not.toHaveBeenCalled();
  });

  it('best-effort：落库抛错也不外抛（含 P2002 并发去重场景）', async () => {
    const adapter = makeAdapter();
    prisma.runBalanceSnapshot.upsert.mockRejectedValueOnce(Object.assign(new Error('unique'), { code: 'P2002' }));
    await expect(svc.capture({ ...base, event: 'STOP', adapter })).resolves.toBeUndefined();
  });
});
