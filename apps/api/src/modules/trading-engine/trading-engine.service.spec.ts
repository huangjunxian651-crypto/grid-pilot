import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { TradingEngineService, ownsSessionAlgo, needsRunStateResetOnStart, buildOrderCreateData } from './trading-engine.service';
import type { PlacedOrder } from './runner/grid-bot-runner';

describe('ownsSessionAlgo', () => {
  it('匹配本 session 前缀的算法单', () => {
    expect(ownsSessionAlgo('ETHUSDT_123_algo_emergency_ab12', 'ETHUSDT_123')).toBe(true);
  });
  it('拒绝其他 session 的算法单(孤儿)', () => {
    expect(ownsSessionAlgo('ETHUSDT_999_algo_emergency_ab12', 'ETHUSDT_123')).toBe(false);
  });
  it('拒绝 undefined / 非本前缀', () => {
    expect(ownsSessionAlgo(undefined, 'ETHUSDT_123')).toBe(false);
    expect(ownsSessionAlgo('foo', 'ETHUSDT_123')).toBe(false);
  });
  it('匹配新格式（无分隔符 token+A…，OKX 回报形态）', () => {
    expect(ownsSessionAlgo('ETHUSDT260611071735AE3k', 'ETHUSDT_260611071735')).toBe(true);
    expect(ownsSessionAlgo('ETHUSDT260611999999AE3k', 'ETHUSDT_260611071735')).toBe(false);
  });
  it('匹配 OKX 截断态旧格式（token+algo…），与 runner 所有权判断一致', () => {
    expect(ownsSessionAlgo('ETHUSDT260611071735algoemergency', 'ETHUSDT_260611071735')).toBe(true);
    expect(ownsSessionAlgo('ETHUSDT260611999999algoemergency', 'ETHUSDT_260611071735')).toBe(false);
  });
});

