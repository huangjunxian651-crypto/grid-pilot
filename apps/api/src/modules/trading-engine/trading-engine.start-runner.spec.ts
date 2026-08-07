import { describe, it, expect, vi, beforeEach } from 'vitest';

// startRunner 直接 `new GridBotRunner(...)` + 一组协作者；mock 它们以隔离测试
// 「轮询接线」这段直线代码（成功→set 三 map + reconcile；失败→回滚 + reconcile）。
// 放在独立 spec 文件，避免文件级 vi.mock 影响 trading-engine.service.spec.ts。
const { mockStart } = vi.hoisted(() => ({ mockStart: vi.fn() }));

vi.mock('./runner/grid-bot-runner', () => ({
  GridBotRunner: class {
    constructor(public config: { runCode: string; symbol: string }, _adapter: unknown, public runnerDeps: any) {}
    get symbol() {
      return this.config.symbol;
    }
    start() {
      return mockStart();
    }
    stop = vi.fn().mockResolvedValue({ cancelFailed: [] });
  },
}));
vi.mock('./fsm/bot-fsm', () => ({ BotFsm: class {} }));
vi.mock('./strategy/strategy-engine', () => ({ StrategyEngine: class {} }));
vi.mock('./execution/execution-engine', () => ({ ExecutionEngine: class { constructor(_a: unknown) {} } }));
vi.mock('./exchange-truth-service/exchange-truth.service', () => ({ ExchangeTruthService: class { constructor(_a: unknown) {} } }));
vi.mock('./reconstructor/bot-state-reconstructor', () => ({ BotStateReconstructor: class {} }));

import { TradingEngineService } from './trading-engine.service';

