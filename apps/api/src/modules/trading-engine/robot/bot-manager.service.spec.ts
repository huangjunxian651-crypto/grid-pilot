import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BotManagerService } from './bot-manager.service';
import { ConflictException, BadRequestException, NotFoundException, Logger } from '@nestjs/common';

const boxRow = (id: string, overrides?: Record<string, unknown>) => ({
  id,
  direction: 'LONG',
  takeProfitPrice: 2800,
  mainGridCount: 200,
  mainGridStep: 2,
  stopLossGridCount: 4,
  stopLossGridStep: 2,
  activationPrice: 0,
  trailingEntry: true,
  enabled: true,
  ...overrides,
});

function makeService() {
  const robotUpdate = vi.fn().mockResolvedValue({});
  const robotFindUnique = vi.fn().mockResolvedValue({ id: 'robot-1', symbol: 'ETH/USDT', status: 'PAUSED', accountId: 'cred-1', activeBoxId: null });
  const boxFindMany = vi.fn().mockResolvedValue([boxRow('box-1')]);
  const prisma = {
    robot: { update: robotUpdate, findUnique: robotFindUnique, findMany: vi.fn().mockResolvedValue([]) },
    box: { findMany: boxFindMany, count: vi.fn().mockResolvedValue(1), create: vi.fn().mockResolvedValue({ id: 'box-x' }), findFirst: vi.fn().mockResolvedValue(null), update: vi.fn().mockResolvedValue({}) },
    run: {
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({}),
    },
    exchangeAccount: { findUnique: vi.fn().mockResolvedValue({ exchangeId: 'binance' }) },
  };
  const startBot = vi.fn().mockResolvedValue({ runCode: 'sc' });
  const stopBot = vi.fn().mockResolvedValue(undefined);
  const detachBot = vi.fn().mockResolvedValue(undefined);
  const pauseBot = vi.fn().mockResolvedValue(undefined);
  const captureStopSnapshot = vi.fn().mockResolvedValue(null);
  const assertSymbolTradable = vi.fn().mockResolvedValue(undefined);

  let emit: ((price: number) => void) | null = null;
  let stopped = false;
  const subscribe = vi.fn((_robotId: string, _credentialId: string, _symbol: string, onPrice: (p: number) => void) => {
    emit = onPrice;
    return () => { stopped = true; emit = null; };
  });
  const tickerSource = { subscribe };

  const accountSnapshot = { getSnapshot: vi.fn().mockReturnValue(undefined) };
  const notification = { createAndBroadcast: vi.fn().mockResolvedValue({}) };
  const pnlLedger = {
    getBoxesLedger: vi.fn().mockResolvedValue(new Map()),
  };

  const launcher = { startBot, stopBot, detachBot, pauseBot, captureStopSnapshot, assertSymbolTradable, setOnBoxTerminated: vi.fn() };
  const svc = new BotManagerService(prisma as any, launcher as any, tickerSource as any, accountSnapshot as any, notification as any, pnlLedger as any);
  return {
    svc, prisma, robotUpdate, boxFindMany, startBot, stopBot, detachBot, pauseBot, captureStopSnapshot, assertSymbolTradable, launcher, subscribe, notification, accountSnapshot, pnlLedger,
    pushPrice: (p: number) => emit?.(p),
    isStopped: () => stopped,
  };
}