describe('TradingEngineService.handleAutoTermination', () => {
  let prismaUpdate: ReturnType<typeof vi.fn>;
  let prismaFindUnique: ReturnType<typeof vi.fn>;
  let stopPolling: ReturnType<typeof vi.fn>;
  let ensurePolling: ReturnType<typeof vi.fn>;
  let reconcileRun: ReturnType<typeof vi.fn>;
  let captureSnapshot: ReturnType<typeof vi.fn>;

  function makeService() {
    prismaUpdate = vi.fn().mockResolvedValue({});
    prismaFindUnique = vi.fn().mockResolvedValue({ id: 'sess-id-1', endedAt: null });
    stopPolling = vi.fn();
    ensurePolling = vi.fn();
    reconcileRun = vi.fn().mockResolvedValue(undefined);
    captureSnapshot = vi.fn().mockResolvedValue(undefined);

    const mockPrisma = {
      run: {
        findUnique: prismaFindUnique,
        update: prismaUpdate,
      },
    };
    const mockAccountSnapshot = {
      stopPolling,
      ensurePolling,
      setOnChanged: vi.fn(),
    };

    const svc = new TradingEngineService(
      mockPrisma as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      mockAccountSnapshot as any,
      {} as any,
      { ingest: vi.fn().mockResolvedValue(undefined) } as any,
      { reconcileRun } as any,
      { createAndBroadcast: vi.fn().mockResolvedValue({}) } as any,
      { capture: captureSnapshot, getByRunId: vi.fn() } as any,
    );

    return svc;
  }

  /** 等 void(fire-and-forget) 的 STOP 快照链跑完（微任务 + 一个宏任务）。 */
  const flush = () => new Promise((r) => setTimeout(r, 0));

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updates DB to LIQUIDATED with exitReason STOP_LOSS when FSM reaches LIQUIDATED', async () => {
    const svc = makeService();
    await (svc as any).handleAutoTermination('session-test', 'LIQUIDATED');

    expect(prismaFindUnique).toHaveBeenCalledWith({ where: { runCode: 'session-test' } });
    expect(prismaUpdate).toHaveBeenCalledWith({
      where: { id: 'sess-id-1' },
      data: {
        state: 'LIQUIDATED',
        endedAt: expect.any(Date),
        exitReason: 'STOP_LOSS',
      },
    });
  });

  it('updates DB to TAKE_PROFIT with exitReason TAKE_PROFIT when FSM reaches TAKE_PROFIT', async () => {
    const svc = makeService();
    await (svc as any).handleAutoTermination('session-test', 'TAKE_PROFIT');

    expect(prismaUpdate).toHaveBeenCalledWith({
      where: { id: 'sess-id-1' },
      data: {
        state: 'TAKE_PROFIT',
        endedAt: expect.any(Date),
        exitReason: 'TAKE_PROFIT',
      },
    });
  });

  it('updates DB to CANCELLED with exitReason TRAILING_CANCELLED when FSM reaches CANCELLED（不并入止损）', async () => {
    const svc = makeService();
    await (svc as any).handleAutoTermination('session-test', 'CANCELLED');

    expect(prismaUpdate).toHaveBeenCalledWith({
      where: { id: 'sess-id-1' },
      data: {
        state: 'CANCELLED',
        endedAt: expect.any(Date),
        exitReason: 'TRAILING_CANCELLED',
      },
    });
  });

  it('终态(adapter 在)写一条 STOP 余额快照，exitReason 随 FSM 终态（best-effort 接线）', async () => {
    const svc = makeService();
    prismaFindUnique.mockResolvedValue({
      id: 'r1', boxId: 'b1', endedAt: null, exitReason: null,
      realizedPnl: 0, totalFees: 0, totalSavings: 0,
      box: { robotId: 'rb1', accountId: 'acct1' },
    });
    (svc as any).sessionAdapterMap.set('session-test', {});
    (svc as any).runners.set('session-test', { symbol: 'ETH/USDT' });

    await (svc as any).handleAutoTermination('session-test', 'LIQUIDATED');
    await flush();

    expect(captureSnapshot).toHaveBeenCalledTimes(1);
    expect(captureSnapshot.mock.calls[0][0]).toMatchObject({
      runId: 'r1', event: 'STOP', symbol: 'ETH/USDT', exitReason: 'STOP_LOSS',
      credentialId: 'acct1', boxId: 'b1', robotId: 'rb1',
    });
  });

  it('已 endedAt 的终态(幂等)不再写 STOP 快照', async () => {
    const svc = makeService();
    prismaFindUnique.mockResolvedValue({ id: 'r1', boxId: 'b1', endedAt: new Date(), exitReason: 'TAKE_PROFIT' });
    (svc as any).sessionAdapterMap.set('session-test', {});
    (svc as any).runners.set('session-test', { symbol: 'ETH/USDT' });

    await (svc as any).handleAutoTermination('session-test', 'LIQUIDATED');
    await flush();

    expect(captureSnapshot).not.toHaveBeenCalled();
  });

  it('is idempotent: does not update DB if session already has endedAt', async () => {
    const svc = makeService();
    prismaFindUnique.mockResolvedValue({ id: 'sess-id-1', endedAt: new Date() });

    await (svc as any).handleAutoTermination('session-test', 'LIQUIDATED');

    expect(prismaUpdate).not.toHaveBeenCalled();
  });

  it('is idempotent: does not update DB if session does not exist', async () => {
    const svc = makeService();
    prismaFindUnique.mockResolvedValue(null);

    await (svc as any).handleAutoTermination('session-test', 'LIQUIDATED');

    expect(prismaUpdate).not.toHaveBeenCalled();
  });

  it('终态时对该 run 做最终成交对账：平仓成交不因 sweep 停止而丢失', async () => {
    // LIQUIDATED 后 run 不再被周期 sweep 覆盖，closePosition 的成交若 WS 没收到
    // 就永远不入库（清算盈亏丢失）。终态必须用退出前的 adapter 补一次 reconcile。
    const svc = makeService();
    const adapter = { id: 'adapter-1' };
    const runner = { symbol: 'ETH/USDT' };
    (svc as any).runners.set('session-test', runner);
    (svc as any).sessionAdapterMap.set('session-test', adapter);

    await (svc as any).handleAutoTermination('session-test', 'LIQUIDATED');

    expect(reconcileRun).toHaveBeenCalledWith('session-test', 'ETH/USDT', adapter);
  });

  it('终态对账延迟二次执行：关闭 close 单落库 fire-and-forget 与 REST 可见性竞态窗口', async () => {
    // 周期 sweep 靠"下次必重拉"闭合 order-before-fill 窗口，但终态 run 没有
    // 下次：单发对账若跑在 close 单 order.create 提交前或成交在 REST 端可见前，
    // 平仓成交永久丢失。延迟几秒再对账一次。
    vi.useFakeTimers();
    try {
      const svc = makeService();
      const adapter = { id: 'adapter-1' };
      (svc as any).runners.set('session-test', { symbol: 'ETH/USDT' });
      (svc as any).sessionAdapterMap.set('session-test', adapter);

      await (svc as any).handleAutoTermination('session-test', 'LIQUIDATED');
      expect(reconcileRun).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(6000);
      expect(reconcileRun).toHaveBeenCalledTimes(2);
      expect(reconcileRun).toHaveBeenLastCalledWith('session-test', 'ETH/USDT', adapter);
    } finally {
      vi.useRealTimers();
    }
  });

  it('STOP 余额快照在立即对账完成后才抓取（快照 realizedPnl 必须含平仓成交，code-review I2）', async () => {
    const order: string[] = [];
    const svc = makeService();
    prismaFindUnique.mockResolvedValue({
      id: 'r1', boxId: 'b1', endedAt: null, exitReason: null,
      realizedPnl: 0, totalFees: 0, totalSavings: 0,
      box: { robotId: 'rb1', accountId: 'acct1' },
    });
    (svc as any).runners.set('session-test', { symbol: 'ETH/USDT' });
    (svc as any).sessionAdapterMap.set('session-test', { id: 'a' });
    reconcileRun.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 10));
      order.push('reconcile');
    });
    captureSnapshot.mockImplementation(async () => {
      order.push('snapshot');
    });

    await (svc as any).handleAutoTermination('session-test', 'LIQUIDATED');
    await flush();

    expect(order).toEqual(['reconcile', 'snapshot']);
  });

  it('handleAutoTermination 走 reconcile：账户已无其他 runner → stopPolling 该账户', async () => {
    const svc = makeService();
    (svc as any).sessionCredentialMap.set('session-test', 'cred-1');
    (svc as any).sessionAdapterMap.set('session-test', { id: 'a' });

    await (svc as any).handleAutoTermination('session-test', 'LIQUIDATED');

    expect(stopPolling).toHaveBeenCalledWith('cred-1');
    expect((svc as any).sessionCredentialMap.has('session-test')).toBe(false);
    expect((svc as any).sessionAdapterMap.has('session-test')).toBe(false);
  });

  it('handleAutoTermination 走 reconcile：账户尚有其他 runner → ensurePolling 而非 stopPolling', async () => {
    const svc = makeService();
    (svc as any).runners.set('sibling', { symbol: 'BTC/USDT' });
    (svc as any).sessionCredentialMap.set('sibling', 'cred-1');
    (svc as any).sessionAdapterMap.set('sibling', { id: 'a-btc' });
    (svc as any).sessionCredentialMap.set('session-test', 'cred-1');
    (svc as any).sessionAdapterMap.set('session-test', { id: 'a-eth' });

    await (svc as any).handleAutoTermination('session-test', 'LIQUIDATED');

    expect(ensurePolling).toHaveBeenCalledWith('cred-1', ['BTC/USDT'], { id: 'a-btc' });
    expect(stopPolling).not.toHaveBeenCalled();
  });

  describe('evictRunnersOnSymbol', () => {
    function makeRunner(symbol: string) {
      return { symbol, stop: vi.fn().mockResolvedValue({ cancelFailed: [] }) };
    }

    it('驱逐同账户 + 同 symbol 的僵尸 runner', async () => {
      const svc = makeService();
      const zombie = makeRunner('ETH/USDT');
      (svc as any).runners.set('zombie-sess', zombie);
      (svc as any).sessionCredentialMap.set('zombie-sess', 'cred-A');
      (svc as any).sessionAdapterMap.set('zombie-sess', { id: 'a' });

      await (svc as any).evictRunnersOnSymbol('ETH/USDT', 'cred-A', 'new-sess');

      expect(zombie.stop).toHaveBeenCalled();
      expect((svc as any).runners.has('zombie-sess')).toBe(false);
      expect((svc as any).sessionCredentialMap.has('zombie-sess')).toBe(false);
      expect((svc as any).sessionAdapterMap.has('zombie-sess')).toBe(false);
      expect(stopPolling).toHaveBeenCalledWith('cred-A');
    });

    it('不驱逐不同账户的同 symbol runner（跨账户隔离）', async () => {
      const svc = makeService();
      const other = makeRunner('ETH/USDT');
      (svc as any).runners.set('other-acct-sess', other);
      (svc as any).sessionCredentialMap.set('other-acct-sess', 'cred-B');

      await (svc as any).evictRunnersOnSymbol('ETH/USDT', 'cred-A', 'new-sess');

      expect(other.stop).not.toHaveBeenCalled();
      expect((svc as any).runners.has('other-acct-sess')).toBe(true);
      expect((svc as any).sessionCredentialMap.has('other-acct-sess')).toBe(true);
      expect(stopPolling).not.toHaveBeenCalled();
    });

    it('不驱逐不同 symbol 的 runner，也不驱逐自身 session', async () => {
      const svc = makeService();
      const otherSymbol = makeRunner('BTC/USDT');
      const self = makeRunner('ETH/USDT');
      (svc as any).runners.set('other-symbol-sess', otherSymbol);
      (svc as any).sessionCredentialMap.set('other-symbol-sess', 'cred-A');
      (svc as any).runners.set('new-sess', self);
      (svc as any).sessionCredentialMap.set('new-sess', 'cred-A');

      await (svc as any).evictRunnersOnSymbol('ETH/USDT', 'cred-A', 'new-sess');

      expect(otherSymbol.stop).not.toHaveBeenCalled();
      expect(self.stop).not.toHaveBeenCalled();
      expect((svc as any).runners.has('new-sess')).toBe(true);
    });
  });

  describe('reconcileAccountPolling — 声明式账户轮询', () => {
    function makeSvcWithSnapshot() {
      const ensurePolling = vi.fn();
      const stopPollingFn = vi.fn();
      const svc = new TradingEngineService(
        {} as any, {} as any, {} as any, {} as any, {} as any,
        { stopPolling: stopPollingFn, ensurePolling, setOnChanged: vi.fn() } as any,
        {} as any,
        { ingest: vi.fn().mockResolvedValue(undefined) } as any,
        { reconcileRun: vi.fn().mockResolvedValue(undefined) } as any,
        { createAndBroadcast: vi.fn().mockResolvedValue({}) } as any,
      );
      return { svc, ensurePolling, stopPollingFn };
    }
    const fakeRunner = (symbol: string) => ({ symbol });

    it('多个活跃 runner 同账户 → ensurePolling 覆盖 symbol 并集', () => {
      const { svc, ensurePolling, stopPollingFn } = makeSvcWithSnapshot();
      (svc as any).runners.set('s-eth', fakeRunner('ETH/USDT'));
      (svc as any).runners.set('s-btc', fakeRunner('BTC/USDT'));
      (svc as any).sessionCredentialMap.set('s-eth', 'cred-A');
      (svc as any).sessionCredentialMap.set('s-btc', 'cred-A');
      (svc as any).sessionAdapterMap.set('s-eth', { id: 'adapter-eth' });

      (svc as any).reconcileAccountPolling('cred-A');

      expect(ensurePolling).toHaveBeenCalledWith('cred-A', ['ETH/USDT', 'BTC/USDT'], { id: 'adapter-eth' });
      expect(stopPollingFn).not.toHaveBeenCalled();
    });

    it('账户已无活跃 runner → stopPolling', () => {
      const { svc, ensurePolling, stopPollingFn } = makeSvcWithSnapshot();
      (svc as any).reconcileAccountPolling('cred-A');
      expect(stopPollingFn).toHaveBeenCalledWith('cred-A');
      expect(ensurePolling).not.toHaveBeenCalled();
    });

    it('同账户两 runner 停掉其一后对账 → 仍轮询，symbol 收缩为剩余（不掐整账户）', () => {
      const { svc, ensurePolling, stopPollingFn } = makeSvcWithSnapshot();
      // 模拟「s-eth 已被停止流程删除」后的状态：只剩 s-btc
      (svc as any).runners.set('s-btc', fakeRunner('BTC/USDT'));
      (svc as any).sessionCredentialMap.set('s-btc', 'cred-A');
      (svc as any).sessionAdapterMap.set('s-btc', { id: 'adapter-btc' });

      (svc as any).reconcileAccountPolling('cred-A');

      expect(ensurePolling).toHaveBeenCalledWith('cred-A', ['BTC/USDT'], { id: 'adapter-btc' });
      expect(stopPollingFn).not.toHaveBeenCalled();
    });

    it('只统计目标账户的 runner（跨账户隔离）', () => {
      const { svc, ensurePolling } = makeSvcWithSnapshot();
      (svc as any).runners.set('s-eth-A', fakeRunner('ETH/USDT'));
      (svc as any).runners.set('s-eth-B', fakeRunner('ETH/USDT'));
      (svc as any).sessionCredentialMap.set('s-eth-A', 'cred-A');
      (svc as any).sessionCredentialMap.set('s-eth-B', 'cred-B');
      (svc as any).sessionAdapterMap.set('s-eth-A', { id: 'adapter-A' });

      (svc as any).reconcileAccountPolling('cred-A');

      expect(ensurePolling).toHaveBeenCalledWith('cred-A', ['ETH/USDT'], { id: 'adapter-A' });
    });
  });

  it('notifies the registered box-terminated listener with robotId and configId', async () => {
    const onBoxTerminated = vi.fn().mockResolvedValue(undefined);
    const mockPrisma = {
      run: {
        findUnique: vi.fn().mockResolvedValue({ id: 'sess-id-1', boxId: 'box-1', endedAt: null }),
        update: vi.fn().mockResolvedValue({}),
      },
      box: {
        findUnique: vi.fn().mockResolvedValue({ id: 'box-1', robotId: 'robot-1' }),
      },
    };

    const svc = new TradingEngineService(
      mockPrisma as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { stopPolling: vi.fn(), ensurePolling: vi.fn(), setOnChanged: vi.fn() } as any,
      {} as any,
      { ingest: vi.fn().mockResolvedValue(undefined) } as any,
      { reconcileRun: vi.fn().mockResolvedValue(undefined) } as any,
      { createAndBroadcast: vi.fn().mockResolvedValue({}) } as any,
    );
    // R1:监听器由 BotManager 注册,TES 不再直接持有 BotManager 引用。
    svc.setOnBoxTerminated(onBoxTerminated);

    await (svc as any).handleAutoTermination('session-test', 'LIQUIDATED');

    expect(onBoxTerminated).toHaveBeenCalledWith('robot-1', 'box-1');
  });
});