describe('TradingEngineService.startRunner — 轮询接线', () => {
  let ensurePolling: ReturnType<typeof vi.fn>;
  let stopPolling: ReturnType<typeof vi.fn>;

  let mockFillReconcile: { reconcileRun: ReturnType<typeof vi.fn> };
  let runUpdate: ReturnType<typeof vi.fn>;
  let runFindUnique: ReturnType<typeof vi.fn>;
  let notificationMock: { createAndBroadcast: ReturnType<typeof vi.fn> };

  let fillFindFirst: ReturnType<typeof vi.fn>;

  function makeSvc() {
    ensurePolling = vi.fn();
    stopPolling = vi.fn();
    mockFillReconcile = { reconcileRun: vi.fn().mockResolvedValue(undefined) };
    runUpdate = vi.fn().mockResolvedValue({});
    runFindUnique = vi.fn().mockResolvedValue({ id: 'run-id', runCode: 'ETHUSDT_x', state: 'PAUSED', endedAt: null, boxId: 'box-1' });
    fillFindFirst = vi.fn().mockResolvedValue(null);
    notificationMock = { createAndBroadcast: vi.fn().mockResolvedValue({}) };
    const accountSnapshot = { ensurePolling, stopPolling, setOnChanged: vi.fn() };
    const svc = new TradingEngineService(
      { run: { update: runUpdate, findUnique: runFindUnique }, fill: { findFirst: fillFindFirst } } as any, {} as any, {} as any, {} as any, {} as any,
      accountSnapshot as any, {} as any,
      { ingest: vi.fn().mockResolvedValue(undefined) } as any,
      mockFillReconcile as any,
      notificationMock as any,
    );
    return svc;
  }

  const config = { runCode: 'ETHUSDT_x', symbol: 'ETH/USDT' } as any;
  const adapter = { id: 'adapter-x', exchange: 'okx' } as any;

  beforeEach(() => vi.clearAllMocks());

  it('成功启动：写 sessionAdapterMap 并 reconcile → ensurePolling 覆盖该 symbol', async () => {
    const svc = makeSvc();
    mockStart.mockResolvedValue(undefined);

    await (svc as any).startRunner(config, adapter, 'sess-id', 'cred-1');

    expect((svc as any).runners.has('ETHUSDT_x')).toBe(true);
    expect((svc as any).sessionAdapterMap.get('ETHUSDT_x')).toBe(adapter);
    expect(ensurePolling).toHaveBeenCalledWith('cred-1', ['ETH/USDT'], adapter);
  });

  it('start 抛错：回滚三张 map 并 reconcile → 账户空则 stopPolling，且原样重抛', async () => {
    const svc = makeSvc();
    mockStart.mockRejectedValue(new Error('boom'));

    await expect(
      (svc as any).startRunner(config, adapter, 'sess-id', 'cred-1'),
    ).rejects.toThrow(/boom/);

    expect((svc as any).runners.has('ETHUSDT_x')).toBe(false);
    expect((svc as any).sessionCredentialMap.has('ETHUSDT_x')).toBe(false);
    expect((svc as any).sessionAdapterMap.has('ETHUSDT_x')).toBe(false);
    expect(stopPolling).toHaveBeenCalledWith('cred-1');
  });

  it('start 抛错：run 记录被标记结束（START_FAILED），不留垃圾 RUNNING 行', async () => {
    const svc = makeSvc();
    mockStart.mockRejectedValue(new Error('boom'));

    await expect(
      (svc as any).startRunner(config, adapter, 'sess-id', 'cred-1'),
    ).rejects.toThrow(/boom/);

    expect(runUpdate).toHaveBeenCalledWith({
      where: { id: 'sess-id' },
      data: { endedAt: expect.any(Date), state: 'STOPPED', exitReason: 'START_FAILED' },
    });
  });

  it('成功启动时不动 run 记录', async () => {
    const svc = makeSvc();
    mockStart.mockResolvedValue(undefined);

    await (svc as any).startRunner(config, adapter, 'sess-id', 'cred-1');

    expect(runUpdate).not.toHaveBeenCalled();
  });

  it('startRunner 成功后触发一次冷启动 REST 对账 reconcileRun(runCode, symbol, adapter)', async () => {
    const svc = makeSvc();
    mockStart.mockResolvedValue(undefined);

    await (svc as any).startRunner(config, adapter, 'sess-id', 'cred-1');

    expect(mockFillReconcile.reconcileRun).toHaveBeenCalledWith('ETHUSDT_x', 'ETH/USDT', adapter);
  });

  it('runner 关键事件 → 通知创建（同 run 同原因去重）', async () => {
    const svc = makeSvc();
    mockStart.mockResolvedValue(undefined);

    await (svc as any).startRunner(config, adapter, 'sess-id', 'cred-1');
    const runner = (svc as any).runners.get('ETHUSDT_x');
    const event = { kind: 'ORDER_REJECTED', reason: 'ACCOUNT_MODE_RESTRICTED', message: 'account restricted' };

    runner.runnerDeps.onCriticalEvent(event);
    runner.runnerDeps.onCriticalEvent(event); // 重复事件
    await new Promise((r) => setTimeout(r, 0));

    expect(notificationMock.createAndBroadcast).toHaveBeenCalledTimes(1);
    expect(notificationMock.createAndBroadcast).toHaveBeenCalledWith(expect.objectContaining({
      type: 'warn',
      code: 'RUNNER_ORDER_REJECTED',
      params: { symbol: 'OKX ETH/USDT', runCode: 'ETHUSDT_x', reason: 'ACCOUNT_MODE_RESTRICTED' },
    }));
  });

  it('STOPPED_REJECTIONS 事件 → alert 级通知', async () => {
    const svc = makeSvc();
    mockStart.mockResolvedValue(undefined);

    await (svc as any).startRunner(config, adapter, 'sess-id', 'cred-1');
    const runner = (svc as any).runners.get('ETHUSDT_x');

    runner.runnerDeps.onCriticalEvent({ kind: 'STOPPED_REJECTIONS', reason: 'UNKNOWN', message: 'margin' });
    await new Promise((r) => setTimeout(r, 0));

    expect(notificationMock.createAndBroadcast).toHaveBeenCalledWith(expect.objectContaining({
      type: 'alert',
      code: 'RUNNER_STOPPED_REJECTIONS',
    }));
  });

  it('PAUSED_PERMANENT_ERROR 事件 → alert 级通知（止损不可用自动暂停，用户必须知情）', async () => {
    const svc = makeSvc();
    mockStart.mockResolvedValue(undefined);

    await (svc as any).startRunner(config, adapter, 'sess-id', 'cred-1');
    const runner = (svc as any).runners.get('ETHUSDT_x');

    runner.runnerDeps.onCriticalEvent({ kind: 'PAUSED_PERMANENT_ERROR', reason: 'CLIENT_ID_TOO_LONG', message: 'id too long' });
    await new Promise((r) => setTimeout(r, 0));

    expect(notificationMock.createAndBroadcast).toHaveBeenCalledWith(expect.objectContaining({
      type: 'alert',
      code: 'RUNNER_PAUSED_PERMANENT_ERROR',
      params: { symbol: 'OKX ETH/USDT', runCode: 'ETHUSDT_x', reason: 'CLIENT_ID_TOO_LONG' },
    }));
  });

  it('非终态 FSM 变化 → 回写 Run.state（空仓 resume 转 TRAILING_ENTRY 不再死锁 RUNNING）', async () => {
    const svc = makeSvc();
    mockStart.mockResolvedValue(undefined);
    // 当前 run 落库为 PAUSED，FSM 因无仓位 resume 后转 TRAILING_ENTRY
    runFindUnique.mockResolvedValue({ id: 'run-id', runCode: 'ETHUSDT_x', state: 'PAUSED', endedAt: null, boxId: 'box-1' });

    await (svc as any).startRunner(config, adapter, 'sess-id', 'cred-1');
    const runner = (svc as any).runners.get('ETHUSDT_x');

    runner.runnerDeps.onStateChange({ fsm: { kind: 'TRAILING_ENTRY' }, config: {}, position: null });
    await new Promise((r) => setTimeout(r, 0));

    expect(runUpdate).toHaveBeenCalledWith({
      where: { id: 'run-id' },
      data: { state: 'TRAILING_ENTRY' },
    });
  });

  it('非终态 FSM 同状态重复广播 → 不重复写库（内存去重）', async () => {
    const svc = makeSvc();
    mockStart.mockResolvedValue(undefined);
    runFindUnique.mockResolvedValue({ id: 'run-id', runCode: 'ETHUSDT_x', state: 'PAUSED', endedAt: null, boxId: 'box-1' });

    await (svc as any).startRunner(config, adapter, 'sess-id', 'cred-1');
    const runner = (svc as any).runners.get('ETHUSDT_x');

    runner.runnerDeps.onStateChange({ fsm: { kind: 'RUNNING' }, config: {}, position: null });
    await new Promise((r) => setTimeout(r, 0));
    runner.runnerDeps.onStateChange({ fsm: { kind: 'RUNNING' }, config: {}, position: null });
    await new Promise((r) => setTimeout(r, 0));

    const runningWrites = runUpdate.mock.calls.filter((c) => c[0]?.data?.state === 'RUNNING');
    expect(runningWrites.length).toBe(1);
  });

  it('终态 FSM 广播 → 不走非终态回写（仍由 handleAutoTermination 处理）', async () => {
    const svc = makeSvc();
    mockStart.mockResolvedValue(undefined);
    runFindUnique.mockResolvedValue({ id: 'run-id', runCode: 'ETHUSDT_x', state: 'RUNNING', endedAt: null, boxId: 'box-1' });

    await (svc as any).startRunner(config, adapter, 'sess-id', 'cred-1');
    const runner = (svc as any).runners.get('ETHUSDT_x');

    runner.runnerDeps.onStateChange({ fsm: { kind: 'TAKE_PROFIT' }, config: {}, position: null });
    await new Promise((r) => setTimeout(r, 5));

    // 终态写库带 endedAt（由 handleAutoTermination），不应只写 state
    const plainStateWrites = runUpdate.mock.calls.filter(
      (c) => c[0]?.data && c[0].data.endedAt === undefined && 'state' in c[0].data,
    );
    expect(plainStateWrites.length).toBe(0);
  });

  it('FSM=CANCELLED 终态 → Run.state=CANCELLED / exitReason=TRAILING_CANCELLED（不再误记为止损）', async () => {
    const svc = makeSvc();
    mockStart.mockResolvedValue(undefined);
    runFindUnique.mockResolvedValue({ id: 'run-id', runCode: 'ETHUSDT_x', state: 'TRAILING_ENTRY', endedAt: null, boxId: null });

    await (svc as any).startRunner(config, adapter, 'sess-id', 'cred-1');
    const runner = (svc as any).runners.get('ETHUSDT_x');

    runner.runnerDeps.onStateChange({ fsm: { kind: 'CANCELLED' }, config: {}, position: null });
    await new Promise((r) => setTimeout(r, 5));

    expect(runUpdate).toHaveBeenCalledWith({
      where: { id: 'run-id' },
      data: { state: 'CANCELLED', endedAt: expect.any(Date), exitReason: 'TRAILING_CANCELLED' },
    });
  });

  it('RESIDUAL_POSITION 事件 → alert 级通知（清算未清干净，用户须手动核对）', async () => {
    const svc = makeSvc();
    mockStart.mockResolvedValue(undefined);

    await (svc as any).startRunner(config, adapter, 'sess-id', 'cred-1');
    const runner = (svc as any).runners.get('ETHUSDT_x');

    runner.runnerDeps.onCriticalEvent({ kind: 'RESIDUAL_POSITION', reason: 'LIQUIDATION_RESIDUAL', message: 'residual 1.0' });
    await new Promise((r) => setTimeout(r, 0));

    expect(notificationMock.createAndBroadcast).toHaveBeenCalledWith(expect.objectContaining({
      type: 'alert',
      code: 'RUNNER_RESIDUAL_POSITION',
      params: { symbol: 'OKX ETH/USDT', runCode: 'ETHUSDT_x', reason: 'LIQUIDATION_RESIDUAL' },
    }));
  });

  it('真实 startRunner 接线：onOwnFillSettled 触发 → 宽限期后调用 fillReconcile.reconcileRun（非直接调 scheduleOwnFillCheck 的隔离测试）', async () => {
    const svc = makeSvc();
    mockStart.mockResolvedValue(undefined);
    vi.useFakeTimers();
    try {
      await (svc as any).startRunner(config, adapter, 'sess-id', 'cred-1');
      const runner = (svc as any).runners.get('ETHUSDT_x');
      mockFillReconcile.reconcileRun.mockClear(); // 清掉冷启动那次 reconcile 调用

      runner.runnerDeps.onOwnFillSettled('client-order-1');
      await vi.advanceTimersByTimeAsync(5000);

      expect(mockFillReconcile.reconcileRun).toHaveBeenCalledWith('ETHUSDT_x', 'ETH/USDT', adapter);
    } finally {
      vi.useRealTimers();
    }
  });

  it('通知发送失败时去重 key 回滚，同原因事件可重试', async () => {
    const svc = makeSvc();
    mockStart.mockResolvedValue(undefined);
    notificationMock.createAndBroadcast.mockRejectedValueOnce(new Error('db down'));

    await (svc as any).startRunner(config, adapter, 'sess-id', 'cred-1');
    const runner = (svc as any).runners.get('ETHUSDT_x');
    const event = { kind: 'ORDER_REJECTED', reason: 'ACCOUNT_MODE_RESTRICTED', message: 'account restricted' };

    runner.runnerDeps.onCriticalEvent(event); // 第一次：失败
    await new Promise((r) => setTimeout(r, 0));
    runner.runnerDeps.onCriticalEvent(event); // 第二次：应重试成功
    await new Promise((r) => setTimeout(r, 0));

    expect(notificationMock.createAndBroadcast).toHaveBeenCalledTimes(2);
  });
});