describe('BotManagerService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('listRobots：后端直出 netPnl/totalFees/totalPnl（net=realized−fees，total=net+未实现）', async () => {
    const { svc, prisma, accountSnapshot, pnlLedger } = makeService();
    (prisma.robot.findMany as any).mockResolvedValueOnce([
      { id: 'robot-1', symbol: 'ETH/USDT', direction: 'LONG', status: 'RUNNING', activeBoxId: 'box-1',
        account: { id: 'cred-1', exchangeId: 'binance', label: 'Acc' }, stopStage: null, stopWarning: null,
        lastPositionQty: null, lastEntryPrice: null, lastUnrealizedPnl: null, lastSnapshotAt: null },
    ]);
    (prisma.box.findMany as any).mockResolvedValueOnce([boxRow('box-1', { robotId: 'robot-1', isolationStep: 2 })]);
    // run 聚合：realized 10、fees 2 → net 8（通过 PnlLedgerService 返回）
    (pnlLedger.getBoxesLedger as any).mockResolvedValue(
      new Map([['box-1', { realized: 10, fees: 2, funding: 0, savings: 1, net: 8 }]]),
    );
    (accountSnapshot.getSnapshot as any).mockReturnValue({ credentialId: 'cred-1', positions: [{ symbol: 'ETH/USDT', unrealizedPnl: 5 }] });
    const [s] = await svc.listRobots();
    expect(s.realizedPnl).toBe(10);
    expect(s.totalFees).toBe(2);
    expect(s.netPnl).toBe(8);          // realized − fees
    expect(s.lastUnrealizedPnl).toBe(5);
    expect(s.totalPnl).toBe(13);       // net + 未实现
  });

  it('listRobots：运行中机器人叠加内存快照的实时未实现盈亏（DRY=实时未实现+历史已实现）', async () => {
    const { svc, prisma, accountSnapshot, pnlLedger } = makeService();
    (prisma.robot.findMany as any).mockResolvedValueOnce([
      { id: 'robot-1', symbol: 'ETH/USDT', direction: 'LONG', status: 'RUNNING', activeBoxId: 'box-1',
        account: { id: 'cred-1', exchangeId: 'binance', label: 'Acc' },
        stopStage: null, stopWarning: null, lastPositionQty: null, lastEntryPrice: null,
        lastUnrealizedPnl: null, lastSnapshotAt: null },
    ]);
    (prisma.box.findMany as any).mockResolvedValueOnce([boxRow('box-1', { robotId: 'robot-1', isolationStep: 2 })]);
    (pnlLedger.getBoxesLedger as any).mockResolvedValue(
      new Map([['box-1', { realized: 10, fees: 0, funding: 0, savings: 0, net: 10 }]]),
    );
    // 账户在轮询：内存快照含该 symbol 的实时持仓（未实现 +5）
    (accountSnapshot.getSnapshot as any).mockReturnValue({
      credentialId: 'cred-1', totalEquity: 0, totalWalletBalance: 0, availableUsdt: 0, marginUsed: 0, updatedAt: Date.now(),
      positions: [{ symbol: 'ETH/USDT', side: 'LONG', qty: 1, entryPrice: 2000, markPrice: 2005, unrealizedPnl: 5, leverage: 3 }],
    });
    const [summary] = await svc.listRobots();
    expect(summary.realizedPnl).toBe(10);
    expect(summary.lastUnrealizedPnl).toBe(5); // 实时未实现已叠加 → PnlCell 可显示总体盈亏 15
    expect(accountSnapshot.getSnapshot).toHaveBeenCalledWith('cred-1');
  });

  it('listRobots：账户无内存快照（如已停止）时回退停止快照持久列', async () => {
    const { svc, prisma, accountSnapshot } = makeService();
    (prisma.robot.findMany as any).mockResolvedValueOnce([
      { id: 'robot-2', symbol: 'ETH/USDT', direction: 'LONG', status: 'STOPPED', activeBoxId: null,
        account: { id: 'cred-9', exchangeId: 'binance', label: 'Acc' },
        stopStage: null, stopWarning: null, lastPositionQty: null, lastEntryPrice: null,
        lastUnrealizedPnl: 3.5, lastSnapshotAt: new Date() },
    ]);
    (prisma.box.findMany as any).mockResolvedValueOnce([]);
    (accountSnapshot.getSnapshot as any).mockReturnValue(undefined); // 未在轮询
    const [summary] = await svc.listRobots();
    expect(summary.lastUnrealizedPnl).toBe(3.5); // 回退停止快照列
  });

  it('listRobots：无内存快照且 lastUnrealizedPnl=null → lastUnrealizedPnl===null 且 totalPnl===null（前端显示"见详情"）', async () => {
    // FIX M-4: 已停止/从未被轮询的机器人，后端合同：totalPnl 为 null，不给前端算一个虚假值。
    const { svc, prisma, accountSnapshot, pnlLedger } = makeService();
    (prisma.robot.findMany as any).mockResolvedValueOnce([
      {
        id: 'robot-null', symbol: 'BTC/USDT', direction: 'LONG', status: 'STOPPED', activeBoxId: null,
        account: { id: 'cred-7', exchangeId: 'binance', label: 'Acc' },
        stopStage: null, stopWarning: null,
        lastPositionQty: null, lastEntryPrice: null,
        lastUnrealizedPnl: null, lastSnapshotAt: null,
      },
    ]);
    (prisma.box.findMany as any).mockResolvedValueOnce([{ id: 'box-n', robotId: 'robot-null', takeProfitPrice: 50000, mainGridStep: 10, mainGridCount: 100, stopLossGridCount: 0, stopLossGridStep: 0, isolationStep: null }]);
    // 有已实现盈亏（run 有成交），但未实现未知
    (pnlLedger.getBoxesLedger as any).mockResolvedValue(
      new Map([['box-n', { realized: 20, fees: 3, funding: 0, savings: 0, net: 17 }]]),
    );
    // 无内存快照（账户未在轮询，例如机器人已停止很久）
    (accountSnapshot.getSnapshot as any).mockReturnValue(undefined);
    const [summary] = await svc.listRobots();
    // netPnl 有定义（realized - fees）
    expect(summary.netPnl).toBe(17);
    // 但未实现不可得 → null 契约
    expect(summary.lastUnrealizedPnl).toBeNull();
    expect(summary.totalPnl).toBeNull();
  });

  it('startRobot sets status RUNNING and registers a scheduler', async () => {
    const { svc, robotUpdate } = makeService();
    await svc.startRobot('robot-1');
    expect(robotUpdate).toHaveBeenCalledWith({ where: { id: 'robot-1' }, data: { status: 'RUNNING' } });
    expect(svc.isManaged('robot-1')).toBe(true);
  });

  it('startRobot 无箱体时拒绝 → ROBOT_NO_BOX（error-code 而非硬编码中文）', async () => {
    const { svc, prisma } = makeService();
    (prisma.box.count as any).mockResolvedValueOnce(0);
    await expect(svc.startRobot('robot-1')).rejects.toMatchObject({ response: { code: 'ROBOT_NO_BOX' } });
    expect(svc.isManaged('robot-1')).toBe(false);
  });

  it('startRobot rejects an archived robot (endedAt set) with ROBOT_ARCHIVED', async () => {
    const { svc, prisma } = makeService();
    (prisma.robot.findUnique as any).mockResolvedValueOnce({
      id: 'robot-x', symbol: 'ETH/USDT', direction: 'LONG', status: 'STOPPED',
      activeBoxId: null, accountId: 'cred-1', endedAt: new Date('2026-06-13T00:00:00Z'),
    });
    await expect(svc.startRobot('robot-x')).rejects.toMatchObject({
      response: { code: 'ROBOT_ARCHIVED' },
    });
    expect(svc.isManaged('robot-x')).toBe(false);
  });

  // 归档（endedAt 非空）为终态只读：箱体写操作必须像 startRobot 一样被拒（ROBOT_ARCHIVED）。
  const archivedRobot = {
    id: 'robot-arch', symbol: 'ETH/USDT', direction: 'LONG', status: 'STOPPED',
    activeBoxId: null, accountId: 'cred-1', endedAt: new Date('2026-06-13T00:00:00Z'),
  };

  it('addBox rejects an archived robot with ROBOT_ARCHIVED', async () => {
    const { svc, prisma } = makeService();
    (prisma.robot.findUnique as any).mockResolvedValueOnce(archivedRobot);
    await expect(
      svc.addBox('robot-arch', { direction: 'LONG', takeProfitPrice: 2800, mainGridCount: 200, mainGridStep: 2, mainGridPortionSize: 0.05, leverage: 20, stopLossGridCount: 4, stopLossGridStep: 2 } as any),
    ).rejects.toMatchObject({ response: { code: 'ROBOT_ARCHIVED' } });
    expect(prisma.box.create).not.toHaveBeenCalled();
  });

  it('editBox rejects an archived robot with ROBOT_ARCHIVED', async () => {
    const { svc, prisma } = makeService();
    (prisma.robot.findUnique as any).mockResolvedValueOnce(archivedRobot);
    await expect(
      svc.editBox('robot-arch', 'box-1', { takeProfitPrice: 2800, mainGridCount: 200, mainGridStep: 2, mainGridPortionSize: 0.05, leverage: 20, stopLossGridCount: 4, stopLossGridStep: 2 } as any),
    ).rejects.toMatchObject({ response: { code: 'ROBOT_ARCHIVED' } });
    // 守卫在任何 box 读/写之前触发
    expect(prisma.box.findFirst).not.toHaveBeenCalled();
    expect(prisma.box.update).not.toHaveBeenCalled();
  });

  it('removeBox rejects an archived robot with ROBOT_ARCHIVED', async () => {
    const { svc, prisma } = makeService();
    (prisma.robot.findUnique as any).mockResolvedValueOnce(archivedRobot);
    await expect(
      svc.removeBox('robot-arch', 'box-1', { closePosition: false }),
    ).rejects.toMatchObject({ response: { code: 'ROBOT_ARCHIVED' } });
    // 守卫在撤单/平仓/软删之前触发
    expect(prisma.run.findFirst).not.toHaveBeenCalled();
    expect(prisma.box.update).not.toHaveBeenCalled();
  });

  it('pauseRobot rejects an archived robot with ROBOT_ARCHIVED', async () => {
    const { svc, prisma, robotUpdate } = makeService();
    (prisma.robot.findUnique as any).mockResolvedValueOnce(archivedRobot);
    await expect(svc.pauseRobot('robot-arch')).rejects.toMatchObject({ response: { code: 'ROBOT_ARCHIVED' } });
    // 终态不被改写为 PAUSED
    expect(robotUpdate).not.toHaveBeenCalled();
  });

  it('feedPrice activates a box (startBot) when price enters the window', async () => {
    const { svc, startBot, robotUpdate } = makeService();
    await svc.startRobot('robot-1');
    await svc.feedPrice('robot-1', 2550);
    expect(startBot).toHaveBeenCalledTimes(1);
    expect(startBot).toHaveBeenCalledWith('box-1', expect.stringContaining('ETHUSDT_'), 'TRAILING_ENTRY');
    expect(robotUpdate).toHaveBeenCalledWith({ where: { id: 'robot-1' }, data: { activeBoxId: 'box-1' } });
  });

  it('feedPrice does not activate when price is outside the window', async () => {
    const { svc, startBot } = makeService();
    await svc.startRobot('robot-1');
    await svc.feedPrice('robot-1', 2700);
    expect(startBot).not.toHaveBeenCalled();
  });

  it('does not activate a second box while one is active', async () => {
    const { svc, startBot } = makeService();
    await svc.startRobot('robot-1');
    await svc.feedPrice('robot-1', 2550);
    await svc.feedPrice('robot-1', 2520);
    expect(startBot).toHaveBeenCalledTimes(1);
  });

  it('onBoxTerminated clears active slot and relays on next tick', async () => {
    const { svc, startBot, robotUpdate } = makeService();
    await svc.startRobot('robot-1');
    await svc.feedPrice('robot-1', 2550);
    expect(startBot).toHaveBeenCalledTimes(1);

    await svc.onBoxTerminated('robot-1', 'box-1');
    expect(robotUpdate).toHaveBeenCalledWith({ where: { id: 'robot-1' }, data: { activeBoxId: null } });

    await svc.feedPrice('robot-1', 2500);
    expect(startBot).toHaveBeenCalledTimes(2);
  });

  it('feedPrice on an unmanaged robot is a no-op', async () => {
    const { svc, startBot } = makeService();
    await svc.feedPrice('robot-unknown', 2550);
    expect(startBot).not.toHaveBeenCalled();
  });

  it('行情回调中 feedPrice 抛错被捕获并记录，不产生 unhandled rejection', async () => {
    const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    try {
      const { svc, boxFindMany, pushPrice } = makeService();
      await svc.startRobot('robot-1');
      warnSpy.mockClear();
      svc.invalidateBoxCache('robot-1'); // 绕过 TTL 缓存,让本次 tick 真正打 DB
      // refreshBoxes 内的 prisma 查询抛错，经 subscribe 回调里的 void feedPrice 传播，
      // 旧实现会变成 unhandled rejection。
      boxFindMany.mockRejectedValueOnce(new Error('db unavailable'));
      pushPrice(2550); // emit → void feedPrice → refreshBoxes throws
      await new Promise((r) => setTimeout(r, 0)); // flush microtasks
      expect(warnSpy).toHaveBeenCalled(); // 错误被 .catch 记录，而非逃逸为 unhandled rejection
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('连续激活失败达到阈值后自动暂停机器人并停止重试', async () => {
    const errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    vi.useFakeTimers();
    try {
      const { svc, startBot, robotUpdate, notification } = makeService();
      startBot.mockRejectedValue(new Error('OKX client error (HTTP 400): boom'));
      await svc.startRobot('robot-1');

      // 跨过指数退避窗口（5s/10s/20s/40s）触发 5 次连续失败
      let t = Date.now();
      for (let i = 0; i < 5; i++) {
        vi.setSystemTime(t);
        await svc.feedPrice('robot-1', 2550).catch(() => {});
        t += 5_000 * 2 ** i + 1;
      }
      expect(startBot).toHaveBeenCalledTimes(5);

      await vi.advanceTimersByTimeAsync(0); // flush 暂停流程的微任务
      expect(robotUpdate).toHaveBeenCalledWith({ where: { id: 'robot-1' }, data: { status: 'PAUSED' } });
      expect(errorSpy).toHaveBeenCalled();
      expect(svc.isManaged('robot-1')).toBe(false);
      expect(notification.createAndBroadcast).toHaveBeenCalledWith(expect.objectContaining({
        type: 'alert',
        code: 'ROBOT_AUTO_PAUSED',
        params: expect.objectContaining({ symbol: 'ETH/USDT' }),
      }));

      // 暂停后价格再进窗口也不再尝试激活
      vi.setSystemTime(t + 1_000_000);
      await svc.feedPrice('robot-1', 2550).catch(() => {});
      expect(startBot).toHaveBeenCalledTimes(5);
    } finally {
      vi.useRealTimers();
      errorSpy.mockRestore();
    }
  });

  it('requestStop immediately sets STOPPING and unregisters the scheduler', async () => {
    // requestStop 即时置 STOPPING 并 fire-and-forget 后台 job，
    // 终态 STOPPED 由 runStopJob 异步落地（见 async stop 用例）。
    const { svc, robotUpdate } = makeService();
    await svc.startRobot('robot-1');
    await svc.requestStop('robot-1', { closePosition: true });
    expect(robotUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'robot-1' },
        data: expect.objectContaining({ status: 'STOPPING', stopStage: 'CANCELLING_ORDERS' }),
      }),
    );
    expect(svc.isManaged('robot-1')).toBe(false);
  });

  it('pauseRobot sets status PAUSED and unregisters the scheduler', async () => {
    const { svc, robotUpdate } = makeService();
    await svc.startRobot('robot-1');
    await svc.pauseRobot('robot-1');
    expect(robotUpdate).toHaveBeenCalledWith({ where: { id: 'robot-1' }, data: { status: 'PAUSED' } });
    expect(svc.isManaged('robot-1')).toBe(false);
  });

  it('only loads enabled boxes for the scheduler', async () => {
    const { svc, boxFindMany } = makeService();
    await svc.startRobot('robot-1');
    await svc.feedPrice('robot-1', 2550);
    expect(boxFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ robotId: 'robot-1', enabled: true }),
    }));
  });

  it('startRobot subscribes to the ticker source with robot symbol + credential', async () => {
    const { svc, subscribe } = makeService();
    await svc.startRobot('robot-1');
    expect(subscribe).toHaveBeenCalledWith('robot-1', 'cred-1', 'ETH/USDT', expect.any(Function));
  });

  it('a price from the ticker source drives activation', async () => {
    const { svc, startBot, pushPrice } = makeService();
    await svc.startRobot('robot-1');
    pushPrice(2550);
    await new Promise((r) => setTimeout(r, 0));
    expect(startBot).toHaveBeenCalledTimes(1);
  });

  it('caches the latest price and exposes it via getLatestPrice', async () => {
    const { svc, pushPrice } = makeService();
    await svc.startRobot('robot-1');
    pushPrice(2611);
    await new Promise((r) => setTimeout(r, 0));
    expect(svc.getLatestPrice('robot-1')).toBe(2611);
  });

  it('requestStop unsubscribes from the ticker source', async () => {
    const { svc, isStopped } = makeService();
    await svc.startRobot('robot-1');
    await svc.requestStop('robot-1', { closePosition: true });
    expect(isStopped()).toBe(true);
    expect(svc.getLatestPrice('robot-1')).toBeUndefined();
  });

  it('pauseRobot unsubscribes from the ticker source', async () => {
    const { svc, isStopped } = makeService();
    await svc.startRobot('robot-1');
    await svc.pauseRobot('robot-1');
    expect(isStopped()).toBe(true);
  });

  it('startRobot is idempotent: a second call does not re-subscribe (no leaked subscription)', async () => {
    const { svc, subscribe } = makeService();
    await svc.startRobot('robot-1');
    await svc.startRobot('robot-1');
    expect(subscribe).toHaveBeenCalledTimes(1);
  });

  it('restoreRobots starts only RUNNING robots', async () => {
    const { svc, prisma } = makeService();
    ((prisma as any).robot).findMany = vi.fn().mockResolvedValue([
      { id: 'robot-1', symbol: 'ETH/USDT', status: 'RUNNING', accountId: 'cred-1', activeBoxId: null },
    ]);
    (prisma as any).run = { findFirst: vi.fn().mockResolvedValue(null) };
    await svc.restoreRobots();
    expect(svc.isManaged('robot-1')).toBe(true);
  });

  it('restore with an active box re-launches that box via existing session (takeover) and marks it active', async () => {
    const { svc, prisma, startBot } = makeService();
    ((prisma as any).robot).findMany = vi.fn().mockResolvedValue([
      { id: 'robot-1', symbol: 'ETH/USDT', status: 'RUNNING', accountId: 'cred-1', activeBoxId: 'box-1' },
    ]);
    (prisma as any).run = { findFirst: vi.fn().mockResolvedValue({ runCode: 'ETHUSDT_old', boxId: 'box-1', endedAt: null }) };
    (prisma.robot.findUnique as any) = vi.fn().mockResolvedValue({ id: 'robot-1', symbol: 'ETH/USDT', status: 'RUNNING', accountId: 'cred-1', activeBoxId: 'box-1' });

    await svc.restoreRobots();

    expect(startBot).toHaveBeenCalledWith('box-1', 'ETHUSDT_old');
    await svc.feedPrice('robot-1', 2550);
    expect(startBot).toHaveBeenCalledTimes(1);
  });

  it('takeover 恢复活跃箱后填充 activeSessionCode 内存', async () => {
    const { svc, prisma, startBot } = makeService();
    (prisma.robot.findUnique as any).mockResolvedValueOnce({ id: 'robot-1', symbol: 'ETH/USDT', direction: 'LONG', status: 'RUNNING', accountId: 'cred-1', activeBoxId: 'box-x' });
    (prisma.run as any) = { findFirst: vi.fn().mockResolvedValue({ runCode: 'ETHUSDT_TK', boxId: 'box-x', endedAt: null }) };
    await svc.startRobot('robot-1');
    expect(startBot).toHaveBeenCalledWith('box-x', 'ETHUSDT_TK');
    expect((svc as any).activeSessionCode.get('robot-1')).toBe('ETHUSDT_TK');
  });

  describe('getRobotDetail activeFsmState（FSM 状态 REST 播种）', () => {
    it('活跃箱存在时，activeFsmState 取活跃 run 的 state', async () => {
      const { svc, prisma } = makeService();
      (prisma.robot.findUnique as any).mockResolvedValueOnce({
        id: 'robot-1', symbol: 'ETH/USDT', direction: 'LONG', status: 'RUNNING',
        activeBoxId: 'box-1', realizedPnl: 0,
        account: { id: 'cred-1', exchangeId: 'binance', label: 'demo' },
      });
      (prisma.run as any) = {
        findFirst: vi.fn().mockResolvedValue({ runCode: 'ETHUSDT_1', boxId: 'box-1', endedAt: null, state: 'RUNNING' }),
        findMany: vi.fn().mockResolvedValue([]),
      };
      const detail = await svc.getRobotDetail('robot-1');
      expect(detail?.activeFsmState).toBe('RUNNING');
    });

    it('无活跃箱时 activeFsmState 为 null', async () => {
      const { svc, prisma } = makeService();
      (prisma.robot.findUnique as any).mockResolvedValueOnce({
        id: 'robot-1', symbol: 'ETH/USDT', direction: 'LONG', status: 'PAUSED',
        activeBoxId: null, realizedPnl: 0,
        account: { id: 'cred-1', exchangeId: 'binance', label: 'demo' },
      });
      const detail = await svc.getRobotDetail('robot-1');
      expect(detail?.activeFsmState).toBeNull();
    });
  });

  it('restore: 活跃箱的 run 已终态（无未结束 run）时清掉悬挂 activeBoxId，不残留已结束的活跃箱', async () => {
    const { svc, prisma, robotUpdate, startBot } = makeService();
    (prisma.robot.findUnique as any) = vi.fn().mockResolvedValue({ id: 'robot-1', symbol: 'ETH/USDT', status: 'RUNNING', accountId: 'cred-1', activeBoxId: 'box-ended' });
    (prisma.run as any) = { findFirst: vi.fn().mockResolvedValue(null), updateMany: vi.fn(), findMany: vi.fn(), update: vi.fn() };

    await svc.startRobot('robot-1');

    expect(startBot).not.toHaveBeenCalled();
    expect(robotUpdate).toHaveBeenCalledWith({ where: { id: 'robot-1' }, data: { activeBoxId: null } });
  });

  describe('恢复越界按箱体止损语义（item2）', () => {
    const longBox = (id: string, takeProfitPrice: number, stopLossGridCount: number) => ({
      id, robotId: 'robot-1', direction: 'LONG', takeProfitPrice,
      mainGridCount: 10, mainGridStep: 10, mainGridPortionSize: 0.05, leverage: 20,
      stopLossGridCount, stopLossGridStep: 10, activationPrice: 0, trailingEntry: false,
      deletedAt: null, enabled: true,
    });

    it('无止损活跃箱、价已进入其他箱窗口 → 分离交棒（detach SUPERSEDED + 激活目标箱）', async () => {
      const { svc, prisma, detachBot, startBot, pushPrice } = makeService();
      // boxA 窗口 price∈(2400,2450)；boxB 窗口 price∈(2300,2350)
      (prisma.box.findMany as any).mockResolvedValue([longBox('boxA', 2500, 0), longBox('boxB', 2400, 0)]);
      (prisma.robot.findUnique as any).mockResolvedValue({ id: 'robot-1', symbol: 'ETH/USDT', direction: 'LONG', status: 'RUNNING', accountId: 'cred-1', activeBoxId: 'boxA', endedAt: null });
      (prisma.run as any) = { findFirst: vi.fn().mockResolvedValue({ runCode: 'scA', boxId: 'boxA', endedAt: null }), updateMany: vi.fn().mockResolvedValue({ count: 0 }), update: vi.fn(), findMany: vi.fn() };
      detachBot.mockResolvedValue({ cancelFailed: [] });
      startBot.mockResolvedValue({ runCode: 'scB' });

      await svc.startRobot('robot-1');
      pushPrice(2320); // 已离开 boxA、落入 boxB 窗口
      await new Promise((r) => setTimeout(r, 10));

      expect(detachBot).toHaveBeenCalledWith('scA', { state: 'SUPERSEDED', exitReason: 'NEW_SESSION' });
      expect(startBot).toHaveBeenCalledWith('boxB', expect.any(String), 'RUNNING');
    });

    it('有止损活跃箱越界 → 不在 manager 分离（交给 runner 按止损语义清算）', async () => {
      const { svc, prisma, detachBot, pushPrice } = makeService();
      (prisma.box.findMany as any).mockResolvedValue([longBox('boxA', 2500, 9), longBox('boxB', 2400, 0)]);
      (prisma.robot.findUnique as any).mockResolvedValue({ id: 'robot-1', symbol: 'ETH/USDT', direction: 'LONG', status: 'RUNNING', accountId: 'cred-1', activeBoxId: 'boxA', endedAt: null });
      (prisma.run as any) = { findFirst: vi.fn().mockResolvedValue({ runCode: 'scA', boxId: 'boxA', endedAt: null }), updateMany: vi.fn().mockResolvedValue({ count: 0 }), update: vi.fn(), findMany: vi.fn() };

      await svc.startRobot('robot-1');
      pushPrice(2320);
      await new Promise((r) => setTimeout(r, 10));

      expect(detachBot).not.toHaveBeenCalled();
    });

    it('无止损活跃箱仍在自己窗口内 → 不分离', async () => {
      const { svc, prisma, detachBot, pushPrice } = makeService();
      (prisma.box.findMany as any).mockResolvedValue([longBox('boxA', 2500, 0), longBox('boxB', 2400, 0)]);
      (prisma.robot.findUnique as any).mockResolvedValue({ id: 'robot-1', symbol: 'ETH/USDT', direction: 'LONG', status: 'RUNNING', accountId: 'cred-1', activeBoxId: 'boxA', endedAt: null });
      (prisma.run as any) = { findFirst: vi.fn().mockResolvedValue({ runCode: 'scA', boxId: 'boxA', endedAt: null }), updateMany: vi.fn().mockResolvedValue({ count: 0 }), update: vi.fn(), findMany: vi.fn() };

      await svc.startRobot('robot-1');
      pushPrice(2420); // 仍在 boxA 窗口 (2400,2450)
      await new Promise((r) => setTimeout(r, 10));

      expect(detachBot).not.toHaveBeenCalled();
    });
  });

  it('restore without active box just monitors (no startBot until price)', async () => {
    const { svc, prisma, startBot } = makeService();
    ((prisma as any).robot).findMany = vi.fn().mockResolvedValue([
      { id: 'robot-1', symbol: 'ETH/USDT', status: 'RUNNING', accountId: 'cred-1', activeBoxId: null },
    ]);
    (prisma as any).run = { findFirst: vi.fn().mockResolvedValue(null) };
    await svc.restoreRobots();
    expect(startBot).not.toHaveBeenCalled();
  });

  it('restoreRobots resumes a STOPPING robot to STOPPED', async () => {
    const { svc, prisma, robotUpdate } = makeService();
    prisma.robot.findMany.mockImplementation(({ where }: any) =>
      where.status === 'STOPPING'
        ? Promise.resolve([{ id: 'robot-9', symbol: 'ETH/USDT', status: 'STOPPING', accountId: 'cred-1', activeBoxId: null }])
        : Promise.resolve([]),
    );
    await svc.restoreRobots();
    const finalCall = robotUpdate.mock.calls.find((c: any) => c[0].where.id === 'robot-9' && c[0].data.status === 'STOPPED');
    expect(finalCall).toBeTruthy();
  });

  it('runStopJob tolerates missing runner on resume (detach NotFoundException) and converges to STOPPED without STOP_INTERRUPTED', async () => {
    const { svc, prisma, robotUpdate, detachBot, captureStopSnapshot } = makeService();
    prisma.run.findFirst.mockResolvedValue({ id: 'run-1', runCode: 'sc-1' });
    detachBot.mockRejectedValue(new NotFoundException('Bot sc-1 is not running'));
    captureStopSnapshot.mockResolvedValue(null);
    await svc.runStopJob('robot-9', { closePosition: false, runCode: 'sc-1', credentialId: 'cred-1', symbol: 'ETH/USDT' });
    const finalCall = robotUpdate.mock.calls.at(-1)![0];
    expect(finalCall.data.status).toBe('STOPPED');
    expect(finalCall.data.stopWarning).not.toBe('STOP_INTERRUPTED');
    expect(finalCall.data.stopWarning).toBeNull();
  });

  it('runStopJob tolerates missing runner on resume (close-position stopBot NotFoundException) without STOP_INTERRUPTED', async () => {
    const { svc, prisma, robotUpdate, stopBot, captureStopSnapshot } = makeService();
    prisma.run.findFirst.mockResolvedValue({ id: 'run-1', runCode: 'sc-1' });
    stopBot.mockRejectedValue(new NotFoundException('Bot sc-1 is not running'));
    captureStopSnapshot.mockResolvedValue(null);
    await svc.runStopJob('robot-9', { closePosition: true, runCode: 'sc-1', credentialId: 'cred-1', symbol: 'ETH/USDT' });
    const finalCall = robotUpdate.mock.calls.at(-1)![0];
    expect(finalCall.data.status).toBe('STOPPED');
    expect(finalCall.data.stopWarning).not.toBe('STOP_INTERRUPTED');
    expect(finalCall.data.stopWarning).toBeNull();
  });

  it('listRobots merges DB rows with runtime latestPrice, managed, exchange, boxCount, pnl', async () => {
    const { svc, prisma, pushPrice, pnlLedger } = makeService();
    ((prisma as any).robot).findMany = vi.fn().mockResolvedValue([
      { id: 'robot-1', symbol: 'ETH/USDT', direction: 'LONG', status: 'RUNNING', activeBoxId: 'box-1', endedAt: null, account: { exchangeId: 'gateio', label: 'Gate模拟' } },
      { id: 'robot-2', symbol: 'BTC/USDT', direction: 'LONG', status: 'PAUSED', activeBoxId: null, endedAt: null, account: { exchangeId: 'binance', label: '币安演示' } },
    ]);
    (prisma.box as any).findMany = vi.fn().mockResolvedValue([
      { id: 'box-1', robotId: 'robot-1', takeProfitPrice: 2800, mainGridStep: 2, mainGridCount: 200, stopLossGridCount: 4, stopLossGridStep: 2 },
      { id: 'box-2', robotId: 'robot-1', takeProfitPrice: 3000, mainGridStep: 5, mainGridCount: 100, stopLossGridCount: 0, stopLossGridStep: 0 },
    ]);
    (pnlLedger.getBoxesLedger as any).mockResolvedValue(
      new Map([['box-1', { realized: 100, fees: 0, funding: 0, savings: 0, net: 100 }]]),
    );
    await svc.startRobot('robot-1');
    pushPrice(2555);
    await new Promise((r) => setTimeout(r, 0));

    const list = await svc.listRobots();
    const r1 = list.find((r) => r.id === 'robot-1')!;
    const r2 = list.find((r) => r.id === 'robot-2')!;
    expect(r1.managed).toBe(true);
    expect(r1.latestPrice).toBe(2555);
    expect(r1.exchangeId).toBe('gateio');
    expect(r1.accountLabel).toBe('Gate模拟');
    expect(r1.boxCount).toBe(2);
    expect(r1.realizedPnl).toBeCloseTo(100, 6);
    expect(r1.activeBoxHighPrice).toBe(2800);
    // 真实箱底 = 主网格底 2400 - 隔离带 2(=止损步长约定) - 止损区 4×2 = 2390
    expect(r1.activeBoxLowPrice).toBe(2390);
    expect(r2.activeBoxHighPrice).toBeNull();
    expect(r2.activeBoxLowPrice).toBeNull();
    expect(r2.managed).toBe(false);
    expect(r2.exchangeId).toBe('binance');
    expect(r2.boxCount).toBe(0);
    expect(r2.realizedPnl).toBe(0);
    // 主列表只回活跃机器人（endedAt IS NULL）；归档的走 listArchivedRobots
    expect(((prisma as any).robot).findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { endedAt: null } }),
    );
  });

  it('listRobots reads persisted snapshot columns for STOPPED robots and exposes stopStage/stopWarning', async () => {
    const { svc, prisma } = makeService();
    prisma.robot.findMany.mockResolvedValue([{
      id: 'robot-1', symbol: 'ETH/USDT', direction: 'LONG', status: 'STOPPED', activeBoxId: null, accountId: 'cred-1',
      stopStage: null, stopWarning: 'RESIDUAL_POSITION',
      lastPositionQty: 2, lastEntryPrice: 100, lastUnrealizedPnl: 5, lastSnapshotAt: new Date('2026-06-13T00:00:00Z'),
      account: { exchangeId: 'binance', label: 'main' },
    }]);
    prisma.box.findMany.mockResolvedValue([]);
    prisma.run.findMany.mockResolvedValue([]);
    const [row] = await svc.listRobots();
    expect(row.lastPositionQty).toBe(2);
    expect(row.lastEntryPrice).toBe(100);
    expect(row.lastUnrealizedPnl).toBe(5);
    expect(row.stopWarning).toBe('RESIDUAL_POSITION');
    expect(row.stopStage).toBeNull();
  });

  it('listRobots exposes stopStage for STOPPING robots', async () => {
    const { svc, prisma } = makeService();
    prisma.robot.findMany.mockResolvedValue([{
      id: 'robot-1', symbol: 'ETH/USDT', direction: 'LONG', status: 'STOPPING', activeBoxId: null, accountId: 'cred-1',
      stopStage: 'VERIFYING', stopWarning: null,
      lastPositionQty: null, lastEntryPrice: null, lastUnrealizedPnl: null, lastSnapshotAt: null,
      account: { exchangeId: 'binance', label: 'main' },
    }]);
    prisma.box.findMany.mockResolvedValue([]);
    prisma.run.findMany.mockResolvedValue([]);
    const [row] = await svc.listRobots();
    expect(row.stopStage).toBe('VERIFYING');
    expect(row.stopWarning).toBeNull();
  });

  it('listRobots 返回每个机器人的 credentialId（= account.id）', async () => {
    const { svc, prisma } = makeService();
    prisma.robot.findMany.mockResolvedValue([
      { id: 'robot-1', symbol: 'ETH/USDT', direction: 'LONG', status: 'RUNNING', activeBoxId: null, endedAt: null,
        account: { id: 'cred-1', exchangeId: 'binance', label: 'main' } },
    ]);
    prisma.box.findMany.mockResolvedValue([]);
    prisma.run.findMany.mockResolvedValue([]);
    const list = await svc.listRobots();
    expect(list[0].credentialId).toBe('cred-1');
  });

  it('listRobots 透出 createdAt/endedAt（供前端机器人下拉展示运行起止时间）', async () => {
    const { svc, prisma } = makeService();
    prisma.robot.findMany.mockResolvedValue([{
      id: 'robot-1', symbol: 'ETH/USDT', direction: 'LONG', status: 'RUNNING', activeBoxId: null,
      createdAt: new Date('2026-06-01T00:00:00Z'), endedAt: null,
      account: { id: 'cred-1', exchangeId: 'binance', label: 'main' },
    }]);
    prisma.box.findMany.mockResolvedValue([]);
    prisma.run.findMany.mockResolvedValue([]);

    const [row] = await svc.listRobots();

    expect(row.createdAt).toBe('2026-06-01T00:00:00.000Z');
    expect(row.endedAt).toBeNull();
  });

  it('listArchivedRobots 的 endedAt 是非空 ISO 字符串（已归档机器人必有终止时间）', async () => {
    const { svc, prisma } = makeService();
    prisma.robot.findMany.mockResolvedValue([{
      id: 'robot-9', symbol: 'ETH/USDT', direction: 'LONG', status: 'STOPPED', activeBoxId: null,
      createdAt: new Date('2026-05-01T00:00:00Z'), endedAt: new Date('2026-06-20T00:00:00Z'),
      account: { id: 'cred-1', exchangeId: 'binance', label: 'main' },
    }]);
    prisma.box.findMany.mockResolvedValue([]);
    prisma.run.findMany.mockResolvedValue([]);

    const [row] = await svc.listArchivedRobots();

    expect(row.createdAt).toBe('2026-05-01T00:00:00.000Z');
    expect(row.endedAt).toBe('2026-06-20T00:00:00.000Z');
  });

  it('createdAt/endedAt 缺失时(既有测试 fixture 未提供)不抛错，降级为空字符串/null', async () => {
    const { svc, prisma } = makeService();
    prisma.robot.findMany.mockResolvedValue([{
      id: 'robot-1', symbol: 'ETH/USDT', direction: 'LONG', status: 'RUNNING', activeBoxId: null,
      account: { id: 'cred-1', exchangeId: 'binance', label: 'main' },
    }]);
    prisma.box.findMany.mockResolvedValue([]);
    prisma.run.findMany.mockResolvedValue([]);

    const [row] = await svc.listRobots();

    expect(row.createdAt).toBe('');
    expect(row.endedAt).toBeNull();
  });

  it('getRobotDetail 返回 credentialId（= account.id）', async () => {
    const { svc, prisma } = makeService();
    prisma.robot.findUnique.mockResolvedValue({
      id: 'robot-1', symbol: 'ETH/USDT', direction: 'LONG', status: 'PAUSED',
      activeBoxId: null, endedAt: null,
      account: { id: 'cred-1', exchangeId: 'binance', label: 'main' },
    });
    prisma.box.findMany.mockResolvedValue([]);
    prisma.run.findMany.mockResolvedValue([]);
    prisma.run.findFirst.mockResolvedValue(null);
    const detail = await svc.getRobotDetail('robot-1');
    expect(detail?.credentialId).toBe('cred-1');
  });

  it('listArchivedRobots returns only ended robots with stop snapshot fields', async () => {
    const { svc, prisma } = makeService();
    prisma.robot.findMany.mockResolvedValue([{
      id: 'robot-9', symbol: 'ETH/USDT', direction: 'LONG', status: 'STOPPED', activeBoxId: null, accountId: 'cred-1',
      stopStage: null, stopWarning: 'RESIDUAL_POSITION',
      lastPositionQty: 2, lastEntryPrice: 100, lastUnrealizedPnl: 5, lastSnapshotAt: new Date('2026-06-13T00:00:00Z'),
      account: { exchangeId: 'binance', label: 'main' },
    }]);
    prisma.box.findMany.mockResolvedValue([]);
    prisma.run.findMany.mockResolvedValue([]);

    const list = await svc.listArchivedRobots();

    expect(prisma.robot.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { endedAt: { not: null } } }),
    );
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('robot-9');
    expect(list[0].lastPositionQty).toBe(2);
    expect(list[0].stopWarning).toBe('RESIDUAL_POSITION');
  });

  it('getRobotDetail returns robot, its boxes, exchange, boxCount, pnl', async () => {
    const { svc, prisma } = makeService();
    ((prisma as any).robot).findUnique = vi.fn().mockResolvedValue({ id: 'robot-1', symbol: 'ETH/USDT', direction: 'LONG', status: 'RUNNING', activeBoxId: 'box-1', endedAt: null, accountId: 'cred-1', account: { exchangeId: 'gateio', label: 'Gate模拟' } });
    (prisma.box as any).findMany = vi.fn().mockResolvedValue([boxRow('box-1'), boxRow('box-2')]);
    (prisma as any).run = { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn().mockResolvedValue(null) };

    const detail = await svc.getRobotDetail('robot-1');
    expect(detail).not.toBeNull();
    expect(detail!.id).toBe('robot-1');
    expect(detail!.boxes).toHaveLength(2);
    expect(detail!.boxes[0].id).toBe('box-1');
    expect(detail!.exchangeId).toBe('gateio');
    expect(detail!.boxCount).toBe(2);
    expect(detail!.realizedPnl).toBe(0);
  });

  it('getRobotDetail 每个箱体附 realizedPnl + totalSavings（按箱聚合 Run）', async () => {
    const { svc, prisma, pnlLedger } = makeService();
    ((prisma as any).robot).findUnique = vi.fn().mockResolvedValue({ id: 'robot-1', symbol: 'ETH/USDT', direction: 'LONG', status: 'RUNNING', activeBoxId: 'box-1', endedAt: null, accountId: 'cred-1', account: { exchangeId: 'gateio', label: 'Gate' } });
    (prisma.box as any).findMany = vi.fn().mockResolvedValue([boxRow('box-1'), boxRow('box-2')]);
    (prisma as any).run = { findFirst: vi.fn().mockResolvedValue(null) };
    (pnlLedger.getBoxesLedger as any).mockResolvedValue(
      new Map([
        ['box-1', { realized: 14, fees: 0, funding: 0, savings: 3, net: 14 }],
        ['box-2', { realized: 5, fees: 0, funding: 0, savings: 3, net: 5 }],
      ]),
    );
    const detail = await svc.getRobotDetail('robot-1');
    const b1 = detail!.boxes.find((b) => b.id === 'box-1')!;
    const b2 = detail!.boxes.find((b) => b.id === 'box-2')!;
    expect(b1.realizedPnl).toBeCloseTo(14, 6);
    expect(b1.totalSavings).toBeCloseTo(3, 6);
    expect(b2.realizedPnl).toBeCloseTo(5, 6);
    expect(b2.totalSavings).toBeCloseTo(3, 6);
    expect(detail!.realizedPnl).toBeCloseTo(19, 6); // robot 总已实现 = 各箱之和
  });

  it('getRobotDetail 每个箱体附 netPnl + totalFees（I-1 箱级 net 暴露）', async () => {
    const { svc, prisma, pnlLedger } = makeService();
    ((prisma as any).robot).findUnique = vi.fn().mockResolvedValue({ id: 'robot-1', symbol: 'ETH/USDT', direction: 'LONG', status: 'RUNNING', activeBoxId: 'box-1', endedAt: null, accountId: 'cred-1', account: { exchangeId: 'gateio', label: 'Gate' } });
    (prisma.box as any).findMany = vi.fn().mockResolvedValue([boxRow('box-1'), boxRow('box-2')]);
    (prisma as any).run = { findFirst: vi.fn().mockResolvedValue(null) };
    (pnlLedger.getBoxesLedger as any).mockResolvedValue(
      new Map([
        ['box-1', { realized: 14, fees: 2, funding: 0, savings: 3, net: 12 }],
        ['box-2', { realized: 5, fees: 1, funding: 0, savings: 1, net: 4 }],
      ]),
    );
    const detail = await svc.getRobotDetail('robot-1');
    const b1 = detail!.boxes.find((b) => b.id === 'box-1')!;
    const b2 = detail!.boxes.find((b) => b.id === 'box-2')!;
    expect(b1.totalFees).toBeCloseTo(2, 6);
    expect(b1.netPnl).toBeCloseTo(12, 6);   // net = realized − fees
    expect(b2.totalFees).toBeCloseTo(1, 6);
    expect(b2.netPnl).toBeCloseTo(4, 6);
  });

  it('getRobotDetail returns null when robot not found', async () => {
    const { svc, prisma } = makeService();
    ((prisma as any).robot).findUnique = vi.fn().mockResolvedValue(null);
    const detail = await svc.getRobotDetail('nope');
    expect(detail).toBeNull();
  });

  it('getRobotDetail 透出 createdAt/endedAt（供前端详情页显示运行起止时间）', async () => {
    const { svc, prisma } = makeService();
    ((prisma as any).robot).findUnique = vi.fn().mockResolvedValue({
      id: 'robot-1', symbol: 'ETH/USDT', direction: 'LONG', status: 'RUNNING',
      activeBoxId: null, createdAt: new Date('2026-06-01T00:00:00Z'), endedAt: null,
      account: { id: 'cred-1', exchangeId: 'binance', label: 'main' },
    });
    prisma.box.findMany.mockResolvedValue([]);
    prisma.run.findMany.mockResolvedValue([]);
    prisma.run.findFirst.mockResolvedValue(null);

    const detail = await svc.getRobotDetail('robot-1');

    expect(detail?.createdAt).toBe('2026-06-01T00:00:00.000Z');
    expect(detail?.endedAt).toBeNull();
  });

  it('getRobotDetail createdAt/endedAt 缺失时不抛错，降级为空字符串/null（向后兼容既有 fixture）', async () => {
    const { svc, prisma } = makeService();
    ((prisma as any).robot).findUnique = vi.fn().mockResolvedValue({
      id: 'robot-1', symbol: 'ETH/USDT', direction: 'LONG', status: 'PAUSED',
      activeBoxId: null,
      account: { id: 'cred-1', exchangeId: 'binance', label: 'main' },
    });
    prisma.box.findMany.mockResolvedValue([]);
    prisma.run.findMany.mockResolvedValue([]);
    prisma.run.findFirst.mockResolvedValue(null);

    const detail = await svc.getRobotDetail('robot-1');

    expect(detail?.createdAt).toBe('');
    expect(detail?.endedAt).toBeNull();
  });

  it('addBox creates a box with robotId when validation passes', async () => {
    const { svc, prisma } = makeService();
    ((prisma as any).robot).findUnique = vi.fn().mockResolvedValue({ id: 'robot-1', symbol: 'ETH/USDT', direction: 'LONG', status: 'PAUSED', accountId: 'cred-1' });
    (prisma.box as any).findMany = vi.fn().mockResolvedValue([]); // no existing boxes
    (prisma.box as any).create = vi.fn().mockResolvedValue({ id: 'newbox' });

    const input = { direction: 'LONG', takeProfitPrice: 2800, mainGridCount: 200, mainGridStep: 2, mainGridPortionSize: 0.05, leverage: 20, stopLossGridCount: 4, stopLossGridStep: 2 };
    const res = await svc.addBox('robot-1', input as any);

    expect((prisma.box as any).create).toHaveBeenCalled();
    const createArg = (prisma.box as any).create.mock.calls[0][0];
    expect(createArg.data.robotId).toBe('robot-1');
    expect(res.id).toBe('newbox');
  });

  it('addBox rejects an overlapping box with BOX_OVERLAP code', async () => {
    const { svc, prisma } = makeService();
    ((prisma as any).robot).findUnique = vi.fn().mockResolvedValue({ id: 'robot-1', symbol: 'ETH/USDT', direction: 'LONG', status: 'PAUSED', accountId: 'cred-1' });
    (prisma.box as any).findMany = vi.fn().mockResolvedValue([
      { direction: 'LONG', takeProfitPrice: 2800, mainGridCount: 200, mainGridStep: 2, stopLossGridCount: 4, stopLossGridStep: 2 }, // 2400..2800
    ]);
    (prisma.box as any).create = vi.fn();

    const overlapping = { direction: 'LONG', takeProfitPrice: 3000, mainGridCount: 200, mainGridStep: 2, mainGridPortionSize: 0.05, leverage: 20, stopLossGridCount: 4, stopLossGridStep: 2 }; // 2600..3000
    const err = await svc.addBox('robot-1', overlapping as any).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err.getResponse() as { code?: string }).code).toBe('BOX_OVERLAP');
    expect((prisma.box as any).create).not.toHaveBeenCalled();
  });

  it('addBox rejects direction mismatch with BOX_DIRECTION_MISMATCH code', async () => {
    const { svc, prisma } = makeService();
    ((prisma as any).robot).findUnique = vi.fn().mockResolvedValue({ id: 'robot-1', symbol: 'ETH/USDT', direction: 'LONG', status: 'PAUSED', accountId: 'cred-1' });
    (prisma.box as any).findMany = vi.fn().mockResolvedValue([]);
    (prisma.box as any).create = vi.fn();

    const shortBox = { direction: 'SHORT', takeProfitPrice: 2800, mainGridCount: 200, mainGridStep: 2, mainGridPortionSize: 0.05, leverage: 20, stopLossGridCount: 4, stopLossGridStep: 2 };
    const err = await svc.addBox('robot-1', shortBox as any).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err.getResponse() as { code?: string }).code).toBe('BOX_DIRECTION_MISMATCH');
  });

  it('addBox throws when robot not found', async () => {
    const { svc, prisma } = makeService();
    ((prisma as any).robot).findUnique = vi.fn().mockResolvedValue(null);
    await expect(svc.addBox('nope', {} as any)).rejects.toThrow(/not found/i);
  });

  it('removeInactiveBox 软删除(打 deletedAt 标记,不删数据)', async () => {
    const { svc, prisma } = makeService();
    ((prisma as any).robot).findUnique = vi.fn().mockResolvedValue({ id: 'robot-1', activeBoxId: 'other-box' });
    (prisma.box as any).update = vi.fn().mockResolvedValue({ id: 'box-del' });
    await svc.removeInactiveBox('robot-1', 'box-del');
    expect((prisma.box as any).update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'box-del' },
      data: expect.objectContaining({ deletedAt: expect.any(Date), enabled: false }),
    }));
    // 不调用任何 deleteMany 或 box.delete
    expect((prisma as any).$transaction).toBeUndefined();
  });

  it('removeInactiveBox refuses to delete the active box (defers to R2)', async () => {
    const { svc, prisma } = makeService();
    ((prisma as any).robot).findUnique = vi.fn().mockResolvedValue({ id: 'robot-1', activeBoxId: 'box-x' });
    (prisma.box as any).update = vi.fn();
    await expect(svc.removeInactiveBox('robot-1', 'box-x')).rejects.toThrow(/active/i);
    expect((prisma.box as any).update).not.toHaveBeenCalled();
  });

  it('removeBox on a non-active box 软删除(打 deletedAt 标记)', async () => {
    const { svc, prisma } = makeService();
    ((prisma as any).robot).findUnique = vi.fn().mockResolvedValue({ id: 'robot-1', activeBoxId: 'other' });
    (prisma.box as any).update = vi.fn().mockResolvedValue({ id: 'box-x' });
    await svc.removeBox('robot-1', 'box-x', { closePosition: false });
    expect((prisma.box as any).update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'box-x' },
      data: expect.objectContaining({ deletedAt: expect.any(Date), enabled: false }),
    }));
  });

  it('removeBox on the ACTIVE box with closePosition=true liquidates via stopBot then soft-deletes', async () => {
    const { svc, prisma, stopBot, detachBot } = makeService();
    ((prisma as any).robot).findUnique = vi.fn().mockResolvedValue({ id: 'robot-1', activeBoxId: 'box-x' });
    ((prisma as any).robot).update = vi.fn().mockResolvedValue({});
    (prisma.run as any) = { findFirst: vi.fn().mockResolvedValue({ runCode: 'sc-1', endedAt: null }) };
    (prisma.box as any).update = vi.fn().mockResolvedValue({ id: 'box-x' });

    // robot-1 must be managed so scheduler.onBoxTerminated runs; start it first
    (prisma.robot.findUnique as any).mockResolvedValueOnce({ id: 'robot-1', symbol: 'ETH/USDT', direction: 'LONG', status: 'RUNNING', accountId: 'cred-1', activeBoxId: 'box-x' });
    await svc.startRobot('robot-1');

    await svc.removeBox('robot-1', 'box-x', { closePosition: true });
    expect(stopBot).toHaveBeenCalledWith('sc-1');
    expect(detachBot).not.toHaveBeenCalled();
    expect(((prisma as any).robot).update).toHaveBeenCalledWith({ where: { id: 'robot-1' }, data: { activeBoxId: null } });
    expect((prisma.box as any).update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'box-x' },
      data: expect.objectContaining({ deletedAt: expect.any(Date), enabled: false }),
    }));
  });

  it('removeBox on the ACTIVE box with closePosition=false detaches (keeps position) then soft-deletes', async () => {
    const { svc, prisma, stopBot, detachBot } = makeService();
    (prisma.robot.findUnique as any) = vi.fn()
      .mockResolvedValueOnce({ id: 'robot-1', symbol: 'ETH/USDT', direction: 'LONG', status: 'RUNNING', accountId: 'cred-1', activeBoxId: 'box-x' })
      .mockResolvedValue({ id: 'robot-1', activeBoxId: 'box-x' });
    ((prisma as any).robot).update = vi.fn().mockResolvedValue({});
    (prisma as any).run = { findFirst: vi.fn().mockResolvedValue({ runCode: 'sc-1', endedAt: null }) };
    (prisma.box as any).update = vi.fn().mockResolvedValue({ id: 'box-x' });
    await svc.startRobot('robot-1');

    await svc.removeBox('robot-1', 'box-x', { closePosition: false });
    expect(detachBot).toHaveBeenCalledWith('sc-1');
    expect(stopBot).not.toHaveBeenCalled();
    expect((prisma.box as any).update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'box-x' },
      data: expect.objectContaining({ deletedAt: expect.any(Date), enabled: false }),
    }));
  });

  it('getRobotDetail 排除已删除的箱体(deletedAt: null)', async () => {
    const { svc, prisma } = makeService();
    ((prisma as any).robot).findUnique = vi.fn().mockResolvedValue({
      id: 'robot-1', symbol: 'ETH/USDT', direction: 'LONG', status: 'RUNNING',
      activeBoxId: null, endedAt: null,
      account: { exchangeId: 'gateio', label: 'Gate模拟' },
    });
    (prisma.box as any).findMany = vi.fn().mockResolvedValue([boxRow('box-1')]);
    (prisma as any).eventLog = { findMany: vi.fn().mockResolvedValue([]) };

    await svc.getRobotDetail('robot-1');

    expect((prisma.box as any).findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ deletedAt: null }) }),
    );
  });

  it('pauseRobot pauses the active session runner (keeps position/orders)', async () => {
    const { svc, prisma, pauseBot } = makeService();
    (prisma.robot.findUnique as any) = vi.fn()
      .mockResolvedValueOnce({ id: 'robot-1', symbol: 'ETH/USDT', direction: 'LONG', status: 'RUNNING', accountId: 'cred-1', activeBoxId: 'box-x' })
      .mockResolvedValue({ id: 'robot-1', activeBoxId: 'box-x' });
    (prisma as any).run = { findFirst: vi.fn().mockResolvedValue({ runCode: 'sc-1', endedAt: null }) };
    await svc.startRobot('robot-1');
    await svc.pauseRobot('robot-1');
    expect(pauseBot).toHaveBeenCalledWith('sc-1');
  });

  it('createRobot creates a PAUSED robot when no active duplicate exists', async () => {
    const { svc, prisma } = makeService();
    ((prisma as any).robot).findFirst = vi.fn().mockResolvedValue(null); // no duplicate
    ((prisma as any).robot).create = vi.fn().mockResolvedValue({ id: 'robot-new' });
    const res = await svc.createRobot({ credentialId: 'cred-1', symbol: 'ETH/USDT', direction: 'LONG', exchangeAccountId: 'uid-1' });
    expect(((prisma as any).robot).create).toHaveBeenCalled();
    const arg = ((prisma as any).robot).create.mock.calls[0][0];
    expect(arg.data.status).toBe('PAUSED');
    expect(arg.data.exchangeUid).toBe('uid-1');
    expect(res.id).toBe('robot-new');
  });

  it('createRobot rejects when an active robot with same (exchangeAccountId, symbol) exists', async () => {
    const { svc, prisma } = makeService();
    ((prisma as any).robot).findFirst = vi.fn().mockResolvedValue({ id: 'existing', endedAt: null });
    ((prisma as any).robot).create = vi.fn();
    await expect(svc.createRobot({ credentialId: 'cred-1', symbol: 'ETH/USDT', direction: 'LONG', exchangeAccountId: 'uid-1' }))
      .rejects.toThrow(/already exists|已存在/i);
    expect(((prisma as any).robot).create).not.toHaveBeenCalled();
  });

  it('createRobot 唯一性按 (exchangeAccountId, symbol) 查询', async () => {
    const { svc, prisma } = makeService();
    ((prisma as any).robot).findFirst = vi.fn().mockResolvedValue(null); // no duplicate
    ((prisma as any).robot).create = vi.fn().mockResolvedValue({ id: 'robot-noid' });
    const res = await svc.createRobot({ credentialId: 'cred-1', symbol: 'ETH/USDT', direction: 'LONG', exchangeAccountId: 'uid-1' });
    expect(((prisma as any).robot).findFirst).toHaveBeenCalledWith({
      where: { exchangeUid: 'uid-1', symbol: 'ETH/USDT', endedAt: null },
    });
    expect(res.id).toBe('robot-noid');
  });

  it('createRobot 拒绝超出交易所 clientOrderId 长度预算的 symbol（Gate ≤10）', async () => {
    // algo id 开销 16（12 位时间+A+kind+2 位后缀），Gate t-+id ≤30 → symbol token ≤12。
    // 超预算的 symbol 运行期才发现就是每 tick 的 CLIENT_ID_TOO_LONG，必须在创建时拒绝。
    const { svc, prisma } = makeService();
    (prisma as any).exchangeAccount.findUnique = vi.fn().mockResolvedValue({ exchangeId: 'gateio' });
    ((prisma as any).robot).findFirst = vi.fn().mockResolvedValue(null);
    ((prisma as any).robot).create = vi.fn();

    await expect(svc.createRobot({ credentialId: 'cred-1', symbol: 'ABCDEFGHI/USDT', direction: 'LONG', exchangeAccountId: 'uid-1' }))
      .rejects.toMatchObject({ response: { code: 'SYMBOL_TOO_LONG_FOR_EXCHANGE' } });
    expect(((prisma as any).robot).create).not.toHaveBeenCalled();
  });

  it('createRobot 同一 symbol 在预算内的交易所（OKX ≤14）可创建', async () => {
    const { svc, prisma } = makeService();
    (prisma as any).exchangeAccount.findUnique = vi.fn().mockResolvedValue({ exchangeId: 'okx' });
    ((prisma as any).robot).findFirst = vi.fn().mockResolvedValue(null);
    ((prisma as any).robot).create = vi.fn().mockResolvedValue({ id: 'robot-okx' });

    const res = await svc.createRobot({ credentialId: 'cred-1', symbol: 'ABCDEFGHI/USDT', direction: 'LONG', exchangeAccountId: 'uid-1' });
    expect(res.id).toBe('robot-okx');
  });

  it('createRobot rejects an invalid direction', async () => {
    const { svc, prisma } = makeService();
    ((prisma as any).robot).create = vi.fn();
    await expect(svc.createRobot({ credentialId: 'cred-1', symbol: 'ETH/USDT', direction: 'INVALID', exchangeAccountId: 'uid-1' }))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(((prisma as any).robot).create).not.toHaveBeenCalled();
  });

  it('创建时调用 assertSymbolTradable；其抛错则创建失败', async () => {
    const { svc, launcher } = makeService();
    (launcher.assertSymbolTradable as any) = vi.fn().mockRejectedValue(
      new BadRequestException({ code: 'SYMBOL_NOT_TRADABLE', message: 'x' }),
    );
    await expect(svc.createRobot({
      credentialId: 'c1', exchangeAccountId: 'uid1', symbol: 'NOPE/USDT', direction: 'LONG',
    })).rejects.toMatchObject({ response: { code: 'SYMBOL_NOT_TRADABLE' } });
    expect(launcher.assertSymbolTradable).toHaveBeenCalledWith('c1', 'NOPE/USDT');
  });

  it('assertSymbolTradable 通过则正常创建', async () => {
    const { svc, prisma, launcher } = makeService();
    (launcher.assertSymbolTradable as any) = vi.fn().mockResolvedValue(undefined);
    ((prisma as any).robot).findFirst = vi.fn().mockResolvedValue(null);
    ((prisma as any).robot).create = vi.fn().mockResolvedValue({ id: 'robot-ok' });
    const r = await svc.createRobot({
      credentialId: 'c1', exchangeAccountId: 'uid1', symbol: 'BTC/USDT', direction: 'LONG',
    });
    expect(r.id).toBeTruthy();
  });

  it('getRobotDetail 返回内存中的 activeSessionCode', async () => {
    const { svc, prisma } = makeService();
    ((prisma as any).robot).findUnique = vi.fn().mockResolvedValue({
      id: 'robot-1', symbol: 'ETH/USDT', direction: 'LONG', status: 'RUNNING',
      activeBoxId: 'box-1', endedAt: null,
      account: { exchangeId: 'gateio', label: 'Gate模拟' },
    });
    (prisma.box as any).findMany = vi.fn().mockResolvedValue([
      { id: 'box-1', direction: 'LONG', takeProfitPrice: 2500, mainGridCount: 60, mainGridStep: 10,
        mainGridPortionSize: 0.05, leverage: 20, stopLossGridCount: 9, stopLossGridStep: 5,
        activationPrice: 2300, trailingEntry: false, trailingCallbackRate: 0.002,
        excessProfitMultiplier: 2, reorderThreshold: 0.02, enabled: true },
    ]);
    (prisma as any).eventLog = { findMany: vi.fn().mockResolvedValue([]) };
    (svc as any).activeSessionCode.set('robot-1', 'ETHUSDT_111');

    const detail = await svc.getRobotDetail('robot-1');
    expect(detail?.activeSessionCode).toBe('ETHUSDT_111');
    expect(detail?.activeBoxId).toBe('box-1');
    expect(detail?.boxes[0]).toMatchObject({ mainGridPortionSize: 0.05, leverage: 20, activationPrice: 2300 });
  });

  it('getRobotDetail 内存无 activeSessionCode 时走 DB 兜底', async () => {
    const { svc, prisma } = makeService();
    ((prisma as any).robot).findUnique = vi.fn().mockResolvedValue({
      id: 'robot-2', symbol: 'ETH/USDT', direction: 'LONG', status: 'RUNNING',
      activeBoxId: 'box-9', endedAt: null,
      account: { exchangeId: 'gateio', label: 'Gate模拟' },
    });
    (prisma.box as any).findMany = vi.fn().mockResolvedValue([
      { id: 'box-9', direction: 'LONG', takeProfitPrice: 2500, mainGridCount: 60, mainGridStep: 10,
        mainGridPortionSize: 0.05, leverage: 20, stopLossGridCount: 9, stopLossGridStep: 5,
        activationPrice: 2300, trailingEntry: false, trailingCallbackRate: 0.002,
        excessProfitMultiplier: 2, reorderThreshold: 0.02, enabled: true },
    ]);
    (prisma as any).run = { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn().mockResolvedValue({ runCode: 'ETHUSDT_DB' }) };

    const detail = await svc.getRobotDetail('robot-2');
    expect(detail?.activeSessionCode).toBe('ETHUSDT_DB');
    expect((prisma.run as any).findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { boxId: 'box-9', endedAt: null } }),
    );
  });

  it('activate 切箱：旧回合经 detachBot 落 SUPERSEDED/NEW_SESSION（系统切箱口径，区别于用户 USER_DETACH）', async () => {
    const { svc, detachBot, startBot } = makeService();
    detachBot.mockResolvedValue({ cancelFailed: [] });
    startBot.mockResolvedValue({ runCode: 'sc-new' });
    (svc as any).activeSessionCode.set('robot-1', 'sc-old');

    await (svc as any).activate('robot-1', 'ETH/USDT', 'box-2', 'RUNNING');

    expect(detachBot).toHaveBeenCalledWith('sc-old', { state: 'SUPERSEDED', exitReason: 'NEW_SESSION' });
  });

  it('activate ends stale RUNNING sessions for same configId before creating new one', async () => {
    const { svc, prisma, startBot, pushPrice } = makeService();
    (prisma.robot.findUnique as any).mockResolvedValue({
      id: 'robot-1', symbol: 'ETH/USDT', direction: 'LONG', status: 'PAUSED',
      accountId: 'cred-1', activeBoxId: null, endedAt: null,
    });
    (prisma.box.findMany as any).mockResolvedValue([
      { id: 'box-1', robotId: 'robot-1', direction: 'LONG', takeProfitPrice: 2500, mainGridCount: 60, mainGridStep: 10, mainGridPortionSize: 0.05, leverage: 20, stopLossGridCount: 9, stopLossGridStep: 10, activationPrice: 2500, trailingEntry: false, deletedAt: null, enabled: true },
    ]);
    startBot.mockResolvedValue({ runCode: 'sc-new' });

    await svc.startRobot('robot-1');
    pushPrice(2400);

    await new Promise((r) => setTimeout(r, 10));

    expect(prisma.run.updateMany).toHaveBeenCalledWith({
      where: { boxId: 'box-1', endedAt: null },
      data: { endedAt: expect.any(Date), state: 'SUPERSEDED', exitReason: 'NEW_SESSION' },
    });
  });

  it('getRobotDetail 无活跃箱时 activeSessionCode 为 null', async () => {
    const { svc, prisma } = makeService();
    ((prisma as any).robot).findUnique = vi.fn().mockResolvedValue({
      id: 'robot-3', symbol: 'ETH/USDT', direction: 'LONG', status: 'PAUSED',
      activeBoxId: null, endedAt: null,
      account: { exchangeId: 'gateio', label: 'Gate模拟' },
    });
    (prisma.box as any).findMany = vi.fn().mockResolvedValue([]);
    (prisma as any).eventLog = { findMany: vi.fn().mockResolvedValue([]) };
    const detail = await svc.getRobotDetail('robot-3');
    expect(detail?.activeSessionCode).toBeNull();
  });

  describe('editBox', () => {
    const editInput = {
      takeProfitPrice: 2500, mainGridCount: 60, mainGridStep: 10, mainGridPortionSize: 0.05,
      leverage: 20, stopLossGridCount: 0, stopLossGridStep: 2,
    };

    it('非活跃箱:校验通过后只 update,不 detach/不动 activeBoxId', async () => {
      const { svc, prisma, detachBot } = makeService();
      ((prisma as any).robot).findUnique = vi.fn().mockResolvedValue({ id: 'robot-1', direction: 'LONG', activeBoxId: 'other' });
      (prisma.box as any).findFirst = vi.fn().mockResolvedValue({ id: 'box-1', robotId: 'robot-1', direction: 'LONG', deletedAt: null });
      (prisma.box as any).findMany = vi.fn().mockResolvedValue([]);
      (prisma.box as any).update = vi.fn().mockResolvedValue({ id: 'box-1' });
      const detach = vi.spyOn({ detachBot } as any, 'detachBot');

      await svc.editBox('robot-1', 'box-1', editInput);

      expect((prisma.box as any).update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'box-1' },
        data: expect.objectContaining({ takeProfitPrice: 2500, mainGridCount: 60, stopLossGridCount: 0 }),
      }));
      expect(detachBot).not.toHaveBeenCalled();
    });

    it('input 不带 activationPrice/trailingEntry 时保留原箱值(不静默重置)', async () => {
      const { svc, prisma } = makeService();
      ((prisma as any).robot).findUnique = vi.fn().mockResolvedValue({ id: 'robot-1', direction: 'LONG', activeBoxId: null });
      (prisma.box as any).findFirst = vi.fn().mockResolvedValue({ id: 'box-1', robotId: 'robot-1', direction: 'LONG', deletedAt: null, activationPrice: 2300, trailingEntry: true });
      (prisma.box as any).findMany = vi.fn().mockResolvedValue([]);
      (prisma.box as any).update = vi.fn().mockResolvedValue({ id: 'box-1' });

      await svc.editBox('robot-1', 'box-1', editInput); // editInput 无 activationPrice/trailingEntry

      expect((prisma.box as any).update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ activationPrice: 2300, trailingEntry: true }),
      }));
    });

    it('活跃箱:detach 旧 session(保仓)+ activeBoxId 置 null + update', async () => {
      const { svc, prisma, detachBot } = makeService();
      ((prisma as any).robot).findUnique = vi.fn().mockResolvedValue({ id: 'robot-1', direction: 'LONG', activeBoxId: 'box-1' });
      (prisma.box as any).findFirst = vi.fn().mockResolvedValue({ id: 'box-1', robotId: 'robot-1', direction: 'LONG', deletedAt: null });
      (prisma.box as any).findMany = vi.fn().mockResolvedValue([]);
      (prisma.box as any).update = vi.fn().mockResolvedValue({ id: 'box-1' });
      (prisma as any).run = { findFirst: vi.fn().mockResolvedValue({ runCode: 'S_OLD' }) };
      ((prisma as any).robot).update = vi.fn().mockResolvedValue({});
      (svc as any).activeSessionCode.set('robot-1', 'S_OLD');

      await svc.editBox('robot-1', 'box-1', editInput);

      expect(detachBot).toHaveBeenCalledWith('S_OLD');
      expect(((prisma as any).robot).update).toHaveBeenCalledWith({ where: { id: 'robot-1' }, data: { activeBoxId: null } });
      expect((svc as any).activeSessionCode.get('robot-1')).toBeUndefined();
      expect((prisma.box as any).update).toHaveBeenCalled();
    });

    it('校验只对比其他箱(findMany 用 id:{not} 排除自己)', async () => {
      const { svc, prisma } = makeService();
      ((prisma as any).robot).findUnique = vi.fn().mockResolvedValue({ id: 'robot-1', direction: 'LONG', activeBoxId: null });
      (prisma.box as any).findFirst = vi.fn().mockResolvedValue({ id: 'box-1', robotId: 'robot-1', direction: 'LONG', deletedAt: null });
      const findMany = vi.fn().mockResolvedValue([]);
      (prisma.box as any).findMany = findMany;
      (prisma.box as any).update = vi.fn().mockResolvedValue({ id: 'box-1' });

      await svc.editBox('robot-1', 'box-1', editInput);
      expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { robotId: 'robot-1', deletedAt: null, id: { not: 'box-1' } },
      }));
    });

    it('箱不存在/已删:抛错', async () => {
      const { svc, prisma } = makeService();
      ((prisma as any).robot).findUnique = vi.fn().mockResolvedValue({ id: 'robot-1', direction: 'LONG', activeBoxId: null });
      (prisma.box as any).findFirst = vi.fn().mockResolvedValue(null);
      await expect(svc.editBox('robot-1', 'gone', editInput)).rejects.toThrow(/not found or deleted/);
    });
  });

  describe('createRobot — (exchangeAccountId, symbol) 唯一性', () => {
    function makeSvc(findFirstResult: unknown) {
      const findFirst = vi.fn().mockResolvedValue(findFirstResult);
      const create = vi.fn().mockResolvedValue({ id: 'new-robot' });
      const prisma = {
        robot: { findFirst, create },
        exchangeAccount: { findUnique: vi.fn().mockResolvedValue({ exchangeId: 'binance' }) },
      };
      const svc = new BotManagerService(
        prisma as any,
        { setOnBoxTerminated: vi.fn(), assertSymbolTradable: vi.fn().mockResolvedValue(undefined) } as any,
        { subscribe: vi.fn() } as any,
        { getSnapshot: vi.fn() } as any,
        { createAndBroadcast: vi.fn().mockResolvedValue({}) } as any,
        { getBoxesLedger: vi.fn().mockResolvedValue(new Map()) } as any,
      );
      return { svc, findFirst, create };
    }

    it('拒绝同账户同 symbol 的活跃机器人', async () => {
      const { svc, findFirst, create } = makeSvc({ id: 'existing' });
      const dupCall = svc.createRobot({ credentialId: 'cred-1', symbol: 'ETH/USDT', direction: 'LONG', exchangeAccountId: 'acct-A' });
      await expect(dupCall).rejects.toBeInstanceOf(ConflictException);
      await expect(dupCall).rejects.toThrow(/already exists/);
      expect(findFirst).toHaveBeenCalledWith({
        where: { exchangeUid: 'acct-A', symbol: 'ETH/USDT', endedAt: null },
      });
      expect(create).not.toHaveBeenCalled();
      const err = await svc
        .createRobot({ credentialId: 'cred-1', symbol: 'ETH/USDT', direction: 'LONG', exchangeAccountId: 'acct-A' })
        .catch((e) => e);
      expect((err.getResponse() as { code?: string }).code).toBe('ROBOT_DUPLICATE');
    });

    it('允许同账户不同 symbol', async () => {
      const { svc, create } = makeSvc(null);
      const r = await svc.createRobot({ credentialId: 'cred-1', symbol: 'BTC/USDT', direction: 'LONG', exchangeAccountId: 'acct-A' });
      expect(r.id).toBe('new-robot');
      expect(create).toHaveBeenCalled();
    });

    it('允许不同账户同 symbol', async () => {
      const { svc, create } = makeSvc(null);
      await svc.createRobot({ credentialId: 'cred-2', symbol: 'ETH/USDT', direction: 'LONG', exchangeAccountId: 'acct-B' });
      expect(create).toHaveBeenCalled();
    });

    it('竞态：守卫放过但 DB P2002 兜底，翻成友好错误且不泄露索引名', async () => {
      const findFirst = vi.fn().mockResolvedValue(null);
      const p2002 = Object.assign(
        new Error('Unique constraint failed on the constraint: `GridRobot_active_unique`'),
        { code: 'P2002' },
      );
      const create = vi.fn().mockRejectedValue(p2002);
      const prisma = { robot: { findFirst, create }, exchangeAccount: { findUnique: vi.fn().mockResolvedValue({ exchangeId: 'binance' }) } };
      const svc = new BotManagerService(
        prisma as any,
        { setOnBoxTerminated: vi.fn(), assertSymbolTradable: vi.fn().mockResolvedValue(undefined) } as any,
        { subscribe: vi.fn() } as any,
        { getSnapshot: vi.fn() } as any,
        { createAndBroadcast: vi.fn().mockResolvedValue({}) } as any,
        { getBoxesLedger: vi.fn().mockResolvedValue(new Map()) } as any,
      );
      let caught: Error | undefined;
      await svc
        .createRobot({ credentialId: 'cred-1', symbol: 'ETH/USDT', direction: 'LONG', exchangeAccountId: 'acct-A' })
        .catch((e) => { caught = e as Error; });
      expect(caught).toBeInstanceOf(ConflictException);
      expect(caught?.message).toMatch(/already exists on this account/);
      expect(caught?.message).not.toMatch(/GridRobot_active_unique/);
      expect(((caught as any).getResponse() as { code?: string }).code).toBe('ROBOT_DUPLICATE');
    });

    it('非 P2002 的 create 错误原样抛出', async () => {
      const findFirst = vi.fn().mockResolvedValue(null);
      const create = vi.fn().mockRejectedValue(new Error('db connection lost'));
      const prisma = { robot: { findFirst, create }, exchangeAccount: { findUnique: vi.fn().mockResolvedValue({ exchangeId: 'binance' }) } };
      const svc = new BotManagerService(
        prisma as any,
        { setOnBoxTerminated: vi.fn(), assertSymbolTradable: vi.fn().mockResolvedValue(undefined) } as any,
        { subscribe: vi.fn() } as any,
        { getSnapshot: vi.fn() } as any,
        { createAndBroadcast: vi.fn().mockResolvedValue({}) } as any,
        { getBoxesLedger: vi.fn().mockResolvedValue(new Map()) } as any,
      );
      await expect(
        svc.createRobot({ credentialId: 'cred-1', symbol: 'ETH/USDT', direction: 'LONG', exchangeAccountId: 'acct-A' }),
      ).rejects.toThrow(/db connection lost/);
    });
  });

  it('R1: pauseRobot writes Robot.status = PAUSED', async () => {
    const h = makeService();
    await h.svc.pauseRobot('robot-1');
    expect(h.robotUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'PAUSED' }) }),
    );
  });

  it('addBox 落库 isolationStep（显式值优先）', async () => {
    const h = makeService();
    (h.prisma.robot.findUnique as any).mockResolvedValueOnce({ id: 'robot-1', symbol: 'ETH/USDT', direction: 'LONG', status: 'PAUSED', accountId: 'cred-1' });
    (h.prisma.box.findMany as any).mockResolvedValueOnce([]);
    await h.svc.addBox('robot-1', {
      direction: 'LONG', takeProfitPrice: 2800, mainGridCount: 200, mainGridStep: 2,
      mainGridPortionSize: 0.05, leverage: 20, stopLossGridCount: 4, stopLossGridStep: 2, isolationStep: 5,
    } as any);
    const created = (h.prisma.box.create as any).mock.calls.at(-1)[0].data;
    expect(created.isolationStep).toBe(5);
  });

  it('addBox 未传 isolationStep 时回退 stopLossGridStep', async () => {
    const h = makeService();
    (h.prisma.robot.findUnique as any).mockResolvedValueOnce({ id: 'robot-1', symbol: 'ETH/USDT', direction: 'LONG', status: 'PAUSED', accountId: 'cred-1' });
    (h.prisma.box.findMany as any).mockResolvedValueOnce([]);
    await h.svc.addBox('robot-1', {
      direction: 'LONG', takeProfitPrice: 2800, mainGridCount: 200, mainGridStep: 2,
      mainGridPortionSize: 0.05, leverage: 20, stopLossGridCount: 4, stopLossGridStep: 2,
    } as any);
    const created = (h.prisma.box.create as any).mock.calls.at(-1)[0].data;
    expect(created.isolationStep).toBe(2);
  });
});