describe('TradingEngineService.getStatus 已实现盈亏取数源（BUG-01）', () => {
  it('realizedPnl 取自 fillIngestion 缓存(DB权威)，而非 runner 恒0 的 stats.realizedPnl', () => {
    const fillIngestion = { getCachedRealizedPnl: vi.fn().mockReturnValue(6.5) };
    const svc = new TradingEngineService(
      {} as any, {} as any, {} as any, {} as any, {} as any,
      {} as any, {} as any, fillIngestion as any, {} as any, {} as any,
    );
    const runner = {
      symbol: 'ETH/USDT',
      getState: () => ({
        fsm: { kind: 'RUNNING' }, config: { direction: 'LONG' }, lastPrice: 1600,
        position: null, stats: { realizedPnl: 0, totalFills: 5, totalOrdersPlaced: 5, totalReorders: 0 },
      }),
      getActiveOrder: () => null,
      getAlgoOrders: () => [],
    };
    (svc as any).runners.set('RC1', runner);

    const status = svc.getStatus('RC1');
    expect(status?.realizedPnl).toBe(6.5);
    expect(fillIngestion.getCachedRealizedPnl).toHaveBeenCalledWith('RC1');
  });

  it('缓存未命中时回退 runner stats（不破坏未摄入成交的 run）', () => {
    const fillIngestion = { getCachedRealizedPnl: vi.fn().mockReturnValue(undefined) };
    const svc = new TradingEngineService(
      {} as any, {} as any, {} as any, {} as any, {} as any,
      {} as any, {} as any, fillIngestion as any, {} as any, {} as any,
    );
    const runner = {
      symbol: 'ETH/USDT',
      getState: () => ({
        fsm: { kind: 'RUNNING' }, config: { direction: 'LONG' }, lastPrice: 1600,
        position: null, stats: { realizedPnl: 3.3, totalFills: 1, totalOrdersPlaced: 1, totalReorders: 0 },
      }),
      getActiveOrder: () => null,
      getAlgoOrders: () => [],
    };
    (svc as any).runners.set('RC1', runner);
    expect(svc.getStatus('RC1')?.realizedPnl).toBe(3.3);
  });
});

describe('needsRunStateResetOnStart（BUG-05 恢复后 Run.state 死锁 PAUSED）', () => {
  it('已结束的 run 重启时需重置 state', () => {
    expect(needsRunStateResetOnStart({ endedAt: new Date(), state: 'STOPPED' })).toBe(true);
  });
  it('未结束但 PAUSED 的 run（点暂停后再启动）需重置 state，否则 Run.state 死锁 PAUSED', () => {
    expect(needsRunStateResetOnStart({ endedAt: null, state: 'PAUSED' })).toBe(true);
  });
  it('正在 RUNNING 的 run 无需重置', () => {
    expect(needsRunStateResetOnStart({ endedAt: null, state: 'RUNNING' })).toBe(false);
  });
});

describe('TradingEngineService.startBot 恢复已暂停的存活 runner（BUG-05 真实 pause→resume 路径）', () => {
  it('runner 存活且 run=PAUSED 时应 USER_RESUME 并复位 Run.state=RUNNING，而非抛 Conflict', async () => {
    const runUpdate = vi.fn().mockResolvedValue({});
    const prisma = {
      run: {
        findUnique: vi.fn().mockResolvedValue({ id: 'run-id', runCode: 'RC1', state: 'PAUSED', endedAt: null }),
        update: runUpdate,
      },
    };
    const svc = new TradingEngineService(
      prisma as any, {} as any, {} as any, {} as any, {} as any,
      {} as any, {} as any, {} as any, {} as any, {} as any,
    );
    const submit = vi.fn();
    const existingRunner = { submitUserAction: submit };
    (svc as any).runners.set('RC1', existingRunner);

    const result = await svc.startBot('cfg1', 'RC1');

    expect(submit).toHaveBeenCalledWith('USER_RESUME');
    expect(runUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ state: 'RUNNING' }) }));
    expect(result).toBe(existingRunner);
  });

  it('runner 存活且 run 已 RUNNING（重复启动）仍抛 Conflict', async () => {
    const prisma = {
      run: { findUnique: vi.fn().mockResolvedValue({ id: 'run-id', runCode: 'RC1', state: 'RUNNING', endedAt: null }), update: vi.fn() },
    };
    const svc = new TradingEngineService(
      prisma as any, {} as any, {} as any, {} as any, {} as any,
      {} as any, {} as any, {} as any, {} as any, {} as any,
    );
    (svc as any).runners.set('RC1', { submitUserAction: vi.fn() });
    await expect(svc.startBot('cfg1', 'RC1')).rejects.toThrow(/already running/);
  });
});

describe('TradingEngineService 终态口径统一（item1：按谁触发）', () => {
  function makeSvc() {
    const runUpdate = vi.fn().mockResolvedValue({});
    const prisma = {
      run: {
        findUnique: vi.fn().mockResolvedValue({ id: 'run-id-1', runCode: 'RC1', endedAt: null }),
        update: runUpdate,
      },
    };
    const svc = new TradingEngineService(
      prisma as any, {} as any, {} as any, {} as any, {} as any,
      { stopPolling: vi.fn(), ensurePolling: vi.fn() } as any, {} as any,
      { clearRealizedPnl: vi.fn() } as any, {} as any,
      { createAndBroadcast: vi.fn().mockResolvedValue({}) } as any,
    );
    return { svc, runUpdate };
  }
  const runnerStub = () => ({
    requestLiquidation: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue({ cancelFailed: [] }),
    submitUserAction: vi.fn(),
    symbol: 'ETH/USDT',
  });

  it('stopBot 默认写 STOPPED/USER_CLOSE（不再 LIQUIDATED/MANUAL）', async () => {
    const { svc, runUpdate } = makeSvc();
    (svc as any).runners.set('RC1', runnerStub());
    await svc.stopBot('RC1');
    expect(runUpdate).toHaveBeenCalledWith({
      where: { id: 'run-id-1' },
      data: { state: 'STOPPED', endedAt: expect.any(Date), exitReason: 'USER_CLOSE' },
    });
  });

  it('detachBot 默认写 STOPPED/USER_DETACH（不再 LIQUIDATED/DETACHED）', async () => {
    const { svc, runUpdate } = makeSvc();
    (svc as any).runners.set('RC1', runnerStub());
    await svc.detachBot('RC1');
    expect(runUpdate).toHaveBeenCalledWith({
      where: { id: 'run-id-1' },
      data: { state: 'STOPPED', endedAt: expect.any(Date), exitReason: 'USER_DETACH' },
    });
  });

  it('detachBot 接受终态覆写（系统切箱传 SUPERSEDED/NEW_SESSION）', async () => {
    const { svc, runUpdate } = makeSvc();
    (svc as any).runners.set('RC1', runnerStub());
    await svc.detachBot('RC1', { state: 'SUPERSEDED', exitReason: 'NEW_SESSION' });
    expect(runUpdate).toHaveBeenCalledWith({
      where: { id: 'run-id-1' },
      data: { state: 'SUPERSEDED', endedAt: expect.any(Date), exitReason: 'NEW_SESSION' },
    });
  });
});

