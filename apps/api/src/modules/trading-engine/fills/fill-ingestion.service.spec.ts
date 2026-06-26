import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FillIngestionService } from './fill-ingestion.service';

const RUN = {
  id: 'run1', runCode: 'RC1',
  configSnapshot: {
    takeProfitPrice: 2000, mainGridCount: 10, mainGridStep: 10, mainGridPortionSize: 0.01,
    stopLossGridCount: 4, stopLossGridStep: 5, direction: 'LONG',
  },
  realizedPnl: 0, totalFees: 0, totalSavings: 0, fillCount: 0,
  pnlSignedPosition: 0, pnlAvgCost: 0,
  box: { symbol: 'ETH/USDT', accountId: 'acct1' },
};

function makeMock() {
  return {
    run: { findUnique: vi.fn(), update: vi.fn() },
    order: { findFirst: vi.fn(), update: vi.fn(), create: vi.fn() },
    fill: { findUnique: vi.fn(), create: vi.fn(), findMany: vi.fn() },
    $transaction: vi.fn((ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
  };
}

describe('FillIngestionService', () => {
  let prisma: ReturnType<typeof makeMock>;
  let svc: FillIngestionService;

  beforeEach(() => {
    prisma = makeMock();
    svc = new FillIngestionService(prisma as any);
    prisma.run.findUnique.mockResolvedValue(RUN);
  });

  it('幂等：同一 (exchangeFillId, orderId) 摄入两次只记一笔、聚合只更新一次', async () => {
    const order = { id: 'o1', runId: 'run1', clientOrderId: 'c1', side: 'BUY', qty: 0.01, gridIndex: 0, filledQty: 0, avgFillPrice: null, status: 'PENDING', exchangeOrderId: null, filledAt: null };
    prisma.order.findFirst.mockResolvedValue(order);
    // first ingest: no existing fill; second ingest: fill exists
    prisma.fill.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'f1' });

    const ev = { orderId: 'ex-o1', fillId: 't1', qty: 0.01, price: 1990, timestamp: Date.now(), clientOrderId: 'c1', side: 'BUY' as const };
    await svc.ingest('RC1', ev);
    await svc.ingest('RC1', ev);

    expect(prisma.fill.create).toHaveBeenCalledTimes(1);
    expect(prisma.run.update).toHaveBeenCalledTimes(1);
  });

  it('部分成交 → Order 状态 PARTIALLY_FILLED 然后 FILLED，filledQty/avgFillPrice 正确', async () => {
    const order = { id: 'o2', runId: 'run1', clientOrderId: 'c2', side: 'BUY', qty: 1.0, gridIndex: -1, filledQty: 0, avgFillPrice: null, status: 'PENDING', exchangeOrderId: null, filledAt: null };
    prisma.order.findFirst.mockResolvedValue(order);
    prisma.fill.findUnique.mockResolvedValue(null);

    await svc.ingest('RC1', { orderId: 'ex2', fillId: 'tA', qty: 0.4, price: 100, timestamp: 1, clientOrderId: 'c2', side: 'BUY' });
    const firstUpdate = prisma.order.update.mock.calls[0][0].data;
    expect(firstUpdate.filledQty).toBeCloseTo(0.4, 8);
    expect(firstUpdate.avgFillPrice).toBeCloseTo(100, 8);
    expect(firstUpdate.status).toBe('PARTIALLY_FILLED');

    // simulate order now has 0.4 filled, run fillCount=1
    prisma.order.findFirst.mockResolvedValue({ ...order, filledQty: 0.4, avgFillPrice: 100 });
    prisma.run.findUnique.mockResolvedValue({ ...RUN, fillCount: 1 });
    await svc.ingest('RC1', { orderId: 'ex2', fillId: 'tB', qty: 0.6, price: 110, timestamp: 2, clientOrderId: 'c2', side: 'BUY' });
    const secondUpdate = prisma.order.update.mock.calls[1][0].data;
    expect(secondUpdate.filledQty).toBeCloseTo(1.0, 8);
    expect(secondUpdate.status).toBe('FILLED');
    expect(secondUpdate.avgFillPrice).toBeCloseTo(106, 6); // (100*0.4 + 110*0.6)/1.0
  });

  it('savings 用 run.configSnapshot 冻结写入 Fill 行（gridIndex>=0 且优于网格价时为正）', async () => {
    const order = { id: 'o3', runId: 'run1', clientOrderId: 'c3', side: 'BUY', qty: 0.01, gridIndex: 2, filledQty: 0, avgFillPrice: null, status: 'PENDING', exchangeOrderId: null, filledAt: null };
    prisma.order.findFirst.mockResolvedValue(order);
    prisma.fill.findUnique.mockResolvedValue(null);

    await svc.ingest('RC1', { orderId: 'ex3', fillId: 't3', qty: 0.01, price: 1900, timestamp: 1, clientOrderId: 'c3', side: 'BUY' });
    const created = prisma.fill.create.mock.calls[0][0].data;
    expect(created.savings).toBeGreaterThan(0);
    expect(typeof created.savingsRate).toBe('number');
    expect(created.exchangeFillId).toBe('t3');
    expect(created.fee).toBe(0); // commission undefined → 0
  });

  it('SELL 成交用 computeFillSavings 落 Fill.avgGridPrice 与 savings（按格价均价口径）', async () => {
    const sellRun = {
      ...RUN,
      configSnapshot: {
        takeProfitPrice: 2000, mainGridCount: 50, mainGridStep: 10, mainGridPortionSize: 0.01,
        stopLossGridCount: 4, stopLossGridStep: 5, isolationStep: 5, direction: 'LONG',
      },
    };
    prisma.run.findUnique.mockResolvedValue(sellRun);
    const order = { id: 'oAvg', runId: 'run1', clientOrderId: 'cAvg', side: 'SELL', qty: 0.025, gridIndex: 19, preOrderPosition: 0.205, filledQty: 0, avgFillPrice: null, status: 'PENDING', exchangeOrderId: null, filledAt: null };
    prisma.order.findFirst.mockResolvedValue(order);
    prisma.fill.findUnique.mockResolvedValue(null);

    await svc.ingest('RC1', { orderId: 'exAvg', fillId: 'tAvg', qty: 0.025, price: 1820.1, timestamp: 1, clientOrderId: 'cAvg', side: 'SELL' });

    const created = prisma.fill.create.mock.calls[0][0].data;
    expect(created.avgGridPrice).toBeCloseTo(1812, 2);
    expect(created.savings).toBeCloseTo((1820.1 - 1812) * 0.025, 5);
  });

  it('进场建仓单（isEntry=true）摄入：Fill.savings=0 且 Run.totalSavings 不增', async () => {
    // 进入箱体的市价建仓：传统网格也会同样建仓，非网格往返超额收益 → savings 记 0。
    const order = { id: 'oEntry', runId: 'run1', clientOrderId: 'cEntry', orderType: 'GRID_BUY', isEntry: true, side: 'BUY', qty: 0.2, gridIndex: 5, preOrderPosition: 0, filledQty: 0, avgFillPrice: null, status: 'PENDING', exchangeOrderId: null, filledAt: null };
    prisma.order.findFirst.mockResolvedValue(order);
    prisma.fill.findUnique.mockResolvedValue(null);

    await svc.ingest('RC1', { orderId: 'exEntry', fillId: 'tEntry', qty: 0.2, price: 1900, timestamp: 1, clientOrderId: 'cEntry', side: 'BUY' });

    const created = prisma.fill.create.mock.calls[0][0].data;
    expect(created.savings).toBe(0);
    expect(created.savingsRate).toBe(0);
    expect(created.avgGridPrice).toBe(0);
    const runUpdate = prisma.run.update.mock.calls[0][0].data;
    expect(runUpdate.totalSavings).toBe(0);
  });

  it('关闭平仓单（orderType=CLOSE）摄入：Fill.savings=0 且 Run.totalSavings 不增', async () => {
    const order = { id: 'oClose', runId: 'run1', clientOrderId: null, orderType: 'CLOSE', isEntry: false, side: 'SELL', qty: 0.2, gridIndex: null, preOrderPosition: 0.2, filledQty: 0, avgFillPrice: null, status: 'PENDING', exchangeOrderId: 'exClose', filledAt: null };
    prisma.order.findFirst.mockResolvedValue(order);
    prisma.fill.findUnique.mockResolvedValue(null);

    await svc.ingest('RC1', { orderId: 'exClose', fillId: 'tClose', qty: 0.2, price: 1950, timestamp: 1, side: 'SELL' });

    const created = prisma.fill.create.mock.calls[0][0].data;
    expect(created.savings).toBe(0);
    expect(created.avgGridPrice).toBe(0);
    const runUpdate = prisma.run.update.mock.calls[0][0].data;
    expect(runUpdate.totalSavings).toBe(0);
  });

  it('找不到 run 或 order 时安全跳过，不抛错、不写库', async () => {
    prisma.run.findUnique.mockResolvedValue(null);
    await svc.ingest('NOPE', { orderId: 'x', fillId: 'y', qty: 1, price: 1, timestamp: 1, clientOrderId: 'c', side: 'BUY' });
    expect(prisma.fill.create).not.toHaveBeenCalled();

    prisma.run.findUnique.mockResolvedValue(RUN);
    prisma.order.findFirst.mockResolvedValue(null);
    await svc.ingest('RC1', { orderId: 'x', fillId: 'y', qty: 1, price: 1, timestamp: 1, clientOrderId: 'cX', side: 'BUY' });
    expect(prisma.fill.create).not.toHaveBeenCalled();
  });

  it('本 run 算法单（紧急止损）触发的成交：补建 CLOSE Order 行后正常摄入', async () => {
    // algo 单不经 onOrderPlaced 落库，触发后的平仓成交若无兜底将被丢弃，
    // 止损平仓盈亏丢失——与 closePosition 不落库同类缺口。
    prisma.order.findFirst.mockResolvedValue(null);
    prisma.order.create.mockResolvedValue({
      id: 'oAlgo', runId: 'run1', clientOrderId: 'ETHUSDT260611071735AE3k', side: 'SELL',
      qty: 3.45, gridIndex: null, filledQty: 0, avgFillPrice: null, status: 'PENDING',
      exchangeOrderId: null, filledAt: null,
    });
    prisma.fill.findUnique.mockResolvedValue(null);
    const warnSpy = vi.spyOn((svc as any).logger, 'warn');

    await svc.ingest('ETHUSDT_260611071735', {
      orderId: 'ex-algo-1', fillId: 'tA1', qty: 3.45, price: 1640, timestamp: 1,
      clientOrderId: 'ETHUSDT260611071735AE3k', side: 'SELL',
    });

    expect(prisma.order.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        runId: 'run1',
        clientOrderId: 'ETHUSDT260611071735AE3k',
        orderType: 'CLOSE',
        isAlgo: true,
        side: 'SELL',
      }),
    }));
    expect(prisma.fill.create).toHaveBeenCalledTimes(1);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('紧急止损成交携带旧格式 clientOrderId（${runCode}_algo_emergency_）也应补建 CLOSE 并摄入（BUG-A）', async () => {
    // 真实 Binance/Gate 回报的 algo clientOrderId 为旧 verbose 格式，严格的
    // parseAlgoClientOrderId 不识别 → 止损平仓成交被丢弃，DB 持仓不减、已实现盈亏漏算。
    prisma.order.findFirst.mockResolvedValue(null);
    prisma.order.create.mockResolvedValue({
      id: 'oAlgoLegacy', runId: 'run1', clientOrderId: 'ETHUSDT_260611071735_algo_emergency_', side: 'SELL',
      qty: 3.5, gridIndex: null, filledQty: 0, avgFillPrice: null, status: 'PENDING',
      exchangeOrderId: null, filledAt: null,
    });
    prisma.fill.findUnique.mockResolvedValue(null);
    const warnSpy = vi.spyOn((svc as any).logger, 'warn');

    await svc.ingest('ETHUSDT_260611071735', {
      orderId: 'ex-stop-legacy', fillId: 'tStop1', qty: 3.5, price: 1654, timestamp: 1,
      clientOrderId: 'ETHUSDT_260611071735_algo_emergency_', side: 'SELL',
    });

    expect(prisma.order.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ orderType: 'CLOSE', isAlgo: true, side: 'SELL' }),
    }));
    expect(prisma.fill.create).toHaveBeenCalledTimes(1);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('永久丢失的网格单孤儿成交（早于回滚窗、clientOrderId 属本 run）→ 兜底补建 Order 行并入账', async () => {
    // onOrderPlaced 的 prisma.order.create 是 fire-and-forget，失败/重启会让 Order 行
    // 永久缺失；该订单成交无法匹配 → 旧逻辑直接丢弃，已实现盈亏丢失、持仓漂移。
    // 成交早于 order-before-fill 竞态窗口（5min），证明行不会再出现 → 按 fill 补建最小网格行。
    prisma.order.findFirst.mockResolvedValue(null);
    // 回显写入数据，模拟真实 Prisma「create 返回所写行」，使后续 savings 计算用到补建行的真实字段。
    prisma.order.create.mockImplementation(async (args: any) => ({
      id: 'oGrid', filledQty: 0, avgFillPrice: null, filledAt: null, ...args.data,
    }));
    prisma.fill.findUnique.mockResolvedValue(null);
    const warnSpy = vi.spyOn((svc as any).logger, 'warn');

    await svc.ingest('ETHUSDT_260611071735', {
      orderId: 'ex-grid-366', fillId: 'tG366', qty: 0.01, price: 1640,
      timestamp: Date.now() - 6 * 60_000, clientOrderId: 'ETHUSDT260611071735B366', side: 'BUY',
    });

    expect(prisma.order.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        runId: 'run1', clientOrderId: 'ETHUSDT260611071735B366',
        orderType: 'GRID_BUY', isAlgo: false, side: 'BUY',
      }),
    }));
    expect(prisma.fill.create).toHaveBeenCalledTimes(1);
    expect(warnSpy).not.toHaveBeenCalled();

    // 真实 preOrderPosition 已永久丢失，超额收益无法归属：补建行 savings 必须为 0，
    // 不得凭空把成交归到最浅档算出虚高 savings 污染 Run.totalSavings。
    const createdFill = prisma.fill.create.mock.calls[0][0].data;
    expect(createdFill.savings).toBe(0);
    const runUpdate = prisma.run.update.mock.calls[0][0].data;
    expect(runUpdate.totalSavings).toBe(0);
  });

  it('新鲜的网格单孤儿成交（窗口内，可能是 order-before-fill 竞态）→ 不补建，留给 reconcile 重拉自愈', async () => {
    // 窗口内立刻补建会和随后正常落库的 onOrderPlaced create 撞唯一约束、用残缺行（gridIndex
    // 缺失、preOrderPosition=0）顶掉完整行 → savings 算错。故新鲜孤儿不补建。
    prisma.order.findFirst.mockResolvedValue(null);
    const warnSpy = vi.spyOn((svc as any).logger, 'warn');

    await svc.ingest('ETHUSDT_260611071735', {
      orderId: 'ex-grid-fresh', fillId: 'tGfresh', qty: 0.01, price: 1640,
      timestamp: Date.now(), clientOrderId: 'ETHUSDT260611071735B367', side: 'BUY',
    });

    expect(prisma.order.create).not.toHaveBeenCalled();
    expect(prisma.fill.create).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledOnce();
  });

  it('网格单 clientOrderId 方向与成交方向不一致时不补建（防御自洽校验）', async () => {
    prisma.order.findFirst.mockResolvedValue(null);
    const warnSpy = vi.spyOn((svc as any).logger, 'warn');

    // clientOrderId 编码为 BUY（B），但成交方向是 SELL → 不自洽，拒绝补建。
    await svc.ingest('ETHUSDT_260611071735', {
      orderId: 'ex-mismatch', fillId: 'tMM', qty: 1, price: 1640,
      timestamp: Date.now() - 6 * 60_000, clientOrderId: 'ETHUSDT260611071735B400', side: 'SELL',
    });

    expect(prisma.order.create).not.toHaveBeenCalled();
    expect(prisma.fill.create).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledOnce();
  });

  it('他 run 的网格单成交（token 不匹配）即使够旧也不补建', async () => {
    prisma.order.findFirst.mockResolvedValue(null);
    const warnSpy = vi.spyOn((svc as any).logger, 'warn');

    await svc.ingest('ETHUSDT_260611071735', {
      orderId: 'ex-other-grid', fillId: 'tOG', qty: 1, price: 1640,
      timestamp: Date.now() - 6 * 60_000, clientOrderId: 'ETHUSDT260611999999B5', side: 'BUY',
    });

    expect(prisma.order.create).not.toHaveBeenCalled();
    expect(prisma.fill.create).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledOnce();
  });

  it('他 run 的算法单成交不补建行（token 不匹配走原 no-order 路径）', async () => {
    prisma.order.findFirst.mockResolvedValue(null);
    const warnSpy = vi.spyOn((svc as any).logger, 'warn');

    await svc.ingest('ETHUSDT_260611071735', {
      orderId: 'ex-algo-2', fillId: 'tA2', qty: 1, price: 1640, timestamp: 1,
      clientOrderId: 'ETHUSDT260611999999AE3k', side: 'SELL',
    });

    expect(prisma.order.create).not.toHaveBeenCalled();
    expect(prisma.fill.create).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledOnce();
  });

  it('成交属于其他 run 的订单时静默跳过，不打 no-order WARN', async () => {
    // 账户级 getMyTrades 会拉回相邻 run（如上一个 LIQUIDATED run 的平仓单）的
    // 成交；它们有归属、只是不属于本 run，每个 sweep 反复 WARN 纯属噪音。
    prisma.order.findFirst
      .mockResolvedValueOnce(null) // 本 run byClient 未命中
      .mockResolvedValueOnce(null) // 本 run byExchangeOrderId 未命中
      .mockResolvedValueOnce({ id: 'oX', runId: 'other-run' }); // 全局按 exchangeOrderId 命中他 run
    const warnSpy = vi.spyOn((svc as any).logger, 'warn');

    await svc.ingest('RC1', { orderId: 'ex-foreign', fillId: 'tF', qty: 3.45, price: 1650, timestamp: 1, clientOrderId: 'api', side: 'SELL' });

    expect(prisma.fill.create).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    // exchangeOrderId 仅单交易所内唯一：全局归属查询必须限定同账户
    expect(prisma.order.findFirst).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        run: { box: { accountId: 'acct1' } },
      }),
    }));
  });

  it('真无主成交（全局也查不到）仍然 WARN', async () => {
    prisma.order.findFirst.mockResolvedValue(null);
    const warnSpy = vi.spyOn((svc as any).logger, 'warn');

    await svc.ingest('RC1', { orderId: 'ex-unknown', fillId: 'tU', qty: 1, price: 1, timestamp: 1, clientOrderId: 'cU', side: 'BUY' });

    expect(prisma.fill.create).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledOnce();
  });

  it('真实手续费折算为计价货币累加到 Run.totalFees；Fill 行存原始 fee/feeAsset', async () => {
    const order = { id: 'o9', runId: 'run1', clientOrderId: 'c9', side: 'BUY', qty: 0.01, gridIndex: -1, filledQty: 0, avgFillPrice: null, status: 'PENDING', exchangeOrderId: null, filledAt: null };
    prisma.order.findFirst.mockResolvedValue(order);
    prisma.fill.findUnique.mockResolvedValue(null);
    prisma.run.findUnique.mockResolvedValue({ ...RUN, totalFees: 1, box: { symbol: 'ETH/USDT' } });

    // feeAsset=ETH（基础币）, fee=0.001, price=2000 → 折算 2 USDT
    await svc.ingest('RC1', { orderId: 'ex9', fillId: 't9', qty: 0.01, price: 2000, timestamp: 1, clientOrderId: 'c9', side: 'BUY', commission: 0.001, commissionAsset: 'ETH' });

    const runUpdate = prisma.run.update.mock.calls[0][0].data;
    expect(runUpdate.totalFees).toBeCloseTo(1 + 2, 6); // 折算后累加
    const fillData = prisma.fill.create.mock.calls[0][0].data;
    expect(fillData.fee).toBeCloseTo(0.001, 8); // Fill 存原始
    expect(fillData.feeAsset).toBe('ETH');
  });

  it('并发摄入：$transaction 抛 P2002 被吞掉，不抛错（幂等兜底）', async () => {
    const order = { id: 'oP', runId: 'run1', clientOrderId: 'cP', side: 'BUY', qty: 0.01, gridIndex: -1, filledQty: 0, avgFillPrice: null, status: 'PENDING', exchangeOrderId: null, filledAt: null };
    prisma.order.findFirst.mockResolvedValue(order);
    prisma.fill.findUnique.mockResolvedValue(null); // dedup 未命中（模拟竞态）
    prisma.run.findUnique.mockResolvedValue({ ...RUN, box: { symbol: 'ETH/USDT' } });
    (prisma as any).$transaction.mockRejectedValueOnce(Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }));

    await expect(svc.ingest('RC1', { orderId: 'exP', fillId: 'tP', qty: 0.01, price: 2000, timestamp: 1, clientOrderId: 'cP', side: 'BUY' })).resolves.toBeUndefined();
  });

  it('非 P2002 错误仍抛出', async () => {
    const order = { id: 'oQ', runId: 'run1', clientOrderId: 'cQ', side: 'BUY', qty: 0.01, gridIndex: -1, filledQty: 0, avgFillPrice: null, status: 'PENDING', exchangeOrderId: null, filledAt: null };
    prisma.order.findFirst.mockResolvedValue(order);
    prisma.fill.findUnique.mockResolvedValue(null);
    prisma.run.findUnique.mockResolvedValue({ ...RUN, box: { symbol: 'ETH/USDT' } });
    (prisma as any).$transaction.mockRejectedValueOnce(Object.assign(new Error('db down'), { code: 'P1001' }));

    await expect(svc.ingest('RC1', { orderId: 'exQ', fillId: 'tQ', qty: 0.01, price: 2000, timestamp: 1, clientOrderId: 'cQ', side: 'BUY' })).rejects.toThrow('db down');
  });

  it('并发摄入同一 run 的两笔不同成交：按 runCode 串行化，聚合不丢失增量', async () => {
    // 用可变状态模拟 DB：findUnique 读当前聚合快照，update 写回。
    // 未串行化时两笔会都读到 pos=0 基值、末写者覆盖 → 丢失更新。
    const runState = {
      ...RUN,
      pnlSignedPosition: 0, pnlAvgCost: 0,
      realizedPnl: 0, totalFees: 0, totalSavings: 0, fillCount: 0,
    };
    prisma.run.findUnique.mockImplementation(async () => ({ ...runState }));
    prisma.run.update.mockImplementation(async (args: any) => {
      Object.assign(runState, args.data);
      return runState;
    });
    prisma.order.findFirst.mockImplementation(async (args: any) => {
      const cid = args.where.clientOrderId;
      if (cid === 'cA') return { id: 'oA', runId: 'run1', clientOrderId: 'cA', side: 'BUY', qty: 10, gridIndex: -1, filledQty: 0, avgFillPrice: null, status: 'PENDING', exchangeOrderId: null, filledAt: null };
      if (cid === 'cB') return { id: 'oB', runId: 'run1', clientOrderId: 'cB', side: 'BUY', qty: 10, gridIndex: -1, filledQty: 0, avgFillPrice: null, status: 'PENDING', exchangeOrderId: null, filledAt: null };
      return null;
    });
    prisma.fill.findUnique.mockResolvedValue(null);

    await Promise.all([
      svc.ingest('RC1', { orderId: 'exA', fillId: 'tA', qty: 10, price: 100, timestamp: 1, clientOrderId: 'cA', side: 'BUY' }),
      svc.ingest('RC1', { orderId: 'exB', fillId: 'tB', qty: 10, price: 200, timestamp: 2, clientOrderId: 'cB', side: 'BUY' }),
    ]);

    // 两笔 BUY 各 10 → 仓位 20、fillCount 2。丢失更新时会是 10 / 1。
    expect(runState.pnlSignedPosition).toBe(20);
    expect(runState.fillCount).toBe(2);
  });

  it('摄入后 getCachedRealizedPnl 暴露 run 的已实现盈亏（供 getStatus 取数，而非 runner 恒0 stats）（BUG-01）', async () => {
    prisma.run.findUnique.mockResolvedValue({ ...RUN, realizedPnl: 5.5, pnlSignedPosition: 0.01, pnlAvgCost: 2000 });
    prisma.order.findFirst.mockResolvedValue({ id: 'oR', runId: 'run1', clientOrderId: 'cR', side: 'SELL', qty: 0.01, gridIndex: -1, filledQty: 0, avgFillPrice: null, status: 'PENDING', exchangeOrderId: null, filledAt: null });
    prisma.fill.findUnique.mockResolvedValue(null);

    // 平多 0.01 @2100（均价2000）→ 实现 +1.0；DB realizedPnl 5.5 → 6.5
    await svc.ingest('RC1', { orderId: 'exR', fillId: 'tR', qty: 0.01, price: 2100, timestamp: 1, clientOrderId: 'cR', side: 'SELL' });

    const updated = prisma.run.update.mock.calls.at(-1)![0].data.realizedPnl;
    expect(updated).toBeCloseTo(6.5, 6);
    expect(svc.getCachedRealizedPnl('RC1')).toBeCloseTo(6.5, 6);
  });

  it('seedRealizedPnl 在首笔成交前即可供 getStatus 读取冷启动已实现盈亏（BUG-01）', () => {
    svc.seedRealizedPnl('RCseed', 12.34);
    expect(svc.getCachedRealizedPnl('RCseed')).toBe(12.34);
  });

  it('buildConfig 用快照真实 isolationStep（≠ stopLossGridStep），缺失时回退 stopLossGridStep', () => {
    const cfg = (svc as any).buildConfig({ takeProfitPrice: 2800, mainGridCount: 200, mainGridStep: 2, mainGridPortionSize: 0.05, stopLossGridCount: 4, stopLossGridStep: 2, isolationStep: 7, direction: 'LONG' });
    expect(cfg.isolationStep).toBe(7);
    const cfg2 = (svc as any).buildConfig({ takeProfitPrice: 2800, mainGridCount: 200, mainGridStep: 2, mainGridPortionSize: 0.05, stopLossGridCount: 4, stopLossGridStep: 2, direction: 'LONG' });
    expect(cfg2.isolationStep).toBe(2); // 回退 stopLossGridStep
  });

  it('buildConfig 旧快照用 boxTop（rename 前字段）时回退取 takeProfitPrice，避免几何全负', () => {
    // 历史 run 的 configSnapshot 在 box_top→takeProfitPrice 改名前，仅有 boxTop。
    // 不回退则 takeProfitPrice=0 → 网格价全负 → savings 爆算。
    const cfg = (svc as any).buildConfig({ boxTop: 2000, mainGridCount: 40, mainGridStep: 10, mainGridPortionSize: 0.05, stopLossGridCount: 9, stopLossGridStep: 10, direction: 'LONG' });
    expect(cfg.takeProfitPrice).toBe(2000);
  });
});
