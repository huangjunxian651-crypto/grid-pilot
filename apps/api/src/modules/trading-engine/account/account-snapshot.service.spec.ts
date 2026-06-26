import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AccountSnapshotService } from './account-snapshot.service';
import type { ExchangeAdapter } from '../adapters/exchange-adapter.interface';

const createMockAdapter = (
  balance = {
    asset: 'USDT',
    free: 10000,
    locked: 500,
    totalWalletBalance: 10500,
    totalUnrealizedProfit: -50,
  },
): ExchangeAdapter =>
  ({
    exchange: 'BINANCE',
    getBalance: vi.fn().mockResolvedValue(balance),
    getPosition: vi.fn().mockResolvedValue({
      symbol: 'ETH/USDT',
      baseAssetQty: 0.5,
      quoteAssetQty: -1000,
      entryPrice: 2000,
      leverage: 20,
      marginType: 'CROSS' as const,
      unrealizedPnl: -50,
    }),
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    subscribeTicker: vi.fn().mockImplementation(async function* () {}),
    subscribeOrderUpdates: vi.fn().mockImplementation(async function* () {}),
    subscribePosition: vi.fn().mockImplementation(async function* () {}),
    getTicker: vi
      .fn()
      .mockResolvedValue({ symbol: 'ETH/USDT', bid: 2000, ask: 2001, last: 2000.5, timestamp: Date.now() }),
    createOrder: vi.fn(),
    cancelOrder: vi.fn(),
    getOpenOrders: vi.fn().mockResolvedValue([]),
    createAlgoOrder: vi.fn(),
    cancelAlgoOrder: vi.fn(),
    getAlgoOrders: vi.fn().mockResolvedValue([]),
    cancelAllOrders: vi.fn(),
    cancelAllAlgoOrders: vi.fn(),
    closePosition: vi.fn(),
  }) as unknown as ExchangeAdapter;

const makePrismaMock = () => ({
  equitySnapshot: { create: vi.fn().mockResolvedValue({}) },
});