describe('TradingEngineService.stopBot — 平仓完成后才停 runner (BUG-07)', () => {
  function makeServiceWithRunner(runner: Record<string, unknown>) {
    const prisma = {
      run: {
        findUnique: vi.fn().mockResolvedValue({ id: 'run-id-1', runCode: 'RC1', endedAt: null }),
        update: vi.fn().mockResolvedValue({}),
      },
    };
    const svc = new TradingEngineService(
      prisma as any, {} as any, {} as any, {} as any, {} as any,
      { stopPolling: vi.fn(), ensurePolling: vi.fn() } as any, {} as any,
      { clearRealizedPnl: vi.fn() } as any, {} as any,
      { createAndBroadcast: vi.fn().mockResolvedValue({}) } as any,
    );
    (svc as any).runners.set('RC1', runner);
    return svc;
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('stopBot 等待 requestLiquidation 完成后才调用 runner.stop（无固定 500ms 竞态）', async () => {
    const order: string[] = [];
    const runner = {
      requestLiquidation: vi.fn().mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 1500)); // 平仓耗时远超 500ms
        order.push('liquidated');
      }),
      stop: vi.fn().mockImplementation(async () => {
        order.push('stop');
        return { cancelFailed: [] };
      }),
      submitUserAction: vi.fn(),
    };
    const svc = makeServiceWithRunner(runner);

    const p = svc.stopBot('RC1');
    await vi.advanceTimersByTimeAsync(5000);
    await p;

    expect(order).toEqual(['liquidated', 'stop']);
  });

  it('stopBot 清算后交易所仍有持仓时兜底强平（BUG-C 防御:死 runner 静默跳过清算）', async () => {
    // 复现 2026-06-12 实测:runner 已死（running=false）时 requestLiquidation 立即
    // resolve,closePosition:true 的停止静默跳过平仓,3.877 ETH 空头裸留 OKX。
    // 黑盒契约:无论 runner 内存状态如何,停止后以交易所实时仓位为准,残留即强平。
    const runner = {
      requestLiquidation: vi.fn().mockResolvedValue(undefined), // 死 runner:立即"完成"
      stop: vi.fn().mockResolvedValue({ cancelFailed: [] }),
      submitUserAction: vi.fn(),
      symbol: 'ETH/USDT',
    };
    const svc = makeServiceWithRunner(runner);
    const adapter = {
      getPosition: vi.fn().mockResolvedValue({ symbol: 'ETH/USDT', baseAssetQty: -3.877, entryPrice: 1680 }),
      closePosition: vi.fn().mockResolvedValue({ orderId: 'force-close-1' }),
    };
    (svc as any).sessionAdapterMap.set('RC1', adapter);

    const p = svc.stopBot('RC1');
    await vi.advanceTimersByTimeAsync(60_000);
    await p;

    expect(adapter.getPosition).toHaveBeenCalledWith('ETH/USDT');
    expect(adapter.closePosition).toHaveBeenCalledWith('ETH/USDT', 'SHORT');
  });

  it('stopBot 交易所无残留持仓时不触发强平', async () => {
    const runner = {
      requestLiquidation: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue({ cancelFailed: [] }),
      submitUserAction: vi.fn(),
      symbol: 'ETH/USDT',
    };
    const svc = makeServiceWithRunner(runner);
    const adapter = {
      getPosition: vi.fn().mockResolvedValue({ symbol: 'ETH/USDT', baseAssetQty: 0, entryPrice: 0 }),
      closePosition: vi.fn(),
    };
    (svc as any).sessionAdapterMap.set('RC1', adapter);

    const p = svc.stopBot('RC1');
    await vi.advanceTimersByTimeAsync(60_000);
    await p;

    expect(adapter.closePosition).not.toHaveBeenCalled();
  });

  it('stopBot 确认残留但兜底强平失败时发出 alert 通知（BUG-C 健壮性:裸仓资金风险必须可见，否则退回静默裸仓）', async () => {
    const runner = {
      requestLiquidation: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue({ cancelFailed: [] }),
      submitUserAction: vi.fn(),
      symbol: 'ETH/USDT',
    };
    const svc = makeServiceWithRunner(runner);
    const adapter = {
      getPosition: vi.fn().mockResolvedValue({ symbol: 'ETH/USDT', baseAssetQty: -3.877, entryPrice: 1680 }),
      closePosition: vi.fn().mockRejectedValue(new Error('exchange 5xx')),
    };
    (svc as any).sessionAdapterMap.set('RC1', adapter);

    const p = svc.stopBot('RC1');
    await vi.advanceTimersByTimeAsync(60_000);
    await p;

    expect(adapter.closePosition).toHaveBeenCalledWith('ETH/USDT', 'SHORT');
    const notify = (svc as any).notificationService.createAndBroadcast;
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0]).toMatchObject({ type: 'alert', code: 'STOP_RESIDUAL_POSITION' });
  });

  it('stopBot 兜底强平 REST 挂死时超时返回并告警，不无限等待（BUG-C 健壮性:与清算路径一致加超时）', async () => {
    const runner = {
      requestLiquidation: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue({ cancelFailed: [] }),
      submitUserAction: vi.fn(),
      symbol: 'ETH/USDT',
    };
    const svc = makeServiceWithRunner(runner);
    const adapter = {
      getPosition: vi.fn().mockResolvedValue({ symbol: 'ETH/USDT', baseAssetQty: -3.877, entryPrice: 1680 }),
      closePosition: vi.fn().mockImplementation(() => new Promise(() => {})), // REST 挂死,永不 resolve
    };
    (svc as any).sessionAdapterMap.set('RC1', adapter);

    const p = svc.stopBot('RC1');
    await vi.advanceTimersByTimeAsync(120_000);
    await p; // 不挂死即证明超时生效

    const notify = (svc as any).notificationService.createAndBroadcast;
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0]).toMatchObject({ type: 'alert', code: 'STOP_RESIDUAL_POSITION' });
  });

  it('stopBot reports residualRemains when exchange still holds position and force-close fails', async () => {
    // 黑盒契约:交易所仍持仓且兜底强平失败 → 返回值标记 residualRemains=true，调用方据此设告警码。
    const runner = {
      requestLiquidation: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue({ cancelFailed: [] }),
      submitUserAction: vi.fn(),
      symbol: 'ETH/USDT',
    };
    const svc = makeServiceWithRunner(runner);
    const adapter = {
      getPosition: vi.fn().mockResolvedValue({
        baseAssetQty: 3.8, entryPrice: 100, unrealizedPnl: 0, leverage: 1, symbol: 'ETH/USDT',
      }),
      closePosition: vi.fn().mockRejectedValue(new Error('exchange 5xx')),
    };
    (svc as any).sessionAdapterMap.set('RC1', adapter);

    const p = svc.stopBot('RC1');
    await vi.advanceTimersByTimeAsync(120_000);
    const outcome = await p;

    expect(outcome.residualRemains).toBe(true);
  });

  it('stopBot reports clean outcome when liquidation completes and no residual', async () => {
    const runner = {
      requestLiquidation: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue({ cancelFailed: [] }),
      submitUserAction: vi.fn(),
      symbol: 'ETH/USDT',
    };
    const svc = makeServiceWithRunner(runner);
    const adapter = {
      getPosition: vi.fn().mockResolvedValue({
        baseAssetQty: 0, entryPrice: 0, unrealizedPnl: 0, leverage: 1, symbol: 'ETH/USDT',
      }),
      closePosition: vi.fn(),
    };
    (svc as any).sessionAdapterMap.set('RC1', adapter);

    const p = svc.stopBot('RC1');
    await vi.advanceTimersByTimeAsync(60_000);
    const outcome = await p;

    expect(outcome).toEqual({ liquidationTimedOut: false, residualRemains: false });
  });

  it('stopBot 清算超时（挂死）仍兜底停止 runner，不无限等待', async () => {
    const runner = {
      requestLiquidation: vi.fn().mockImplementation(() => new Promise(() => {})), // 永不 resolve
      stop: vi.fn().mockResolvedValue({ cancelFailed: [] }),
      submitUserAction: vi.fn(),
    };
    const svc = makeServiceWithRunner(runner);

    const p = svc.stopBot('RC1');
    await vi.advanceTimersByTimeAsync(60_000);
    await p;

    expect(runner.stop).toHaveBeenCalledTimes(1);
  });
});