describe('TradingEngineService.startBot — 新 run seed 交易所真实持仓 (BUG-04)', () => {
  const boxRecord = {
    id: 'cfg1',
    accountId: 'cred-1',
    symbol: 'ETH/USDT',
    direction: 'LONG',
    takeProfitPrice: 2200,
    mainGridCount: 10,
    mainGridStep: 36,
    mainGridPortionSize: 0.01,
    leverage: 10,
    stopLossGridCount: 4,
    stopLossGridStep: 10,
    reorderThreshold: 0.0002,
    gtcThreshold: 1.0,
    trailingEntry: false,
    trailingCallbackRate: null,
    entryPrice: null,
  };

  function makeSvcForStartBot(fetchPosition: ReturnType<typeof vi.fn>) {
    const runCreate = vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: 'run-new', realizedPnl: 0, pnlSignedPosition: 0, pnlAvgCost: 0, ...data }),
    );
    const prisma = {
      run: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: runCreate,
        update: vi.fn().mockResolvedValue({}),
      },
      box: { findUnique: vi.fn().mockResolvedValue(boxRecord) },
    };
    const credentialService = {
      findOneWithSecrets: vi.fn().mockResolvedValue({
        exchangeId: 'binance', accountId: 'acc-uid', apiKey: 'k', apiSecret: 's', passphrase: null, isActive: true,
      }),
    };
    const adapterFactory = { createAdapter: vi.fn().mockReturnValue({ fetchPosition }) };
    const accountSnapshot = { ensurePolling: vi.fn(), stopPolling: vi.fn(), setOnChanged: vi.fn() };
    const svc = new TradingEngineService(
      prisma as any, adapterFactory as any, credentialService as any, {} as any, {} as any,
      accountSnapshot as any, {} as any,
      { ingest: vi.fn().mockResolvedValue(undefined), seedRealizedPnl: vi.fn(), clearRealizedPnl: vi.fn() } as any,
      { reconcileRun: vi.fn().mockResolvedValue(undefined) } as any,
      { createAndBroadcast: vi.fn().mockResolvedValue({}) } as any,
    );
    return { svc, runCreate };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockStart.mockResolvedValue(undefined);
  });

  it('交易所有 long 持仓时，新 run 以真实持仓+均价起算 pnl 状态机', async () => {
    const fetchPosition = vi.fn().mockResolvedValue({
      symbol: 'ETH/USDT', side: 'long', qty: 3.3, avgCost: 1676.7, unrealizedPnl: 0, leverage: 10,
    });
    const { svc, runCreate } = makeSvcForStartBot(fetchPosition);

    await svc.startBot('cfg1', 'ETHUSDT_seedtest1');

    expect(runCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ pnlSignedPosition: 3.3, pnlAvgCost: 1676.7 }),
      }),
    );
  });

  it('交易所有 short 持仓时 seed 为负数', async () => {
    const fetchPosition = vi.fn().mockResolvedValue({
      symbol: 'ETH/USDT', side: 'short', qty: 3.741, avgCost: 1676.5, unrealizedPnl: 0, leverage: 10,
    });
    const { svc, runCreate } = makeSvcForStartBot(fetchPosition);

    await svc.startBot('cfg1', 'ETHUSDT_seedtest2');

    expect(runCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ pnlSignedPosition: -3.741, pnlAvgCost: 1676.5 }),
      }),
    );
  });

  it('持仓获取失败时以 0 起算且不阻断启动', async () => {
    const fetchPosition = vi.fn().mockRejectedValue(new Error('exchange down'));
    const { svc, runCreate } = makeSvcForStartBot(fetchPosition);

    await svc.startBot('cfg1', 'ETHUSDT_seedtest3');

    expect(runCreate).toHaveBeenCalledTimes(1);
    const created = runCreate.mock.calls[0][0].data as Record<string, unknown>;
    expect(created.pnlSignedPosition ?? 0).toBe(0);
  });
});