describe('AccountSnapshotService', () => {
  let service: AccountSnapshotService;
  let prismaMock: ReturnType<typeof makePrismaMock>;

  beforeEach(() => {
    prismaMock = makePrismaMock();
    service = new AccountSnapshotService(prismaMock as never);
  });
  afterEach(() => {
    service.stopAll();
  });

  it('returns undefined before polling starts', () => {
    expect(service.getSnapshot('cred-1')).toBeUndefined();
  });

  it('getActivePollers 暴露活跃账户的 {credentialId, adapter, symbols}，stopPolling 后移除', () => {
    const a1 = createMockAdapter();
    const a2 = createMockAdapter();
    service.ensurePolling('cred-1', ['ETH/USDT'], a1);
    service.ensurePolling('cred-2', ['BTC/USDT', 'SOL/USDT'], a2);
    const pollers = service.getActivePollers();
    expect(pollers.length).toBe(2);
    expect(pollers).toEqual(
      expect.arrayContaining([
        { credentialId: 'cred-1', adapter: a1, symbols: ['ETH/USDT'] },
        { credentialId: 'cred-2', adapter: a2, symbols: ['BTC/USDT', 'SOL/USDT'] },
      ]),
    );
    service.stopPolling('cred-1');
    expect(service.getActivePollers().map((p) => p.credentialId)).toEqual(['cred-2']);
  });

  it('onModuleDestroy 清理所有轮询定时器（关闭时不泄漏）', () => {
    service.ensurePolling('c1', ['ETH/USDT'], createMockAdapter());
    service.ensurePolling('c2', ['BTC/USDT'], createMockAdapter());
    expect(service.getActivePollers().length).toBe(2);
    service.onModuleDestroy();
    expect(service.getActivePollers().length).toBe(0);
  });

  it('returns snapshot after polling once', async () => {
    const adapter = createMockAdapter();
    service.ensurePolling('cred-1', ['ETH/USDT'], adapter);
    await service.pollOnce('cred-1');
    const snap = service.getSnapshot('cred-1');
    expect(snap).toBeDefined();
    expect(snap!.credentialId).toBe('cred-1');
    expect(snap!.availableUsdt).toBe(10000);
    expect(snap!.positions.length).toBe(1);
  });

  it('computes totalEquity from balance', async () => {
    const adapter = createMockAdapter();
    service.ensurePolling('cred-1', ['ETH/USDT'], adapter);
    await service.pollOnce('cred-1');
    const snap = service.getSnapshot('cred-1');
    expect(snap!.totalEquity).toBe(10500 + -50);
  });

  it('filters out zero-qty positions', async () => {
    const adapter = createMockAdapter();
    (adapter.getPosition as any).mockResolvedValue({
      symbol: 'ETH/USDT',
      baseAssetQty: 0,
      quoteAssetQty: 0,
      entryPrice: 0,
      leverage: 20,
      marginType: 'CROSS',
      unrealizedPnl: 0,
    });
    service.ensurePolling('cred-1', ['ETH/USDT'], adapter);
    await service.pollOnce('cred-1');
    const snap = service.getSnapshot('cred-1');
    expect(snap!.positions.length).toBe(0);
  });

  it('stopPolling removes snapshot', async () => {
    const adapter = createMockAdapter();
    service.ensurePolling('cred-1', ['ETH/USDT'], adapter);
    await service.pollOnce('cred-1');
    service.stopPolling('cred-1');
    expect(service.getSnapshot('cred-1')).toBeUndefined();
  });

  it('getAllSnapshots returns all active snapshots', async () => {
    service.ensurePolling('c1', [], createMockAdapter());
    service.ensurePolling('c2', [], createMockAdapter());
    await service.pollOnce('c1');
    await service.pollOnce('c2');
    expect(service.getAllSnapshots().length).toBe(2);
  });

  it('includes unrealizedPnl in positions', async () => {
    const adapter = createMockAdapter();
    (adapter.getPosition as any).mockResolvedValue({
      symbol: 'ETH/USDT',
      baseAssetQty: 0.5,
      quoteAssetQty: -1000,
      entryPrice: 2000,
      leverage: 20,
      marginType: 'CROSS',
      unrealizedPnl: -37.5,
    });
    service.ensurePolling('cred-1', ['ETH/USDT'], adapter);
    await service.pollOnce('cred-1');
    const snap = service.getSnapshot('cred-1');
    expect(snap!.positions[0].unrealizedPnl).toBe(-37.5);
  });

  it('coerces NaN unrealizedPnl to 0 (parseFloat edge case)', async () => {
    const adapter = createMockAdapter();
    (adapter.getPosition as any).mockResolvedValue({
      symbol: 'ETH/USDT',
      baseAssetQty: 0.5,
      quoteAssetQty: -1000,
      entryPrice: 2000,
      leverage: 20,
      marginType: 'CROSS',
      unrealizedPnl: NaN,
    });
    service.ensurePolling('cred-1', ['ETH/USDT'], adapter);
    await service.pollOnce('cred-1');
    const snap = service.getSnapshot('cred-1');
    expect(snap!.positions[0].unrealizedPnl).toBe(0);
  });

  it('coerces undefined unrealizedPnl to 0', async () => {
    const adapter = createMockAdapter();
    (adapter.getPosition as any).mockResolvedValue({
      symbol: 'ETH/USDT',
      baseAssetQty: 0.5,
      quoteAssetQty: -1000,
      entryPrice: 2000,
      leverage: 20,
      marginType: 'CROSS',
    });
    service.ensurePolling('cred-1', ['ETH/USDT'], adapter);
    await service.pollOnce('cred-1');
    const snap = service.getSnapshot('cred-1');
    expect(snap!.positions[0].unrealizedPnl).toBe(0);
  });

  describe('ensurePolling — 声明式 symbol 集合', () => {
    it('新建轮询（无现有）需 adapter 并设定 symbols', () => {
      service.ensurePolling('c1', ['ETH/USDT'], createMockAdapter());
      expect(service.getPolledSymbols('c1')).toEqual(['ETH/USDT']);
    });

    it('已存在时更新为新的 symbol 集合（无需再传 adapter）', () => {
      service.ensurePolling('c1', ['ETH/USDT'], createMockAdapter());
      service.ensurePolling('c1', ['ETH/USDT', 'BTC/USDT']);
      expect(service.getPolledSymbols('c1')).toEqual(['ETH/USDT', 'BTC/USDT']);
    });

    it('无现有且无 adapter → 跳过，不抛、不建轮询', () => {
      service.ensurePolling('c1', ['ETH/USDT']);
      expect(service.getPolledSymbols('c1')).toBeUndefined();
    });

    it('更新 symbols 不产生重复定时器（单账户单次轮询）', async () => {
      vi.useFakeTimers();
      const a = createMockAdapter();
      service.ensurePolling('c1', ['ETH/USDT'], a);
      service.ensurePolling('c1', ['BTC/USDT'], a);
      // 清掉首次 ensurePolling 触发的初始快照，只计后续定时器触发次数
      (a.getBalance as any).mockClear();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(a.getBalance as any).toHaveBeenCalledTimes(1);
      vi.useRealTimers();
    });
  });

  describe('fetchOnDemand', () => {
    it('returns snapshot without starting polling', async () => {
      const svc = new AccountSnapshotService(makePrismaMock() as never);
      const adapter = createMockAdapter();
      const snap = await svc.fetchOnDemand('cred-od-1', adapter, ['ETH/USDT']);
      expect(snap).toBeDefined();
      expect(snap!.credentialId).toBe('cred-od-1');
      expect(snap!.availableUsdt).toBe(10000);
      expect(snap!.positions.length).toBe(1);
      expect(svc.getSnapshot('cred-od-1')).toBeUndefined();
      svc.stopAll();
    });

    it('returns snapshot even with no symbols', async () => {
      const svc = new AccountSnapshotService(makePrismaMock() as never);
      const adapter = createMockAdapter({
        asset: 'USDT',
        free: 5000,
        locked: 200,
        totalWalletBalance: 5200,
        totalUnrealizedProfit: 0,
      });
      const snap = await svc.fetchOnDemand('cred-od-2', adapter, []);
      expect(snap!.totalEquity).toBe(5200);
      expect(snap!.positions.length).toBe(0);
      svc.stopAll();
    });
  });
});