describe('TradingEngineService.refreshAllSnapshots 停止态账户持仓可见性（BUG-A）', () => {
  // 黑盒契约:无 runner 在跑的账户,其按需快照必须按该账户机器人的 symbol
  // 拉取交易所实时持仓——否则交易所残留仓位会被显示为空仓,误导用户。
  it('对未覆盖账户按其机器人 symbol 调用 fetchOnDemand,而非空数组', async () => {
    const fetchOnDemand = vi.fn().mockResolvedValue({
      credentialId: 'cred-1',
      totalEquity: 0,
      totalWalletBalance: 0,
      availableUsdt: 0,
      marginUsed: 0,
      positions: [],
      updatedAt: 0,
    });
    const mockPrisma = {
      exchangeAccount: {
        findMany: vi.fn().mockResolvedValue([{ id: 'cred-1', exchangeId: 'okx', isActive: true }]),
      },
      robot: {
        findMany: vi.fn().mockResolvedValue([
          { accountId: 'cred-1', symbol: 'ETH/USDT' },
          { accountId: 'cred-1', symbol: 'ETH/USDT' }, // 同 symbol 多机器人,需去重
        ]),
      },
    };
    const mockAccountSnapshot = {
      getAllSnapshots: vi.fn().mockReturnValue([]), // 无在跑 runner,内存快照为空
      fetchOnDemand,
      setOnChanged: vi.fn(),
    };
    const mockCredentialService = {
      findOneWithSecrets: vi.fn().mockResolvedValue({
        id: 'cred-1',
        exchangeId: 'okx',
        accountId: 'acct-1',
        apiKey: 'k',
        apiSecret: 's',
        passphrase: 'p',
      }),
    };
    const mockAdapterFactory = {
      createAdapter: vi.fn().mockReturnValue({
        exchangeId: 'okx',
        accountId: 'acct-1',
      }),
    };

    const svc = new TradingEngineService(
      mockPrisma as any,
      mockAdapterFactory as any,
      mockCredentialService as any,
      {} as any,
      {} as any,
      mockAccountSnapshot as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await svc.refreshAllSnapshots();

    expect(fetchOnDemand).toHaveBeenCalledTimes(1);
    const [credId, , symbols] = fetchOnDemand.mock.calls[0];
    expect(credId).toBe('cred-1');
    expect(symbols).toEqual(['ETH/USDT']);
  });
});

describe('TradingEngineService.captureStopSnapshot — 停止收尾一次性 REST 快照抓取', () => {
  // 黑盒契约:不依赖会随生命周期 stopPolling 的轮询器,现造 adapter 一次性拉取该账户
  // 快照,返回指定 symbol 的持仓(无则 null);拉取失败抛出,由调用方记 SNAPSHOT_UNAVAILABLE。
  function makeSvc(fetchOnDemand: ReturnType<typeof vi.fn>) {
    const mockCredentialService = {
      findOneWithSecrets: vi.fn().mockResolvedValue({
        id: 'cred-1',
        exchangeId: 'binance',
        accountId: 'a',
        apiKey: 'k',
        apiSecret: 's',
        passphrase: null,
      }),
    };
    const mockAdapterFactory = { createAdapter: vi.fn().mockReturnValue({}) };
    const mockAccountSnapshot = { fetchOnDemand, setOnChanged: vi.fn() };

    return new TradingEngineService(
      {} as any,
      mockAdapterFactory as any,
      mockCredentialService as any,
      {} as any,
      {} as any,
      mockAccountSnapshot as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
  }

  const matchingPosition = {
    symbol: 'ETH/USDT',
    side: 'LONG' as const,
    qty: 2,
    entryPrice: 100,
    markPrice: 100,
    unrealizedPnl: 5,
    leverage: 1,
  };

  it('captureStopSnapshot returns the matching symbol position from a one-shot fetch', async () => {
    const fetchOnDemand = vi.fn().mockResolvedValue({
      credentialId: 'cred-1',
      totalEquity: 0,
      totalWalletBalance: 0,
      availableUsdt: 0,
      marginUsed: 0,
      updatedAt: 123,
      positions: [matchingPosition],
    });
    const svc = makeSvc(fetchOnDemand);

    await expect(svc.captureStopSnapshot('cred-1', 'ETH/USDT')).resolves.toEqual(matchingPosition);
  });

  it('captureStopSnapshot returns null when symbol is flat (no matching position)', async () => {
    const fetchOnDemand = vi.fn().mockResolvedValue({
      credentialId: 'cred-1',
      totalEquity: 0,
      totalWalletBalance: 0,
      availableUsdt: 0,
      marginUsed: 0,
      updatedAt: 123,
      positions: [],
    });
    const svc = makeSvc(fetchOnDemand);

    await expect(svc.captureStopSnapshot('cred-1', 'ETH/USDT')).resolves.toBeNull();
  });

  it('captureStopSnapshot throws (caller treats as SNAPSHOT_UNAVAILABLE) when fetch fails', async () => {
    const fetchOnDemand = vi.fn().mockRejectedValue(new Error('REST down'));
    const svc = makeSvc(fetchOnDemand);

    await expect(svc.captureStopSnapshot('cred-1', 'ETH/USDT')).rejects.toThrow();
  });
});

describe('TradingEngineService — Run.state 跟随 FSM 写回（domain-guide §2.3）', () => {
  function makeSvc(runRow: Record<string, unknown> = { id: 'run-id', runCode: 'RC1', state: 'RUNNING', endedAt: null }) {
    const update = vi.fn().mockResolvedValue({});
    const findUnique = vi.fn().mockResolvedValue(runRow);
    const prisma = { run: { findUnique, update } };
    const svc = new TradingEngineService(
      prisma as any, {} as any, {} as any, {} as any, {} as any,
      { stopPolling: vi.fn(), ensurePolling: vi.fn(), setOnChanged: vi.fn() } as any, {} as any,
      {} as any, {} as any, { createAndBroadcast: vi.fn().mockResolvedValue({}) } as any,
    );
    return { svc, update, findUnique };
  }

  // W1：pauseBot → Run.state 落 PAUSED
  it('W1: pauseBot writes Run.state = PAUSED', async () => {
    const { svc, update } = makeSvc({ id: 'run-id', runCode: 'RC1', state: 'RUNNING', endedAt: null });
    (svc as any).runners.set('RC1', { submitUserAction: vi.fn() });
    await svc.pauseBot('RC1');
    expect(update).toHaveBeenCalledWith({ where: { id: 'run-id' }, data: { state: 'PAUSED' } });
  });

  // W2b：空仓恢复时 FSM 实际转 TRAILING_ENTRY，写回必须落 TRAILING_ENTRY（非 RUNNING）
  it('W2b: syncRunStateFromFsm(TRAILING_ENTRY) writes Run.state = TRAILING_ENTRY (not RUNNING)', async () => {
    const { svc, update } = makeSvc({ id: 'run-id', runCode: 'RC1', state: 'RUNNING', endedAt: null });
    await (svc as any).syncRunStateFromFsm('RC1', 'TRAILING_ENTRY');
    expect(update).toHaveBeenCalledWith({ where: { id: 'run-id' }, data: { state: 'TRAILING_ENTRY' } });
  });

  // W3：有仓恢复时 FSM 转 RUNNING，写回落 RUNNING
  it('W3: syncRunStateFromFsm(RUNNING) writes Run.state = RUNNING', async () => {
    const { svc, update } = makeSvc({ id: 'run-id', runCode: 'RC1', state: 'PAUSED', endedAt: null });
    await (svc as any).syncRunStateFromFsm('RC1', 'RUNNING');
    expect(update).toHaveBeenCalledWith({ where: { id: 'run-id' }, data: { state: 'RUNNING' } });
  });

  // W4：同一 FSM 状态重复触发 → 只写库一次（内存去重）
  it('W4: repeated same FSM kind persists only once (dedup)', async () => {
    const { svc, update } = makeSvc({ id: 'run-id', runCode: 'RC1', state: 'RUNNING', endedAt: null });
    await (svc as any).syncRunStateFromFsm('RC1', 'TRAILING_ENTRY');
    await (svc as any).syncRunStateFromFsm('RC1', 'TRAILING_ENTRY');
    await (svc as any).syncRunStateFromFsm('RC1', 'TRAILING_ENTRY');
    expect(update).toHaveBeenCalledTimes(1);
  });

  // W5：终态（endedAt 已写）不被非终态写回覆盖
  it('W5: does not overwrite a terminal run (endedAt set)', async () => {
    const { svc, update } = makeSvc({ id: 'run-id', runCode: 'RC1', state: 'LIQUIDATED', endedAt: new Date() });
    await (svc as any).syncRunStateFromFsm('RC1', 'RUNNING');
    expect(update).not.toHaveBeenCalled();
  });
});

describe('buildOrderCreateData', () => {
  it('把 PlacedOrder.tif 映射进 Order 创建数据（route 数据落库）', () => {
    const placed: PlacedOrder = {
      runCode: 'RC1',
      clientOrderId: 'c1',
      exchangeOrderId: 'ex1',
      side: 'BUY',
      qty: 0.01,
      price: 2100,
      gridIndex: 3,
      orderType: 'GRID_BUY',
      isAlgo: false,
      preOrderPosition: 0,
      isEntry: false,
      tif: 'POC',
    };

    const data = buildOrderCreateData(placed, 'run1');

    expect(data).toMatchObject({ runId: 'run1', tif: 'POC', clientOrderId: 'c1' });
  });

  it('tif 缺省(平仓单)时写入 null，而不是 undefined 被 Prisma 忽略', () => {
    const placed: PlacedOrder = {
      runCode: 'RC1',
      clientOrderId: '',
      exchangeOrderId: 'ex2',
      side: 'SELL',
      qty: 0.01,
      price: 2000,
      gridIndex: -1,
      orderType: 'CLOSE',
      isAlgo: false,
      preOrderPosition: 0.01,
      isEntry: false,
    };

    const data = buildOrderCreateData(placed, 'run1');

    expect(data.tif).toBeNull();
  });
});

describe('TradingEngineService 触发式单单自愈（onOwnFillSettled）', () => {
  function makeSvc() {
    const prismaFillFindFirst = vi.fn();
    const mockPrisma = { fill: { findFirst: prismaFillFindFirst } };
    const reconcileRun = vi.fn().mockResolvedValue({ newFillsCount: 0 });
    const svc = new TradingEngineService(
      mockPrisma as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
      { ingest: vi.fn().mockResolvedValue(true) } as any,
      { reconcileRun } as any,
      { createAndBroadcast: vi.fn().mockResolvedValue({}) } as any,
    );
    const adapter = { id: 'adapter-1' };
    const runner = { symbol: 'ETH/USDT' };
    (svc as any).runners.set('RC1', runner);
    (svc as any).sessionAdapterMap.set('RC1', adapter);
    return { svc, prismaFillFindFirst, reconcileRun, adapter };
  }

  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('宽限期后 Fill 表仍无对应行 → 立即调用 reconcileRun', async () => {
    const { svc, prismaFillFindFirst, reconcileRun, adapter } = makeSvc();
    prismaFillFindFirst.mockResolvedValue(null);

    (svc as any).scheduleOwnFillCheck('RC1', 'client-1');
    await vi.advanceTimersByTimeAsync(5000);

    expect(reconcileRun).toHaveBeenCalledWith('RC1', 'ETH/USDT', adapter);
  });

  it('宽限期内多次触发只调用一次 reconcileRun（同一 runCode 去重）', async () => {
    const { svc, prismaFillFindFirst, reconcileRun } = makeSvc();
    prismaFillFindFirst.mockResolvedValue(null);

    (svc as any).scheduleOwnFillCheck('RC1', 'client-1');
    (svc as any).scheduleOwnFillCheck('RC1', 'client-2');
    await vi.advanceTimersByTimeAsync(5000);

    expect(reconcileRun).toHaveBeenCalledTimes(1);
  });

  it('宽限期到点前 Fill 表已经出现对应行 → 不调用 reconcileRun', async () => {
    const { svc, prismaFillFindFirst, reconcileRun } = makeSvc();
    prismaFillFindFirst.mockResolvedValue({ id: 'fill-1' });

    (svc as any).scheduleOwnFillCheck('RC1', 'client-1');
    await vi.advanceTimersByTimeAsync(5000);

    expect(reconcileRun).not.toHaveBeenCalled();
  });
});

describe('TradingEngineService 周期性持仓漂移检测（checkPositionDrift）', () => {
  function makeSvc() {
    const runFindUnique = vi.fn();
    const runUpdate = vi.fn().mockResolvedValue({});
    const mockPrisma = { run: { findUnique: runFindUnique, update: runUpdate } };
    const createAndBroadcast = vi.fn().mockResolvedValue({});
    const svc = new TradingEngineService(
      mockPrisma as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
      {} as any, {} as any,
      { createAndBroadcast } as any,
    );
    return { svc, runFindUnique, runUpdate, createAndBroadcast };
  }

  it('单次漂移观测（可能是过期快照）→ 不重锚不通知', async () => {
    const { svc, runFindUnique, runUpdate, createAndBroadcast } = makeSvc();
    runFindUnique.mockResolvedValue({ pnlSignedPosition: 0.475, configSnapshot: { mainGridPortionSize: 0.05 } });
    const runner = { getState: () => ({ position: { baseAssetQty: 0.55, entryPrice: 1900 } }) } as any;

    await (svc as any).checkPositionDrift('RC1', runner);

    expect(runUpdate).not.toHaveBeenCalled();
    expect(createAndBroadcast).not.toHaveBeenCalled();
  });

  it('连续两次 sweep 都观测到同一漂移 → 自愈重锚台账并通知（POSITION_LEDGER_REANCHORED）', async () => {
    const { svc, runFindUnique, runUpdate, createAndBroadcast } = makeSvc();
    runFindUnique.mockResolvedValue({ id: 'run-1', pnlSignedPosition: 0.475, configSnapshot: { mainGridPortionSize: 0.05 } });
    const runner = { getState: () => ({ position: { baseAssetQty: 0.55, entryPrice: 1900 } }) } as any;

    await (svc as any).checkPositionDrift('RC1', runner);
    await (svc as any).checkPositionDrift('RC1', runner);

    expect(runUpdate).toHaveBeenCalledWith({
      where: { id: 'run-1' },
      data: { pnlSignedPosition: 0.55, pnlAvgCost: 1900 },
    });
    expect(createAndBroadcast).toHaveBeenCalledTimes(1);
    expect(createAndBroadcast).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'POSITION_LEDGER_REANCHORED', type: 'alert' }),
    );
  });

  it('差值在阈值内 → 不重锚不通知', async () => {
    const { svc, runFindUnique, runUpdate, createAndBroadcast } = makeSvc();
    runFindUnique.mockResolvedValue({ pnlSignedPosition: 0.52, configSnapshot: { mainGridPortionSize: 0.05 } });
    const runner = { getState: () => ({ position: { baseAssetQty: 0.55, entryPrice: 1900 } }) } as any;

    await (svc as any).checkPositionDrift('RC1', runner);

    expect(runUpdate).not.toHaveBeenCalled();
    expect(createAndBroadcast).not.toHaveBeenCalled();
  });

  it('同一漂移持续存在时每次确认观测都重锚（防并发成交末写者覆盖），但通知每 episode 只发一次；差值恢复后再次漂移会重新自愈', async () => {
    // code-review I1：重锚若与 ingestInner 的读-改-写竞争被覆盖，仅靠 notified 闩
    // 跳过重锚会让漂移永久静默。重锚是幂等的（写交易所真值），故每次确认都重做；
    // 幂等闩只作用于通知。
    const { svc, runFindUnique, runUpdate, createAndBroadcast } = makeSvc();
    const runner = { getState: () => ({ position: { baseAssetQty: 0.55, entryPrice: 1900 } }) } as any;

    runFindUnique.mockResolvedValue({ id: 'run-1', pnlSignedPosition: 0.475, configSnapshot: { mainGridPortionSize: 0.05 } });
    await (svc as any).checkPositionDrift('RC1', runner); // 第1次：仅计数
    await (svc as any).checkPositionDrift('RC1', runner); // 第2次：确认漂移，重锚+通知
    await (svc as any).checkPositionDrift('RC1', runner); // 第3次：仍漂移，再次重锚（防覆盖），不重复通知
    expect(runUpdate).toHaveBeenCalledTimes(2);
    expect(createAndBroadcast).toHaveBeenCalledTimes(1);

    runFindUnique.mockResolvedValue({ id: 'run-1', pnlSignedPosition: 0.55, configSnapshot: { mainGridPortionSize: 0.05 } });
    await (svc as any).checkPositionDrift('RC1', runner); // 恢复：重置计数与告警标记

    runFindUnique.mockResolvedValue({ id: 'run-1', pnlSignedPosition: 0.475, configSnapshot: { mainGridPortionSize: 0.05 } });
    await (svc as any).checkPositionDrift('RC1', runner); // 重新漂移第1次：仅计数
    expect(createAndBroadcast).toHaveBeenCalledTimes(1);
    await (svc as any).checkPositionDrift('RC1', runner); // 重新漂移第2次：再次自愈
    expect(runUpdate).toHaveBeenCalledTimes(3);
    expect(createAndBroadcast).toHaveBeenCalledTimes(2);
  });
});