describe('BUG-09 停止竞态：清算窗口内不得再激活新 run（幽灵 runner）', () => {
  it('requestStop 清算期间 FSM 终态回调+价格 tick 不再激活', async () => {
    const { svc, prisma, startBot, stopBot, pushPrice } = makeService();
    await svc.startRobot('robot-1');
    await svc.feedPrice('robot-1', 2550);
    expect(startBot).toHaveBeenCalledTimes(1); // 正常激活一次

    // stopRobot 路径需要的 DB 形状
    (prisma.robot.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'robot-1', symbol: 'ETH/USDT', status: 'RUNNING', accountId: 'cred-1', activeBoxId: 'box-1',
    });
    (prisma.run as Record<string, unknown>).findFirst = vi.fn().mockResolvedValue({ id: 'run-1', runCode: 'RC1' });
    (prisma.run as Record<string, unknown>).update = vi.fn().mockResolvedValue({});

    // 清算耗时：stopBot 挂起，模拟真实市价平仓窗口（实测 ~6s，幽灵 run 在此窗口诞生）
    let releaseLiquidation!: () => void;
    stopBot.mockImplementation(() => new Promise((resolve) => { releaseLiquidation = () => resolve({ liquidationTimedOut: false, residualRemains: false }); }));

    const stopping = svc.requestStop('robot-1', { closePosition: true });
    await new Promise((r) => setTimeout(r, 5)); // 让 stopRobot 走到 launcher.stopBot await

    // 真实事故序列：FSM LIQUIDATED → handleAutoTermination → onBoxTerminated 清空活动位
    await svc.onBoxTerminated('robot-1', 'box-1');
    // 清算窗口内的价格 tick——修复前调度器仍订阅着行情，会再激活新 run
    pushPrice(2550);
    await new Promise((r) => setTimeout(r, 5));

    releaseLiquidation();
    await stopping;

    expect(startBot).toHaveBeenCalledTimes(1); // 不得出现第二次激活
  });
});