describe('权益快照节流落库（P2-1 EquitySnapshot）', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('间隔内多次轮询只落一行，超过 PERSIST_INTERVAL 落第二行', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
    const prisma = makePrismaMock();
    const svc = new AccountSnapshotService(prisma as never);
    const adapter = createMockAdapter();
    svc.ensurePolling('cred-p', ['ETH/USDT'], adapter);

    await svc.pollOnce('cred-p');
    await svc.pollOnce('cred-p'); // 同一时刻(间隔内)再次轮询
    expect(prisma.equitySnapshot.create).toHaveBeenCalledTimes(1);
    const firstArg = prisma.equitySnapshot.create.mock.calls[0][0];
    expect(firstArg.data).toMatchObject({
      credentialId: 'cred-p',
      totalEquity: 10450, // 10500 wallet + (-50) uPnL
      totalWalletBalance: 10500,
      availableUsdt: 10000,
    });

    vi.setSystemTime(1_700_000_000_000 + 5 * 60_000 + 1);
    await svc.pollOnce('cred-p');
    expect(prisma.equitySnapshot.create).toHaveBeenCalledTimes(2);
    svc.stopAll();
  });

  it('落库失败不影响内存快照与 onChanged 广播，且下次轮询重试', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
    const prisma = makePrismaMock();
    prisma.equitySnapshot.create.mockRejectedValueOnce(new Error('db down'));
    const svc = new AccountSnapshotService(prisma as never);
    const adapter = createMockAdapter();
    const changed = vi.fn();
    svc.setOnChanged(changed);
    svc.ensurePolling('cred-f', ['ETH/USDT'], adapter);

    await svc.pollOnce('cred-f');
    expect(svc.getSnapshot('cred-f')).toBeDefined();
    expect(changed).toHaveBeenCalled();

    // 失败后节流位应释放：同一间隔内的下次轮询即可重试落库
    await svc.pollOnce('cred-f');
    expect(prisma.equitySnapshot.create).toHaveBeenCalledTimes(2);
    svc.stopAll();
  });
});