describe('TradingEngineService.reconcileRobot', () => {
  function makeSvc() {
    const robotFindUnique = vi.fn();
    const runFindFirst = vi.fn();
    const runFindUnique = vi.fn();
    const mockPrisma = {
      robot: { findUnique: robotFindUnique },
      run: { findFirst: runFindFirst, findUnique: runFindUnique },
    };
    const reconcileRun = vi.fn();
    const svc = new TradingEngineService(
      mockPrisma as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
      {} as any,
      { reconcileRun } as any,
      { createAndBroadcast: vi.fn().mockResolvedValue({}) } as any,
    );
    return { svc, robotFindUnique, runFindFirst, runFindUnique, reconcileRun };
  }

  it('机器人不存在 → 抛 NotFoundException', async () => {
    const { svc, robotFindUnique } = makeSvc();
    robotFindUnique.mockResolvedValue(null);
    await expect(svc.reconcileRobot('nope')).rejects.toThrow(NotFoundException);
  });

  it('机器人没有活跃箱体 → 抛 BadRequestException', async () => {
    const { svc, robotFindUnique } = makeSvc();
    robotFindUnique.mockResolvedValue({ id: 'r1', symbol: 'ETH/USDT', activeBoxId: null });
    await expect(svc.reconcileRobot('r1')).rejects.toThrow(BadRequestException);
  });

  it('没有未结束的 Run → 抛 BadRequestException', async () => {
    const { svc, robotFindUnique, runFindFirst } = makeSvc();
    robotFindUnique.mockResolvedValue({ id: 'r1', symbol: 'ETH/USDT', activeBoxId: 'b1' });
    runFindFirst.mockResolvedValue(null);
    await expect(svc.reconcileRobot('r1')).rejects.toThrow(BadRequestException);
  });

  it('runner 不在内存中运行（sessionAdapterMap 没有对应 adapter）→ 抛 BadRequestException', async () => {
    const { svc, robotFindUnique, runFindFirst } = makeSvc();
    robotFindUnique.mockResolvedValue({ id: 'r1', symbol: 'ETH/USDT', activeBoxId: 'b1' });
    runFindFirst.mockResolvedValue({ id: 'run1', runCode: 'RC1' });
    await expect(svc.reconcileRobot('r1')).rejects.toThrow(BadRequestException);
  });

  it('reconcile 成功后返回新增成交数与双侧持仓对比', async () => {
    const { svc, robotFindUnique, runFindFirst, runFindUnique, reconcileRun } = makeSvc();
    robotFindUnique.mockResolvedValue({ id: 'r1', symbol: 'ETH/USDT', activeBoxId: 'b1' });
    runFindFirst.mockResolvedValue({ id: 'run1', runCode: 'RC1' });
    runFindUnique.mockResolvedValue({ id: 'run1', runCode: 'RC1', pnlSignedPosition: 0.55, configSnapshot: { mainGridPortionSize: 0.05 } });
    reconcileRun.mockResolvedValue({ newFillsCount: 1 });
    const adapter = { getPosition: vi.fn().mockResolvedValue({ baseAssetQty: 0.55 }) };
    (svc as any).sessionAdapterMap.set('RC1', adapter);

    const result = await svc.reconcileRobot('r1');

    expect(reconcileRun).toHaveBeenCalledWith('RC1', 'ETH/USDT', adapter);
    expect(result).toEqual({ newFillsCount: 1, dbPosition: 0.55, exchangePosition: 0.55, positionMatches: true });
  });
});