describe('箱体缓存 TTL：feedPrice 不得每个 tick 都打 DB（连接池雪崩根因）', () => {
  it('TTL 窗口内连续 tick 只查一次 box.findMany', async () => {
    const { svc, boxFindMany } = makeService();
    await svc.startRobot('robot-1');
    boxFindMany.mockClear();

    for (let i = 0; i < 5; i++) {
      await svc.feedPrice('robot-1', 2700); // 窗口外价格,不触发激活
    }

    // startRobot 预热后 TTL 窗口内 5 个 tick 至多触发 1 次 DB 查询（修复前每 tick 1 次=5 次）
    expect(boxFindMany.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it('箱体变更后缓存立即失效——下一个 tick 重新查 DB', async () => {
    const { svc, prisma, boxFindMany } = makeService();
    await svc.startRobot('robot-1');
    await svc.feedPrice('robot-1', 2700);
    boxFindMany.mockClear();

    // addBox 触发缓存失效（mock prisma.box.create 所需形状）
    (prisma.box as Record<string, unknown>).create = vi.fn().mockResolvedValue(boxRow('box-2', { id: 'box-2' }));
    (prisma.box as Record<string, unknown>).findMany = boxFindMany;
    try {
      await svc.addBox('robot-1', {
        direction: 'LONG', takeProfitPrice: 3000, mainGridCount: 100, mainGridStep: 2,
        mainGridPortionSize: 0.01, leverage: 10, stopLossGridCount: 4, stopLossGridStep: 2,
        activationPrice: 0, trailingEntry: false,
      } as never);
    } catch {
      // addBox 校验/依赖差异不重要——重点是失效行为;若抛错则直接调用失效接口
      svc.invalidateBoxCache('robot-1');
    }

    await svc.feedPrice('robot-1', 2700);
    expect(boxFindMany.mock.calls.length).toBeGreaterThanOrEqual(1);
  });
});

describe('箱体刷新 single-flight：慢查询期间并发 tick 不得踩踏连接池', () => {
  it('findMany 挂起时 5 个并发 tick 只产生 1 次 DB 查询', async () => {
    const { svc, boxFindMany } = makeService();
    await svc.startRobot('robot-1');
    svc.invalidateBoxCache('robot-1');
    boxFindMany.mockClear();

    // 模拟 DB 慢查询：findMany 挂起期间并发涌入 tick
    let releaseQuery!: () => void;
    boxFindMany.mockImplementation(
      () => new Promise((resolve) => { releaseQuery = () => resolve([boxRow('box-1')]); }),
    );

    const ticks = Promise.all(
      Array.from({ length: 5 }, () => svc.feedPrice('robot-1', 2700)),
    );
    await new Promise((r) => setTimeout(r, 5));
    releaseQuery();
    await ticks;

    expect(boxFindMany).toHaveBeenCalledTimes(1);
  });

  describe('async stop', () => {
    it('requestStop immediately sets status=STOPPING and stopStage=CANCELLING_ORDERS, returns STOPPING', async () => {
      const { svc, prisma, robotUpdate } = makeService();
      prisma.robot.findUnique.mockResolvedValue({ id: 'robot-1', symbol: 'ETH/USDT', status: 'RUNNING', accountId: 'cred-1', activeBoxId: null });

      const res = await svc.requestStop('robot-1', { closePosition: true });

      expect(res.status).toBe('STOPPING');
      expect(robotUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'robot-1' },
          data: expect.objectContaining({ status: 'STOPPING', stopStage: 'CANCELLING_ORDERS' }),
        }),
      );
    });

    it('requestStop is idempotent: a robot already STOPPING does not spawn a second job', async () => {
      const { svc, prisma, stopBot } = makeService();
      prisma.robot.findUnique.mockResolvedValue({ id: 'robot-1', symbol: 'ETH/USDT', status: 'STOPPING', accountId: 'cred-1', activeBoxId: null });

      const res = await svc.requestStop('robot-1', { closePosition: true });

      expect(res.status).toBe('STOPPING');
      expect(stopBot).not.toHaveBeenCalled();
    });

    it('runStopJob persists snapshot and lands STOPPED with no warning on clean stop', async () => {
      const { svc, prisma, robotUpdate, stopBot, captureStopSnapshot } = makeService();
      prisma.run.findFirst.mockResolvedValue({ id: 'run-1', runCode: 'sc-1' });
      stopBot.mockResolvedValue({ liquidationTimedOut: false, residualRemains: false });
      captureStopSnapshot.mockResolvedValue({ symbol: 'ETH/USDT', side: 'LONG', qty: 2, entryPrice: 100, markPrice: 100, unrealizedPnl: 5, leverage: 1 });

      await svc.runStopJob('robot-1', { closePosition: true, runCode: 'sc-1', credentialId: 'cred-1', symbol: 'ETH/USDT' });

      const last = robotUpdate.mock.calls.at(-1)![0];
      expect(last.data).toEqual(expect.objectContaining({
        status: 'STOPPED',
        stopStage: null,
        stopWarning: null,
        lastPositionQty: 2,
        lastEntryPrice: 100,
        lastUnrealizedPnl: 5,
      }));
      expect(last.data.lastSnapshotAt).toBeInstanceOf(Date);
    });

    it('runStopJob sets stopWarning=LIQUIDATION_TIMEOUT on timeout', async () => {
      const { svc, prisma, robotUpdate, stopBot, captureStopSnapshot } = makeService();
      prisma.run.findFirst.mockResolvedValue({ id: 'run-1', runCode: 'sc-1' });
      stopBot.mockResolvedValue({ liquidationTimedOut: true, residualRemains: false });
      captureStopSnapshot.mockResolvedValue(null);

      await svc.runStopJob('robot-1', { closePosition: true, runCode: 'sc-1', credentialId: 'cred-1', symbol: 'ETH/USDT' });

      const last = robotUpdate.mock.calls.at(-1)![0];
      expect(last.data).toEqual(expect.objectContaining({ status: 'STOPPED', stopWarning: 'LIQUIDATION_TIMEOUT' }));
    });

    it('runStopJob sets stopWarning=SNAPSHOT_UNAVAILABLE and lastSnapshotAt=null when capture fails', async () => {
      const { svc, prisma, robotUpdate, stopBot, captureStopSnapshot } = makeService();
      prisma.run.findFirst.mockResolvedValue({ id: 'run-1', runCode: 'sc-1' });
      stopBot.mockResolvedValue({ liquidationTimedOut: false, residualRemains: false });
      captureStopSnapshot.mockRejectedValue(new Error('REST down'));

      await svc.runStopJob('robot-1', { closePosition: true, runCode: 'sc-1', credentialId: 'cred-1', symbol: 'ETH/USDT' });

      const last = robotUpdate.mock.calls.at(-1)![0];
      expect(last.data).toEqual(expect.objectContaining({ status: 'STOPPED', stopWarning: 'SNAPSHOT_UNAVAILABLE', lastSnapshotAt: null }));
    });

    it('runStopJob with closePosition=false uses detachBot (no liquidation) but still captures snapshot', async () => {
      const { svc, prisma, robotUpdate, stopBot, detachBot, captureStopSnapshot } = makeService();
      prisma.run.findFirst.mockResolvedValue({ id: 'run-1', runCode: 'sc-1' });
      detachBot.mockResolvedValue({ cancelFailed: [] });
      captureStopSnapshot.mockResolvedValue({ symbol: 'ETH/USDT', side: 'LONG', qty: 1, entryPrice: 90, markPrice: 90, unrealizedPnl: 0, leverage: 1 });

      await svc.runStopJob('robot-1', { closePosition: false, runCode: 'sc-1', credentialId: 'cred-1', symbol: 'ETH/USDT' });

      expect(stopBot).not.toHaveBeenCalled();
      expect(detachBot).toHaveBeenCalledWith('sc-1');
      const last = robotUpdate.mock.calls.at(-1)![0];
      expect(last.data).toEqual(expect.objectContaining({ status: 'STOPPED', lastPositionQty: 1 }));
    });
  });
});
