import { describe, it, expect, vi, beforeEach } from 'vitest';

// 捕获 startRunner 传给 GridBotRunner 构造函数的真实 deps（第三个参数），
// 以便直接驱动其中的 onStateChange 分派回调。用 vi.hoisted 让捕获容器先于
// 被提升的 vi.mock 工厂初始化（否则工厂引用 TDZ 中的变量会抛错）。
const captured = vi.hoisted(() => ({ deps: undefined as any }));

// GridBotRunner 被替换为最小桩 class：构造时捕获 deps（第三个参数），
// 并暴露 startRunner 后续会用到的 symbol getter 与 start()。
vi.mock('./runner/grid-bot-runner', () => {
  class GridBotRunner {
    public symbol: string;
    public start = vi.fn().mockResolvedValue(undefined);
    constructor(config: any, _adapter: any, deps: any) {
      captured.deps = deps;
      this.symbol = config.symbol;
    }
  }
  return { GridBotRunner };
});

// 内部 new 的协作者（fsm/strategy/execution/truth/reconstructor）走真实实现也无副作用，
// 因为它们只是被塞进 deps 给桩 runner，从不被本测试触发。无需 mock。

import { TradingEngineService } from './trading-engine.service';

describe('TradingEngineService.startRunner → onStateChange 分派接线（W2 接缝）', () => {
  let prismaUpdate: ReturnType<typeof vi.fn>;
  let prismaFindUnique: ReturnType<typeof vi.fn>;

  function makeService() {
    prismaUpdate = vi.fn().mockResolvedValue({});
    // 非终态路径(syncRunStateFromFsm)与终态路径(handleAutoTermination)都按 runCode 查 run。
    // state:'RUNNING' 确保 TRAILING_ENTRY 与现状不同 → 触发 update；endedAt:null → 终态路径可写。
    prismaFindUnique = vi
      .fn()
      .mockResolvedValue({ id: 'run-id', runCode: 'RC1', state: 'RUNNING', endedAt: null, boxId: null });

    const mockPrisma = {
      run: {
        findUnique: prismaFindUnique,
        update: prismaUpdate,
      },
      box: { findUnique: vi.fn().mockResolvedValue(null) },
      order: { create: vi.fn().mockResolvedValue({}) },
    };
    const mockAccountSnapshot = {
      stopPolling: vi.fn(),
      ensurePolling: vi.fn(),
      setOnChanged: vi.fn(),
    };
    const mockFillReconcile = { reconcileRun: vi.fn().mockResolvedValue(undefined) };

    const svc = new TradingEngineService(
      mockPrisma as any, // prisma
      {} as any, // adapterFactory
      {} as any, // credentialService
      {} as any, // persistence
      {} as any, // metrics
      mockAccountSnapshot as any, // accountSnapshot
      {} as any, // moduleRef
      { ingest: vi.fn().mockResolvedValue(undefined) } as any, // fillIngestion
      mockFillReconcile as any, // fillReconcile
      { createAndBroadcast: vi.fn().mockResolvedValue({}) } as any, // notificationService
    );

    return svc;
  }

  // 回调内部用 void fire-and-forget 调用异步分派；flush 几轮微任务+宏任务后再断言。
  async function flush() {
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((r) => setImmediate(r));
    await Promise.resolve();
  }

  beforeEach(() => {
    vi.clearAllMocks();
    captured.deps = undefined;
  });

  async function captureOnStateChange() {
    const svc = makeService();
    const minimalConfig = { runCode: 'RC1', symbol: 'ETH/USDT' };
    const adapterStub = {} as any;
    await (svc as any).startRunner(minimalConfig, adapterStub, 'run-id', 'cred-1');
    expect(captured.deps).toBeDefined();
    expect(typeof captured.deps.onStateChange).toBe('function');
    return captured.deps.onStateChange as (state: any) => void;
  }

  it('捕获到真实 onStateChange 回调', async () => {
    const onStateChange = await captureOnStateChange();
    expect(onStateChange).toBeTypeOf('function');
  });

  it('非终态 TRAILING_ENTRY → 路由到 syncRunStateFromFsm（裸 state 写回，无 endedAt）', async () => {
    const onStateChange = await captureOnStateChange();

    onStateChange({ fsm: { kind: 'TRAILING_ENTRY' } });
    await flush();

    expect(prismaUpdate).toHaveBeenCalledTimes(1);
    // syncRunStateFromFsm 形态：仅 { state }，绝不带 endedAt / exitReason。
    expect(prismaUpdate).toHaveBeenCalledWith({
      where: { id: 'run-id' },
      data: { state: 'TRAILING_ENTRY' },
    });
    const callArg = prismaUpdate.mock.calls[0][0];
    expect(callArg.data).not.toHaveProperty('endedAt');
    expect(callArg.data).not.toHaveProperty('exitReason');
  });

  it('终态 TAKE_PROFIT → 路由到 handleAutoTermination（带 endedAt + exitReason，非裸写回）', async () => {
    const onStateChange = await captureOnStateChange();

    onStateChange({ fsm: { kind: 'TAKE_PROFIT' } });
    await flush();

    expect(prismaUpdate).toHaveBeenCalledTimes(1);
    const callArg = prismaUpdate.mock.calls[0][0];
    // handleAutoTermination 形态：state + endedAt + exitReason，区别于裸 { state } 写回。
    expect(callArg.where).toEqual({ id: 'run-id' });
    expect(callArg.data.state).toBe('TAKE_PROFIT');
    expect(callArg.data.endedAt).toBeInstanceOf(Date);
    expect(callArg.data.exitReason).toBe('TAKE_PROFIT');
  });
});