describe('TradingEngineService.stopBot — 平仓成交最终对账（P0: 用户停止后平仓成交不得丢失）', () => {
  function makeSvc() {
    const reconcileRun = vi.fn().mockResolvedValue({ newFillsCount: 0 });
    const orderCreate = vi.fn().mockResolvedValue({});
    const prisma = {
      run: {
        findUnique: vi.fn().mockResolvedValue({ id: 'run-id-1', runCode: 'RC1', endedAt: null }),
        update: vi.fn().mockResolvedValue({}),
      },
      order: { create: orderCreate },
    };
    const svc = new TradingEngineService(
      prisma as any, {} as any, {} as any, {} as any, {} as any,
      { stopPolling: vi.fn(), ensurePolling: vi.fn() } as any, {} as any,
      { clearRealizedPnl: vi.fn() } as any,
      { reconcileRun } as any,
      { createAndBroadcast: vi.fn().mockResolvedValue({}) } as any,
    );
    (svc as any).runners.set('RC1', {
      requestLiquidation: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue({ cancelFailed: [] }),
      submitUserAction: vi.fn(),
      symbol: 'ETH/USDT',
    });
    return { svc, reconcileRun, orderCreate };
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('stopBot 在 run 终态后用退出前的 adapter 做最终成交对账（平仓成交不因 sweep 停止而丢失）', async () => {
    // 用户停止路径与自动终态同责：run 终态后退出周期 sweep，closePosition 的成交
    // 若 WS 没收到就再无机会入库（2026-07-27 OKX 实测：用户关停 2.316 ETH 平仓成交
    // 丢失 → 台账持仓虚高 2.32、成本池未重置、后续 realizedPnl 失真约 -57u）。
    const { svc, reconcileRun } = makeSvc();
    const adapter = { getPosition: vi.fn().mockResolvedValue({ baseAssetQty: 0 }) };
    (svc as any).sessionAdapterMap.set('RC1', adapter);

    const p = svc.stopBot('RC1');
    await vi.advanceTimersByTimeAsync(60_000);
    await p;

    expect(reconcileRun).toHaveBeenCalledWith('RC1', 'ETH/USDT', adapter);
  });

  it('stopBot 最终对账延迟二次执行：关闭 close 单落库 fire-and-forget 与 REST 可见性竞态窗口', async () => {
    const { svc, reconcileRun } = makeSvc();
    const adapter = { getPosition: vi.fn().mockResolvedValue({ baseAssetQty: 0 }) };
    (svc as any).sessionAdapterMap.set('RC1', adapter);

    const p = svc.stopBot('RC1');
    await vi.advanceTimersByTimeAsync(60_000);
    await p;
    // stopBot 返回时立即对账应已完成一次，延迟补拉是第二次
    expect(reconcileRun).toHaveBeenCalledTimes(2);
    expect(reconcileRun).toHaveBeenLastCalledWith('RC1', 'ETH/USDT', adapter);
  });

  it('stopBot 兜底强平时为强平单落库 CLOSE Order 行（否则强平成交永远无法归属本 run）', async () => {
    // forceCloseResidualAfterStop 直接调 adapter.closePosition，不经 runner 的
    // emitCloseOrderPlaced：没有 Order 行，resolveOrder 匹配不上，即使对账拉到
    // 强平成交也只能丢弃（盈亏与持仓永久漂移）。
    const { svc, orderCreate } = makeSvc();
    const adapter = {
      getPosition: vi.fn().mockResolvedValue({ symbol: 'ETH/USDT', baseAssetQty: -3.877, entryPrice: 1680 }),
      closePosition: vi.fn().mockResolvedValue({ orderId: 'force-close-1', filledQty: 3.877, avgFillPrice: 1679.5 }),
    };
    (svc as any).sessionAdapterMap.set('RC1', adapter);

    const p = svc.stopBot('RC1');
    await vi.advanceTimersByTimeAsync(60_000);
    await p;

    expect(adapter.closePosition).toHaveBeenCalledWith('ETH/USDT', 'SHORT');
    expect(orderCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        runId: 'run-id-1',
        exchangeOrderId: 'force-close-1',
        orderType: 'CLOSE',
        side: 'BUY', // 空头残留 → 买入平仓
      }),
    });
  });

  it('stopBot 清理该 run 的漂移观测状态（runCode 复用时不残留上 episode 计数，code-review M5）', async () => {
    // runCode 跨重启复用：停止时若漂移 episode 未结束，残留的 consecutive=1 会让
    // 重启后的首次观测立即确认漂移（绕过双观测防过期快照保护）。
    const { svc } = makeSvc();
    const adapter = { getPosition: vi.fn().mockResolvedValue({ baseAssetQty: 0 }) };
    (svc as any).sessionAdapterMap.set('RC1', adapter);
    (svc as any).driftObservations.set('RC1', { consecutive: 1, alerted: false });

    const p = svc.stopBot('RC1');
    await vi.advanceTimersByTimeAsync(60_000);
    await p;

    expect((svc as any).driftObservations.has('RC1')).toBe(false);
  });
});

describe('TradingEngineService.startBot — 复用存量 run 时按交易所持仓校正 PnL 状态（P1）', () => {
  const configRecord = {
    id: 'cfg1', accountId: 'cred1', symbol: 'ETH/USDT', direction: 'LONG',
    takeProfitPrice: 2200, mainGridCount: 78, mainGridStep: 5, mainGridPortionSize: 0.05,
    leverage: 25, stopLossGridCount: 4, stopLossGridStep: 2, isolationStep: null,
    reorderThreshold: 0.0002, trailingEntry: false, trailingCallbackRate: null, entryPrice: null,
  };

  function makeSvc(opts: { run: Record<string, unknown> | null; position?: unknown; positionError?: Error }) {
    const existingRun = opts.run;
    let currentRun = existingRun;
    const runUpdate = vi.fn().mockImplementation((args: { data: Record<string, unknown> }) => {
      currentRun = currentRun ? { ...currentRun, ...args.data } : currentRun;
      return Promise.resolve(currentRun);
    });
    const runCreate = vi.fn().mockImplementation((args: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: 'run-new', ...args.data }),
    );
    const prisma = {
      box: { findUnique: vi.fn().mockResolvedValue(configRecord) },
      run: {
        findUnique: vi.fn().mockImplementation(() => Promise.resolve(currentRun)),
        update: runUpdate,
        create: runCreate,
      },
    };
    const legacyAdapter = {
      fetchPosition: opts.positionError
        ? vi.fn().mockRejectedValue(opts.positionError)
        : vi.fn().mockResolvedValue(opts.position),
    };
    const adapterFactory = { createAdapter: vi.fn().mockReturnValue(legacyAdapter) };
    const credentialService = {
      findOneWithSecrets: vi.fn().mockResolvedValue({
        isActive: true, exchangeId: 'okx', accountId: 'a1', apiKey: 'k', apiSecret: 's', passphrase: null,
      }),
    };
    const notify = { createAndBroadcast: vi.fn().mockResolvedValue({}) };
    const reconcileRun = vi.fn().mockResolvedValue({ newFillsCount: 0 });
    const svc = new TradingEngineService(
      prisma as any, adapterFactory as any, credentialService as any, {} as any, {} as any,
      {} as any, {} as any,
      { seedRealizedPnl: vi.fn(), clearRealizedPnl: vi.fn() } as any,
      { reconcileRun } as any, notify as any,
    );
    const startRunner = vi.fn().mockResolvedValue({ fake: 'runner' });
    (svc as any).startRunner = startRunner;
    return {
      svc, runUpdate, runCreate, notify, startRunner, legacyAdapter, reconcileRun,
      /** 模拟 reconcile 补录成交后台账回到交易所真值 */
      applyReconciledLedger: (qty: number, avgCost: number) => {
        if (currentRun) currentRun = { ...currentRun, pnlSignedPosition: qty, pnlAvgCost: avgCost };
      },
    };
  }

  it('存量 run 台账持仓与交易所漂移时，启动前以交易所为准重锚 pnlSignedPosition/pnlAvgCost', async () => {
    // 2026-07-27 OKX 实测：停止丢失平仓成交后重启，台账 4.716 vs 交易所 2.35，
    // 旧成本（1966.64）污染后续所有卖出的已实现盈亏，账面失真约 -57u。
    const { svc, runUpdate, notify, startRunner } = makeSvc({
      run: {
        id: 'run-1', runCode: 'RC1', state: 'STOPPED', endedAt: new Date(),
        pnlSignedPosition: 4.716, pnlAvgCost: 1921.09, realizedPnl: -139,
      },
      position: { symbol: 'ETH/USDT', side: 'long', qty: 2.35, avgCost: 1959.72, unrealizedPnl: 0, leverage: 25, marginType: 'cross' },
    });

    await svc.startBot('cfg1', 'RC1');

    expect(runUpdate).toHaveBeenCalledWith({
      where: { id: 'run-1' },
      data: expect.objectContaining({ pnlSignedPosition: 2.35, pnlAvgCost: 1959.72 }),
    });
    expect(notify.createAndBroadcast).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'POSITION_LEDGER_REANCHORED' }),
    );
    expect(startRunner).toHaveBeenCalled();
  });

  it('偏差在一个格子以内时不改动台账（正常启停的微差免打扰）', async () => {
    const { svc, runUpdate, notify, startRunner } = makeSvc({
      run: {
        id: 'run-1', runCode: 'RC1', state: 'STOPPED', endedAt: new Date(),
        pnlSignedPosition: 2.38, pnlAvgCost: 1920, realizedPnl: -10,
      },
      position: { symbol: 'ETH/USDT', side: 'long', qty: 2.35, avgCost: 1959.72, unrealizedPnl: 0, leverage: 25, marginType: 'cross' },
    });

    await svc.startBot('cfg1', 'RC1');

    expect(runUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ pnlSignedPosition: expect.any(Number) }) }),
    );
    expect(notify.createAndBroadcast).not.toHaveBeenCalledWith(
      expect.objectContaining({ code: 'POSITION_LEDGER_REANCHORED' }),
    );
    expect(startRunner).toHaveBeenCalled();
  });

  it('交易所持仓查询失败时仅告警不阻塞启动', async () => {
    const { svc, runUpdate, startRunner } = makeSvc({
      run: {
        id: 'run-1', runCode: 'RC1', state: 'STOPPED', endedAt: new Date(),
        pnlSignedPosition: 4.716, pnlAvgCost: 1921.09, realizedPnl: -139,
      },
      positionError: new Error('exchange 5xx'),
    });

    await svc.startBot('cfg1', 'RC1');

    expect(runUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ pnlSignedPosition: expect.any(Number) }) }),
    );
    expect(startRunner).toHaveBeenCalled();
  });

  it('新建 run 不做重锚（PnL 状态已由 BUG-04 的交易所持仓 seed 直接写入）', async () => {
    const { svc, runUpdate, runCreate, startRunner } = makeSvc({
      run: null,
      position: { symbol: 'ETH/USDT', side: 'long', qty: 2.35, avgCost: 1959.72, unrealizedPnl: 0, leverage: 25, marginType: 'cross' },
    });

    await svc.startBot('cfg1', 'RC1');

    expect(runCreate).toHaveBeenCalled();
    expect(runUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ pnlSignedPosition: expect.any(Number) }) }),
    );
    expect(startRunner).toHaveBeenCalled();
  });

  it('复用存量 run 启动时先做成交对账（补录停止时丢失的平仓成交），再按需重锚（code-review 建议）', async () => {
    // 直接重锚而不先对账：迟到的平仓成交之后被 sweep 补录时，会在重锚后的干净
    // 状态上重复应用（空仓 → phantom 空仓）。对账优先让真实成交先入账，
    // 重锚退化为兜底。对账也必须先于重锚执行。
    const order: string[] = [];
    const { svc, runUpdate, reconcileRun, startRunner } = makeSvc({
      run: {
        id: 'run-1', runCode: 'RC1', state: 'STOPPED', endedAt: new Date(),
        pnlSignedPosition: 4.716, pnlAvgCost: 1921.09, realizedPnl: -139,
      },
      position: { symbol: 'ETH/USDT', side: 'long', qty: 2.35, avgCost: 1959.72, unrealizedPnl: 0, leverage: 25, marginType: 'cross' },
    });
    reconcileRun.mockImplementation(async () => {
      order.push('reconcile');
      return { newFillsCount: 0 };
    });
    runUpdate.mockImplementation((args: { data: Record<string, unknown> }) => {
      if ('pnlSignedPosition' in args.data) order.push('reanchor');
      return Promise.resolve({ ...args.data });
    });

    await svc.startBot('cfg1', 'RC1');

    expect(reconcileRun).toHaveBeenCalledWith('RC1', 'ETH/USDT', expect.anything());
    expect(order).toEqual(['reconcile', 'reanchor']);
    expect(startRunner).toHaveBeenCalled();
  });

  it('启动前对账已把台账拉回交易所真值时，不再重锚（真实成交入账优于盲重置）', async () => {
    const { svc, runUpdate, notify, reconcileRun, applyReconciledLedger } = makeSvc({
      run: {
        id: 'run-1', runCode: 'RC1', state: 'STOPPED', endedAt: new Date(),
        pnlSignedPosition: 4.716, pnlAvgCost: 1921.09, realizedPnl: -139,
      },
      position: { symbol: 'ETH/USDT', side: 'long', qty: 2.35, avgCost: 1959.72, unrealizedPnl: 0, leverage: 25, marginType: 'cross' },
    });
    reconcileRun.mockImplementation(async () => {
      applyReconciledLedger(2.35, 1959.72); // 平仓成交补录入账后，台账回到交易所真值
      return { newFillsCount: 3 };
    });

    await svc.startBot('cfg1', 'RC1');

    expect(runUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ pnlSignedPosition: expect.any(Number) }) }),
    );
    expect(notify.createAndBroadcast).not.toHaveBeenCalledWith(
      expect.objectContaining({ code: 'POSITION_LEDGER_REANCHORED' }),
    );
  });
});

describe('TradingEngineService.checkPositionDrift — 确认漂移后自愈重锚（P2）', () => {
  function makeSvc(run: Record<string, unknown>) {
    const runUpdate = vi.fn().mockResolvedValue({});
    const prisma = {
      run: {
        findUnique: vi.fn().mockResolvedValue(run),
        update: runUpdate,
      },
    };
    const notify = { createAndBroadcast: vi.fn().mockResolvedValue({}) };
    const svc = new TradingEngineService(
      prisma as any, {} as any, {} as any, {} as any, {} as any,
      {} as any, {} as any, {} as any, {} as any, notify as any,
    );
    return { svc, runUpdate, notify };
  }

  const driftedRun = {
    id: 'run-1', runCode: 'RC1', pnlSignedPosition: 4.716,
    configSnapshot: { mainGridPortionSize: 0.05 },
  };
  const driftedRunner = {
    getState: () => ({ position: { baseAssetQty: 2.35, entryPrice: 1959.72 } }),
  };

  it('首次观测到漂移只计数，不重锚不通知（过期快照活不过第二次复查）', async () => {
    const { svc, runUpdate, notify } = makeSvc(driftedRun);

    await (svc as any).checkPositionDrift('RC1', driftedRunner);

    expect(runUpdate).not.toHaveBeenCalled();
    expect(notify.createAndBroadcast).not.toHaveBeenCalled();
  });

  it('连续第二次观测到漂移 → 以交易所为准重锚台账持仓/成本并通知', async () => {
    // 旧行为只发 POSITION_DRIFT_DETECTED 告警、机器人照跑（2026-07-27 OKX 连发 8 次
    // 无人处理，台账虚高 2.32 ETH 持续 3 天）。确认漂移后应自愈重锚。
    const { svc, runUpdate, notify } = makeSvc(driftedRun);

    await (svc as any).checkPositionDrift('RC1', driftedRunner);
    await (svc as any).checkPositionDrift('RC1', driftedRunner);

    expect(runUpdate).toHaveBeenCalledWith({
      where: { id: 'run-1' },
      data: { pnlSignedPosition: 2.35, pnlAvgCost: 1959.72 },
    });
    expect(notify.createAndBroadcast).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'POSITION_LEDGER_REANCHORED' }),
    );
  });

  it('观测计数随差值恢复清零（单次漂移观测不重锚），可响应下一次独立漂移', async () => {
    const { svc, runUpdate, notify } = makeSvc(driftedRun);
    const okRunner = {
      getState: () => ({ position: { baseAssetQty: 4.716, entryPrice: 1921 } }),
    };

    await (svc as any).checkPositionDrift('RC1', driftedRunner); // 计数 1
    await (svc as any).checkPositionDrift('RC1', okRunner);      // 恢复 → 清零
    await (svc as any).checkPositionDrift('RC1', driftedRunner); // 重新计数 1

    expect(runUpdate).not.toHaveBeenCalled();
    expect(notify.createAndBroadcast).not.toHaveBeenCalled();
  });

  it('交易所已空仓时重锚为 0 持仓 0 成本（新会话从干净状态起算）', async () => {
    const { svc, runUpdate } = makeSvc(driftedRun);
    const flatRunner = {
      getState: () => ({ position: { baseAssetQty: 0, entryPrice: 0 } }),
    };

    await (svc as any).checkPositionDrift('RC1', flatRunner);
    await (svc as any).checkPositionDrift('RC1', flatRunner);

    expect(runUpdate).toHaveBeenCalledWith({
      where: { id: 'run-1' },
      data: { pnlSignedPosition: 0, pnlAvgCost: 0 },
    });
  });
});

describe('TradingEngineService.getMarketConstraints — 箱体保存前最小下单量预校验取数', () => {
  function makeSvc(opts: {
    credential?: { exchangeId: string; accountId: string; apiKey: string; apiSecret: string; passphrase?: string; environment: string } | null;
    getMarketInfo?: ReturnType<typeof vi.fn>;
  }) {
    const findOneWithSecrets = vi.fn().mockResolvedValue(opts.credential ?? null);
    const getMarketInfo = opts.getMarketInfo ?? vi.fn().mockResolvedValue({ minQty: 0.001, minNotional: 20, stepSize: 0.001 });
    const createAdapter = vi.fn().mockReturnValue({ getMarketInfo });

    const svc = new TradingEngineService(
      {} as any,
      { createAdapter } as any,
      { findOneWithSecrets } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    return { svc, findOneWithSecrets, createAdapter, getMarketInfo };
  }

  const credential = {
    exchangeId: 'binance', accountId: 'acc1', apiKey: 'k', apiSecret: 's',
    passphrase: undefined, environment: 'live',
  };

  it('正常拉取时返回 minQty/minNotional/stepSize', async () => {
    const { svc, getMarketInfo } = makeSvc({ credential });

    const result = await svc.getMarketConstraints('cred-1', 'ETH/USDT');

    expect(getMarketInfo).toHaveBeenCalledWith('ETH/USDT');
    expect(result).toEqual({ minQty: 0.001, minNotional: 20, stepSize: 0.001 });
  });

  it('凭证不存在时降级返回 null（不阻断箱体保存）', async () => {
    const { svc } = makeSvc({ credential: null });

    const result = await svc.getMarketConstraints('cred-missing', 'ETH/USDT');

    expect(result).toBeNull();
  });

  it('getMarketInfo 拉取失败（网络/鉴权等不确定错误）时降级返回 null', async () => {
    const { svc } = makeSvc({
      credential,
      getMarketInfo: vi.fn().mockRejectedValue(new Error('network')),
    });

    const result = await svc.getMarketConstraints('cred-1', 'ETH/USDT');

    expect(result).toBeNull();
  });
});
