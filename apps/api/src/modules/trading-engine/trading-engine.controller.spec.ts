import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { TradingEngineController } from './trading-engine.controller';
import { TradingEngineService } from './trading-engine.service';
import { SessionService } from './session/session.service';
import { PersistenceService } from './persistence/persistence.service';
import { SavingsService } from './savings/savings.service';
import { AuthGuard } from '../auth/auth.guard';
import { PrismaService } from '../../prisma/prisma.service';
import type { BotStatus } from './trading-engine.service';
import { BotManagerService } from './robot/bot-manager.service';
import { CredentialService } from '../credential/credential.service';
import { ExchangeAdapterFactory } from '../exchange/exchange-adapter.factory';

const mockTradingEngineService = {
  getStatus: vi.fn(),
  getAllStatuses: vi.fn(),
  getAllAccountSnapshots: vi.fn().mockReturnValue([]),
  refreshAllSnapshots: vi.fn().mockResolvedValue([]),
  startBot: vi.fn(),
  stopBot: vi.fn(),
  pauseBot: vi.fn(),
  resumeBot: vi.fn(),
  reconcileRobot: vi.fn(),
};

const mockSessionService = {
  findAll: vi.fn(),
  findOne: vi.fn(),
  findOrders: vi.fn(),
};

const mockPrismaService = {
  eventLog: { findMany: vi.fn(), count: vi.fn() },
  box: { findMany: vi.fn(), findUnique: vi.fn() },
  run: { findUnique: vi.fn() },
  fill: { findMany: vi.fn(), count: vi.fn(), findFirst: vi.fn(), aggregate: vi.fn() },
  order: { count: vi.fn() },
  equitySnapshot: { findMany: vi.fn(), findFirst: vi.fn() },
};

const mockPersistenceService = {
  getFillsByConfigId: vi.fn(),
};

const mockSavingsService = {
  getSavingsSummary: vi.fn(),
  getSavingsSummaryBySession: vi.fn(),
  getRealizedPnlByConfig: vi.fn(),
  getRobotSummaryMetrics: vi.fn(),
};

const mockBotManagerService = {
  listRobots: vi.fn(),
  listArchivedRobots: vi.fn(),
  getRobotDetail: vi.fn(),
  startRobot: vi.fn(),
  pauseRobot: vi.fn(),
  requestStop: vi.fn(),
  addBox: vi.fn(),
  removeBox: vi.fn(),
  editBox: vi.fn(),
  createRobot: vi.fn(),
};

const mockCredentialService = { findOneWithSecrets: vi.fn() };
const mockAdapterFactory = { createAdapter: vi.fn() };

describe('TradingEngineController', () => {
  let controller: TradingEngineController;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [TradingEngineController],
      providers: [
        { provide: TradingEngineService, useValue: mockTradingEngineService },
        { provide: SessionService, useValue: mockSessionService },
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: PersistenceService, useValue: mockPersistenceService },
        { provide: SavingsService, useValue: mockSavingsService },
        { provide: BotManagerService, useValue: mockBotManagerService },
        { provide: CredentialService, useValue: mockCredentialService },
        { provide: ExchangeAdapterFactory, useValue: mockAdapterFactory },
      ],
    })
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = moduleRef.get<TradingEngineController>(TradingEngineController);
    vi.clearAllMocks();
    mockPrismaService.fill.aggregate.mockResolvedValue({ _sum: { fee: 0, savings: 0, realizedPnlDelta: 0 } });
  });

  describe('GET /trading-engine/dashboard', () => {
    it('returns aggregated KPIs: activeBots/totalReorders from runners, totalFills/totalOrdersPlaced from DB', async () => {
      const statuses: BotStatus[] = [
        {
          sessionCode: 'bot-a',
          exchange: 'BINANCE',
          state: 'RUNNING',
          symbol: 'ETH/USDT',
          direction: 'LONG',
          lastPrice: 2500,
          activeOrder: true,
          totalFills: 5,
          totalOrdersPlaced: 12,
          totalReorders: 3,
        },
        {
          sessionCode: 'bot-b',
          exchange: 'BINANCE',
          state: 'TRAILING_ENTRY',
          symbol: 'ETH/USDT',
          direction: 'SHORT',
          lastPrice: 2490,
          activeOrder: false,
          totalFills: 2,
          totalOrdersPlaced: 4,
          totalReorders: 1,
        },
      ];

      mockTradingEngineService.getAllStatuses.mockReturnValue(statuses);
      mockPrismaService.fill.count.mockResolvedValue(200);
      mockPrismaService.order.count.mockResolvedValue(500);

      const result = await controller.getDashboard();

      expect(result).toEqual({
        activeBots: 2,
        totalFills: 200,
        totalOrdersPlaced: 500,
        totalReorders: 4,
        equity: 0,
        availableUsdt: 0,
      });
    });

    it('reads totalFills and totalOrdersPlaced from DB even when no runners are active', async () => {
      mockTradingEngineService.getAllStatuses.mockReturnValue([]);
      mockPrismaService.fill.count.mockResolvedValue(123);
      mockPrismaService.order.count.mockResolvedValue(456);

      const result = await controller.getDashboard();

      expect(result).toMatchObject({
        activeBots: 0,
        totalFills: 123,
        totalOrdersPlaced: 456,
        totalReorders: 0,
        equity: 0,
        availableUsdt: 0,
      });
    });

    it('counts PAUSED as active (non-terminal) and reads totalFills from DB', async () => {
      const statuses: BotStatus[] = [
        { sessionCode: 'bot-a', exchange: 'BINANCE', state: 'RUNNING', symbol: 'ETH/USDT', direction: 'LONG', lastPrice: 2500, activeOrder: true, totalFills: 5, totalOrdersPlaced: 12, totalReorders: 3 },
        { sessionCode: 'bot-b', exchange: 'GATE', state: 'PAUSED', symbol: 'BTC/USDT', direction: 'SHORT', lastPrice: 60000, activeOrder: false, totalFills: 2, totalOrdersPlaced: 4, totalReorders: 1 },
      ];

      mockTradingEngineService.getAllStatuses.mockReturnValue(statuses);
      mockPrismaService.fill.count.mockResolvedValue(99);
      mockPrismaService.order.count.mockResolvedValue(200);

      const result = await controller.getDashboard();

      expect(result.activeBots).toBe(2);
      expect(result.totalFills).toBe(99);
    });
  });

  describe('GET /trading-engine/events', () => {
    it('lists FILL events from Fill table with symbol/direction enrichment and paginated', async () => {
      mockPrismaService.fill.findMany.mockResolvedValue([
        {
          id: 'fl-1',
          side: 'BUY',
          qty: 0.05,
          price: 2500,
          gridIndex: 3,
          savings: 0.5,
          savingsRate: 0.02,
          fee: 0.01,
          feeAsset: 'USDT',
          realizedPnlDelta: 1.2,
          avgGridPrice: 1815,
          filledAt: new Date('2026-05-29T00:00:00Z'),
          run: { box: { id: 'cfg-1', symbol: 'ETH/USDT', direction: 'LONG' } },
          order: { price: 1818.18 },
        },
      ]);
      mockPrismaService.fill.count.mockResolvedValue(42);

      const result = await controller.listEvents('FILL', '10', '20');

      expect(mockPrismaService.fill.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { filledAt: 'desc' }, take: 10, skip: 20 }),
      );
      expect(result.total).toBe(42);
      expect(result.limit).toBe(10);
      expect(result.offset).toBe(20);
      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toMatchObject({
        id: 'fl-1',
        configId: 'cfg-1',
        eventType: 'FILL',
        symbol: 'ETH/USDT',
        direction: 'LONG',
      });
      expect(result.data[0].eventData).toMatchObject({
        side: 'BUY',
        fillQty: 0.05,
        fillPrice: 2500,
        gridIndex: 3,
        savings: 0.5,
        savingsRate: 0.02,
        fee: 0.01,
        feeAsset: 'USDT',
        realizedPnlDelta: 1.2,
        avgGridPrice: 1815,
        orderPrice: 1818.18,
      });
    });

    it('robotId 过滤：通过 run.box.robotId 关联(机器人1:N箱体，不能直接按 box.id 过滤)', async () => {
      mockPrismaService.fill.findMany.mockResolvedValue([]);
      mockPrismaService.fill.count.mockResolvedValue(0);

      await controller.listEvents('FILL', undefined, undefined, 'robot-1');

      expect(mockPrismaService.fill.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ run: { box: { robotId: 'robot-1' } } }),
        }),
      );
    });

    it('route=UNKNOWN 过滤：只返回 order.tif 为 null 的成交', async () => {
      mockPrismaService.fill.findMany.mockResolvedValue([]);
      mockPrismaService.fill.count.mockResolvedValue(0);

      await controller.listEvents('FILL', undefined, undefined, undefined, 'UNKNOWN');

      expect(mockPrismaService.fill.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ order: { tif: null } }) }),
      );
    });

    it('route=POC 过滤：按 order.tif="POC"', async () => {
      mockPrismaService.fill.findMany.mockResolvedValue([]);
      mockPrismaService.fill.count.mockResolvedValue(0);

      await controller.listEvents('FILL', undefined, undefined, undefined, 'POC');

      expect(mockPrismaService.fill.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ order: { tif: 'POC' } }) }),
      );
    });

    it('search 用 OR 匹配交易对/交易所订单号/clientOrderId/账户标签', async () => {
      mockPrismaService.fill.findMany.mockResolvedValue([]);
      mockPrismaService.fill.count.mockResolvedValue(0);

      await controller.listEvents('FILL', undefined, undefined, undefined, undefined, 'BTC');

      const call = mockPrismaService.fill.findMany.mock.calls[0][0];
      expect(call.where.OR).toEqual([
        { run: { box: { symbol: { contains: 'BTC', mode: 'insensitive' } } } },
        { order: { exchangeOrderId: { contains: 'BTC', mode: 'insensitive' } } },
        { order: { clientOrderId: { contains: 'BTC', mode: 'insensitive' } } },
        { run: { box: { account: { label: { contains: 'BTC', mode: 'insensitive' } } } } },
      ]);
    });

    it('多个过滤条件组合时是 AND 关系(robotId + route + search 同时生效，互不覆盖)', async () => {
      mockPrismaService.fill.findMany.mockResolvedValue([]);
      mockPrismaService.fill.count.mockResolvedValue(0);

      await controller.listEvents('FILL', undefined, undefined, 'robot-9', 'POC', 'ETH');

      const call = mockPrismaService.fill.findMany.mock.calls[0][0];
      expect(call.where.run).toEqual({ box: { robotId: 'robot-9' } });
      expect(call.where.order).toEqual({ tif: 'POC' });
      expect(call.where.OR).toBeTruthy();
    });

    it('since 过滤起始时间；sortBy=notional + sortDir=asc 映射到 orderBy', async () => {
      mockPrismaService.fill.findMany.mockResolvedValue([]);
      mockPrismaService.fill.count.mockResolvedValue(0);

      await controller.listEvents('FILL', undefined, undefined, undefined, undefined, undefined, '2026-07-01T00:00:00.000Z', 'notional', 'asc');

      expect(mockPrismaService.fill.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ filledAt: { gte: new Date('2026-07-01T00:00:00.000Z') } }),
          orderBy: { notional: 'asc' },
        }),
      );
    });

    it('until 过滤结束时间；同时传 since+until 时两端都生效(自定义任意区间)', async () => {
      mockPrismaService.fill.findMany.mockResolvedValue([]);
      mockPrismaService.fill.count.mockResolvedValue(0);

      await controller.listEvents(
        'FILL', undefined, undefined, undefined, undefined, undefined,
        '2026-06-01T00:00:00.000Z', undefined, undefined,
        '2026-06-20T00:00:00.000Z',
      );

      expect(mockPrismaService.fill.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            filledAt: { gte: new Date('2026-06-01T00:00:00.000Z'), lte: new Date('2026-06-20T00:00:00.000Z') },
          }),
        }),
      );
    });

    it('只传 until 不传 since 时，filledAt 只有 lte 一侧', async () => {
      mockPrismaService.fill.findMany.mockResolvedValue([]);
      mockPrismaService.fill.count.mockResolvedValue(0);

      await controller.listEvents(
        'FILL', undefined, undefined, undefined, undefined, undefined,
        undefined, undefined, undefined,
        '2026-06-20T00:00:00.000Z',
      );

      expect(mockPrismaService.fill.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ filledAt: { lte: new Date('2026-06-20T00:00:00.000Z') } }) }),
      );
    });

    it('都不传 since/until 时不带 filledAt 过滤(向后兼容既有行为)', async () => {
      mockPrismaService.fill.findMany.mockResolvedValue([]);
      mockPrismaService.fill.count.mockResolvedValue(0);

      await controller.listEvents('FILL');

      const call = mockPrismaService.fill.findMany.mock.calls[0][0];
      expect(call.where.filledAt).toBeUndefined();
    });

    it('route 字段来自 order.tif，accountLabel 来自 run.box.account.label', async () => {
      mockPrismaService.fill.findMany.mockResolvedValue([
        {
          id: 'fl-2', side: 'BUY', qty: 0.01, price: 100, gridIndex: 0,
          savings: 0, savingsRate: 0, fee: 0, realizedPnlDelta: 0,
          filledAt: new Date('2026-07-01T00:00:00Z'),
          run: { box: { id: 'cfg-2', symbol: 'BTC/USDT', direction: 'LONG', account: { label: 'demo' } } },
          order: { price: 100, tif: 'GTC' },
        },
      ]);
      mockPrismaService.fill.count.mockResolvedValue(1);

      const result = await controller.listEvents('FILL');

      expect(result.data[0]).toMatchObject({ route: 'GTC', accountLabel: 'demo' });
    });

    it('aggregates 反映全量过滤结果(不只当前页)：sum 走完整 where，maker/gtc/unknown 计数各自覆盖 order.tif 与当前 route 选择无关', async () => {
      mockPrismaService.fill.findMany.mockResolvedValue([]);
      mockPrismaService.fill.count
        .mockResolvedValueOnce(999) // total（完整 where）
        .mockResolvedValueOnce(30) // makerCount（where.order 覆盖为 POC）
        .mockResolvedValueOnce(60) // gtcCount（覆盖为 GTC）
        .mockResolvedValueOnce(9); // unknownRouteCount（覆盖为 null）
      mockPrismaService.fill.aggregate.mockResolvedValue({ _sum: { fee: 12.5, savings: 3.4, realizedPnlDelta: 7.1 } });

      const result = await controller.listEvents('FILL', '10', '20', 'robot-1', 'GTC');

      expect(mockPrismaService.fill.aggregate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ run: { box: { robotId: 'robot-1' } }, order: { tif: 'GTC' } }),
          _sum: { fee: true, savings: true, realizedPnlDelta: true },
        }),
      );
      // makerCount 的 count 调用必须覆盖 order.tif=POC，即使用户当前选的 route 是 GTC
      expect(mockPrismaService.fill.count).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ run: { box: { robotId: 'robot-1' } }, order: { tif: 'POC' } }) }),
      );
      expect(mockPrismaService.fill.count).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ order: { tif: 'GTC' } }) }),
      );
      expect(mockPrismaService.fill.count).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ order: { tif: null } }) }),
      );
      expect(result.aggregates).toEqual({
        totalFee: 12.5,
        totalSavings: 3.4,
        totalRealizedPnl: 7.1,
        makerCount: 30,
        gtcCount: 60,
        unknownRouteCount: 9,
      });
    });

  describe('GET /trading-engine/events/export', () => {
    it('按同一套过滤条件导出全部匹配记录为 CSV(不分页)', async () => {
      mockPrismaService.fill.findMany.mockResolvedValue([
        {
          id: 'fl-3', side: 'SELL', qty: 0.02, price: 200, notional: 4, gridIndex: 1,
          savings: 0.1, savingsRate: 0.01, fee: 0.02, realizedPnlDelta: 0.5,
          filledAt: new Date('2026-07-01T00:00:00Z'),
          run: { box: { symbol: 'ETH/USDT', direction: 'SHORT', account: { label: 'main' } } },
          order: { price: 200, exchangeOrderId: 'ex-3', clientOrderId: 'c-3', tif: 'POC' },
        },
      ]);

      const res = { setHeader: vi.fn(), send: vi.fn() };
      await controller.exportEventsCsv(res as any, undefined, undefined, undefined, undefined, undefined, undefined);

      expect(mockPrismaService.fill.findMany).toHaveBeenCalledWith(
        expect.not.objectContaining({ take: expect.anything() }),
      );
      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv; charset=utf-8');
      expect(res.setHeader).toHaveBeenCalledWith('Content-Disposition', expect.stringContaining('attachment'));
      const csv = res.send.mock.calls[0][0] as string;
      expect(csv).toContain('ETH/USDT');
      expect(csv).toContain('ex-3');
      expect(csv).toContain('POC');
    });

    it('exportEventsCsv 同样支持 until 参数', async () => {
      mockPrismaService.fill.count.mockResolvedValue(1);
      mockPrismaService.fill.findMany.mockResolvedValue([]);

      await controller.exportEventsCsv(
        { setHeader: vi.fn(), send: vi.fn() } as any,
        undefined, undefined, undefined,
        '2026-06-01T00:00:00.000Z',
        undefined, undefined,
        '2026-06-20T00:00:00.000Z',
      );

      expect(mockPrismaService.fill.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            filledAt: { gte: new Date('2026-06-01T00:00:00.000Z'), lte: new Date('2026-06-20T00:00:00.000Z') },
          }),
        }),
      );
    });

    it('账户标签等自由文本以 =/+/-/@ 开头时前置单引号，防 Excel/表格软件公式注入', async () => {
      mockPrismaService.fill.count.mockResolvedValue(1);
      mockPrismaService.fill.findMany.mockResolvedValue([
        {
          id: 'fl-4', side: 'BUY', qty: 1, price: 100, notional: 100, gridIndex: 0,
          savings: 0, savingsRate: 0, fee: 0, realizedPnlDelta: 0,
          filledAt: new Date('2026-07-01T00:00:00Z'),
          run: { box: { symbol: 'BTC/USDT', direction: 'LONG', account: { label: '=HYPERLINK("http://evil","x")' } } },
          order: { price: 100, exchangeOrderId: 'ex-4', clientOrderId: 'c-4', tif: 'POC' },
        },
      ]);

      const res = { setHeader: vi.fn(), send: vi.fn() };
      await controller.exportEventsCsv(res as any, undefined, undefined, undefined, undefined, undefined, undefined);

      const csv = res.send.mock.calls[0][0] as string;
      expect(csv).toContain(`"'=HYPERLINK`);
    });

    it('匹配记录数超过导出上限时拒绝并报错，而不是静默截断', async () => {
      mockPrismaService.fill.count.mockResolvedValue(50001);

      await expect(
        controller.exportEventsCsv({ setHeader: vi.fn(), send: vi.fn() } as any, undefined, undefined, undefined, undefined, undefined, undefined),
      ).rejects.toThrow(/过滤/);
      expect(mockPrismaService.fill.findMany).not.toHaveBeenCalled();
    });
  });

  describe('POST /trading-engine/resume/:sessionCode', () => {
    it('calls service.resumeBot and returns success', async () => {
      mockTradingEngineService.resumeBot.mockResolvedValue(undefined);

      const result = await controller.resumeBot('GRID-BTC-20260601-001');

      expect(mockTradingEngineService.resumeBot).toHaveBeenCalledWith('GRID-BTC-20260601-001');
      expect(result).toEqual({ success: true, sessionCode: 'GRID-BTC-20260601-001' });
    });

    it('propagates NotFoundException from service', async () => {
      const { NotFoundException } = await import('@nestjs/common');
      mockTradingEngineService.resumeBot.mockRejectedValue(
        new NotFoundException('Bot GRID-BTC-20260601-001 is not running'),
      );

      await expect(controller.resumeBot('GRID-BTC-20260601-001')).rejects.toThrow(
        'Bot GRID-BTC-20260601-001 is not running',
      );
    });
  });

    it('defaults limit/offset and omits the type filter when no type is given', async () => {
      mockPrismaService.eventLog.findMany.mockResolvedValue([]);
      mockPrismaService.eventLog.count.mockResolvedValue(0);
      mockPrismaService.box.findMany.mockResolvedValue([]);

      const result = await controller.listEvents();

      expect(mockPrismaService.eventLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: {}, take: 50, skip: 0 }),
      );
      expect(result).toMatchObject({ data: [], total: 0, limit: 50, offset: 0 });
    });
  });

  describe('GET /trading-engine/fills/:sessionCode', () => {
    it('returns FILL rows from the Fill table for a run', async () => {
      mockPrismaService.run.findUnique.mockResolvedValue({ id: 'run1', boxId: 'cfg1' });
      mockPrismaService.fill.findMany.mockResolvedValue([
        { id: 'fl1', side: 'BUY', qty: 0.01, price: 2000, gridIndex: 3, savings: 0.5, savingsRate: 0.02, fee: 0.01, realizedPnlDelta: 0, filledAt: new Date(1000) },
      ]);
      const result = await controller.getSessionFills('ETH_test', '20');
      expect(mockPrismaService.run.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { runCode: 'ETH_test' } }));
      expect(mockPrismaService.fill.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { runId: 'run1' }, take: 20 }));
      expect(result.total).toBe(1);
      expect(result.data[0]).toMatchObject({ id: 'fl1', eventType: 'FILL' });
      expect(result.data[0].eventData).toMatchObject({ side: 'BUY', fillQty: 0.01, fillPrice: 2000, gridIndex: 3, savings: 0.5, fee: 0.01 });
    });

    it('throws when run not found', async () => {
      mockPrismaService.run.findUnique.mockResolvedValue(null);
      await expect(controller.getSessionFills('nonexistent')).rejects.toThrow('not found');
    });

    it('route 字段来自 order.tif，不再永远是未知(此接口曾遗漏 select order.tif)', async () => {
      mockPrismaService.run.findUnique.mockResolvedValue({ id: 'run1', boxId: 'cfg1' });
      mockPrismaService.fill.findMany.mockResolvedValue([
        { id: 'fl1', side: 'BUY', qty: 0.01, price: 2000, gridIndex: 3, savings: 0.5, savingsRate: 0.02, fee: 0.01, realizedPnlDelta: 0, filledAt: new Date(1000), order: { tif: 'GTC' } },
      ]);
      const result = await controller.getSessionFills('ETH_test');
      expect(mockPrismaService.fill.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ include: expect.objectContaining({ order: { select: { tif: true } } }) }),
      );
      expect(result.data[0]).toMatchObject({ route: 'GTC' });
    });
  });

  describe('robot endpoints', () => {
    it('GET /robots returns the robot list', async () => {
      const robots = [{ id: 'robot-1', symbol: 'ETH/USDT', direction: 'LONG', status: 'RUNNING', activeBoxId: null, activeSessionCode: null, managed: true, latestPrice: 2500 }];
      mockBotManagerService.listRobots.mockResolvedValue(robots);
      const res = await controller.listRobots();
      expect(res).toEqual(robots);
    });

    it('GET /robots/archived returns the archived robot list', async () => {
      const archived = [{ id: 'robot-9' }] as any;
      mockBotManagerService.listArchivedRobots.mockResolvedValue(archived);
      const res = await controller.listArchivedRobots();
      expect(res).toBe(archived);
      expect(mockBotManagerService.listArchivedRobots).toHaveBeenCalledTimes(1);
    });

    it('GET /robots/:id returns detail', async () => {
      const detail = { id: 'robot-1', symbol: 'ETH/USDT', direction: 'LONG', status: 'RUNNING', activeBoxId: null, activeSessionCode: null, managed: true, latestPrice: 2500, boxes: [] };
      mockBotManagerService.getRobotDetail.mockResolvedValue(detail);
      const res = await controller.getRobot('robot-1');
      expect(res).toEqual(detail);
    });

    it('GET /robots/:id throws 404 (NotFoundException) when not found', async () => {
      const { NotFoundException } = await import('@nestjs/common');
      mockBotManagerService.getRobotDetail.mockResolvedValue(null);
      await expect(controller.getRobot('nope')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('POST /robots/:id/start calls startRobot', async () => {
      mockBotManagerService.startRobot.mockResolvedValue(undefined);
      const res = await controller.startRobot('robot-1');
      expect(mockBotManagerService.startRobot).toHaveBeenCalledWith('robot-1');
      expect(res).toEqual({ success: true, robotId: 'robot-1' });
    });

    it('POST /robots/:id/start wraps service errors as HttpException', async () => {
      const { HttpException } = await import('@nestjs/common');
      mockBotManagerService.startRobot.mockRejectedValue(new Error('GridRobot bad not found'));
      await expect(controller.startRobot('bad')).rejects.toBeInstanceOf(HttpException);
    });

    it('POST /robots/:id/pause calls pauseRobot', async () => {
      mockBotManagerService.pauseRobot.mockResolvedValue(undefined);
      const res = await controller.pauseRobot('robot-1');
      expect(mockBotManagerService.pauseRobot).toHaveBeenCalledWith('robot-1');
      expect(res).toEqual({ success: true, robotId: 'robot-1' });
    });

    it('POST /robots/:id/reconcile calls service.reconcileRobot and returns its result', async () => {
      const reconcileResult = { newFillsCount: 2, dbPosition: 0.5, exchangePosition: 0.5, positionMatches: true };
      mockTradingEngineService.reconcileRobot.mockResolvedValue(reconcileResult);
      const res = await controller.reconcileRobot('robot-1');
      expect(mockTradingEngineService.reconcileRobot).toHaveBeenCalledWith('robot-1');
      expect(res).toEqual({ success: true, robotId: 'robot-1', ...reconcileResult });
    });

    it('POST /robots/:id/reconcile wraps service errors as HttpException', async () => {
      const { HttpException } = await import('@nestjs/common');
      mockTradingEngineService.reconcileRobot.mockRejectedValue(new Error('boom'));
      await expect(controller.reconcileRobot('robot-1')).rejects.toBeInstanceOf(HttpException);
    });

    it('POST /robots/:id/stop calls requestStop with closePosition default false', async () => {
      mockBotManagerService.requestStop.mockResolvedValue({ robotId: 'robot-1', status: 'STOPPING' });
      const res = await controller.stopRobot('robot-1', {});
      expect(mockBotManagerService.requestStop).toHaveBeenCalledWith('robot-1', { closePosition: false });
      expect(res).toEqual({ success: true, robotId: 'robot-1', status: 'STOPPING' });
    });

    it('POST /robots/:id/stop passes closePosition=true when body requests close position', async () => {
      mockBotManagerService.requestStop.mockResolvedValue({ robotId: 'robot-1', status: 'STOPPING' });
      await controller.stopRobot('robot-1', { closePosition: true });
      expect(mockBotManagerService.requestStop).toHaveBeenCalledWith('robot-1', { closePosition: true });
    });

    it('POST stop returns status=STOPPING from requestStop without awaiting job completion', async () => {
      mockBotManagerService.requestStop.mockResolvedValue({ robotId: 'robot-1', status: 'STOPPING' });
      const res = await controller.stopRobot('robot-1', { closePosition: true });
      expect(mockBotManagerService.requestStop).toHaveBeenCalledWith('robot-1', { closePosition: true });
      expect(res).toEqual({ success: true, robotId: 'robot-1', status: 'STOPPING' });
    });

    it('POST /robots/:id/boxes calls addBox', async () => {
      mockBotManagerService.addBox.mockResolvedValue({ id: 'newbox' });
      const dto = { direction: 'LONG', takeProfitPrice: 2800, mainGridCount: 200, mainGridStep: 2, mainGridPortionSize: 0.05, leverage: 20, stopLossGridCount: 4, stopLossGridStep: 2 };
      const res = await controller.addBox('robot-1', dto as any);
      expect(mockBotManagerService.addBox).toHaveBeenCalledWith('robot-1', dto);
      expect(res).toEqual({ success: true, boxId: 'newbox' });
    });

    it('POST /robots/:id/boxes wraps validation errors as HttpException', async () => {
      const { HttpException } = await import('@nestjs/common');
      mockBotManagerService.addBox.mockRejectedValue(new Error('Box validation failed: overlap'));
      await expect(controller.addBox('robot-1', {} as any)).rejects.toBeInstanceOf(HttpException);
    });

    it('DELETE /robots/:id/boxes/:configId calls removeBox with closePosition', async () => {
      mockBotManagerService.removeBox.mockResolvedValue(undefined);
      const res = await controller.removeBox('robot-1', 'box-x', 'true');
      expect(mockBotManagerService.removeBox).toHaveBeenCalledWith('robot-1', 'box-x', { closePosition: true });
      expect(res).toEqual({ success: true });
    });

    it('DELETE box defaults closePosition=false when query omitted', async () => {
      mockBotManagerService.removeBox.mockResolvedValue(undefined);
      await controller.removeBox('robot-1', 'box-x', undefined);
      expect(mockBotManagerService.removeBox).toHaveBeenCalledWith('robot-1', 'box-x', { closePosition: false });
    });
  });

  describe('GET /configs/:configId/pnl', () => {
    it('returns realized PnL for a config', async () => {
      mockSavingsService.getRealizedPnlByConfig.mockResolvedValue({ realizedPnl: 150.5, fillCount: 4 });
      const res = await controller.getConfigPnl('cfg-1');
      expect(mockSavingsService.getRealizedPnlByConfig).toHaveBeenCalledWith('cfg-1');
      expect(res).toEqual({ realizedPnl: 150.5, fillCount: 4 });
    });
  });

  describe('GET /configs/:configId/fills', () => {
    it('returns fills for a config (all its runs) from the Fill table', async () => {
      mockPrismaService.box.findUnique.mockResolvedValue({ id: 'cfg-1', runs: [{ id: 'run1' }, { id: 'run2' }] });
      mockPrismaService.fill.findMany.mockResolvedValue([
        { id: 'fl1', side: 'BUY', qty: 1, price: 2000, gridIndex: 0, savings: 0, savingsRate: 0, fee: 0, realizedPnlDelta: 0, filledAt: new Date(1000) },
      ]);
      const res = await controller.getConfigFills('cfg-1', undefined);
      expect(mockPrismaService.fill.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { runId: { in: ['run1', 'run2'] } }, take: 50 }));
      expect(res.total).toBe(1);
      expect(res.data).toHaveLength(1);
      expect(res.data[0].eventData).toMatchObject({ side: 'BUY', fillQty: 1, fillPrice: 2000 });
    });

    it('respects the limit query', async () => {
      mockPrismaService.box.findUnique.mockResolvedValue({ id: 'cfg-1', runs: [{ id: 'run1' }] });
      mockPrismaService.fill.findMany.mockResolvedValue([]);
      await controller.getConfigFills('cfg-1', '100');
      expect(mockPrismaService.fill.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 100 }));
    });

    it('returns empty when config has no runs', async () => {
      mockPrismaService.box.findUnique.mockResolvedValue({ id: 'cfg-1', runs: [] });
      const res = await controller.getConfigFills('cfg-1', undefined);
      expect(res.total).toBe(0);
      expect(res.data).toHaveLength(0);
    });

    it('route 字段来自 order.tif，不再永远是未知(此接口曾遗漏 select order.tif)', async () => {
      mockPrismaService.box.findUnique.mockResolvedValue({ id: 'cfg-1', runs: [{ id: 'run1' }] });
      mockPrismaService.fill.findMany.mockResolvedValue([
        { id: 'fl1', side: 'BUY', qty: 1, price: 2000, gridIndex: 0, savings: 0, savingsRate: 0, fee: 0, realizedPnlDelta: 0, filledAt: new Date(1000), order: { tif: 'POC' } },
      ]);
      const res = await controller.getConfigFills('cfg-1', undefined);
      expect(mockPrismaService.fill.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ include: expect.objectContaining({ order: { select: { tif: true } } }) }),
      );
      expect(res.data[0]).toMatchObject({ route: 'POC' });
    });
  });

  describe('PATCH /robots/:id/boxes/:configId', () => {
    it('PATCH robots/:id/boxes/:configId 调用 editBox 并返回 success', async () => {
      (mockBotManagerService.editBox as any) = vi.fn().mockResolvedValue(undefined);
      const dto = { takeProfitPrice: 2500, mainGridCount: 60, mainGridStep: 10, mainGridPortionSize: 0.05, leverage: 20, stopLossGridCount: 0, stopLossGridStep: 2 };
      const res = await controller.editBox('robot-1', 'box-1', dto as any);
      expect(mockBotManagerService.editBox).toHaveBeenCalledWith('robot-1', 'box-1', dto);
      expect(res).toEqual({ success: true });
    });

    it('editBox 抛错时返回 400', async () => {
      (mockBotManagerService.editBox as any) = vi.fn().mockRejectedValue(new Error('Box validation failed: x'));
      await expect(controller.editBox('robot-1', 'box-1', {} as any)).rejects.toMatchObject({ status: 400 });
    });
  });

  describe('POST /robots (create)', () => {
    it('creates a robot, resolving exchangeAccountId via adapter', async () => {
      mockCredentialService.findOneWithSecrets.mockResolvedValue({ exchangeId: 'gateio', accountId: 'acc', apiKey: 'k', apiSecret: 's', passphrase: null });
      const destroy = vi.fn();
      mockAdapterFactory.createAdapter.mockReturnValue({ getAccountUid: vi.fn().mockResolvedValue('uid-123'), destroy });
      mockBotManagerService.createRobot.mockResolvedValue({ id: 'robot-new' });

      const res = await controller.createRobot({ credentialId: 'cred-1', symbol: 'ETH/USDT', direction: 'LONG' } as any);
      expect(mockBotManagerService.createRobot).toHaveBeenCalledWith({ credentialId: 'cred-1', symbol: 'ETH/USDT', direction: 'LONG', exchangeAccountId: 'uid-123' });
      expect(res).toEqual({ success: true, robotId: 'robot-new' });
      expect(destroy).toHaveBeenCalled(); // 不泄漏 adapter 连接
    });

    it('rejects creation when UID resolution fails (no null fallback)', async () => {
      const { BadRequestException } = await import('@nestjs/common');
      mockCredentialService.findOneWithSecrets.mockResolvedValue({ exchangeId: 'binance', accountId: 'acc', apiKey: 'k', apiSecret: 's', passphrase: null });
      const destroy = vi.fn();
      mockAdapterFactory.createAdapter.mockReturnValue({ getAccountUid: vi.fn().mockRejectedValue(new Error('not supported')), destroy });
      mockBotManagerService.createRobot.mockResolvedValue({ id: 'robot-b' });

      // 单次调用，同时断言异常类型与业务 error-code（错误走 code → 前端 i18n，不硬编码中文）
      const error = await controller
        .createRobot({ credentialId: 'cred-2', symbol: 'ETH/USDT', direction: 'LONG' } as any)
        .catch((e) => e);
      expect(error).toBeInstanceOf(BadRequestException);
      expect(error).toMatchObject({ response: { code: 'EXCHANGE_UID_RESOLUTION_FAILED' } });
      expect(mockBotManagerService.createRobot).not.toHaveBeenCalled();
      expect(destroy).toHaveBeenCalledTimes(1);
    });

    it('returns 409 when duplicate robot exists', async () => {
      const { ConflictException } = await import('@nestjs/common');
      mockCredentialService.findOneWithSecrets.mockResolvedValue({ exchangeId: 'gateio', accountId: 'acc', apiKey: 'k', apiSecret: 's', passphrase: null });
      mockAdapterFactory.createAdapter.mockReturnValue({ getAccountUid: vi.fn().mockResolvedValue('uid-123'), destroy: vi.fn() });
      mockBotManagerService.createRobot.mockRejectedValue(new ConflictException('A robot for ETH/USDT on this account already exists'));
      await expect(controller.createRobot({ credentialId: 'cred-1', symbol: 'ETH/USDT', direction: 'LONG' } as any)).rejects.toBeInstanceOf(ConflictException);
    });

    it('returns 404 when credential not found', async () => {
      const { NotFoundException } = await import('@nestjs/common');
      mockCredentialService.findOneWithSecrets.mockResolvedValue(null);
      await expect(
        controller.createRobot({ credentialId: 'missing', symbol: 'ETH/USDT', direction: 'LONG' } as any),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(mockBotManagerService.createRobot).not.toHaveBeenCalled();
    });
  });
});

describe('权益/Alpha 历史曲线端点（P2-1）', () => {
  let controller: TradingEngineController;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [TradingEngineController],
      providers: [
        { provide: TradingEngineService, useValue: mockTradingEngineService },
        { provide: SessionService, useValue: mockSessionService },
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: PersistenceService, useValue: mockPersistenceService },
        { provide: SavingsService, useValue: mockSavingsService },
        { provide: BotManagerService, useValue: mockBotManagerService },
        { provide: CredentialService, useValue: mockCredentialService },
        { provide: ExchangeAdapterFactory, useValue: mockAdapterFactory },
      ],
    })
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = moduleRef.get<TradingEngineController>(TradingEngineController);
    vi.clearAllMocks();
  });

  it('GET equity/history 默认 7d：5min 桶聚合，窗口下限为 7 天前', async () => {
    const base = Date.now() - 3600_000;
    mockPrismaService.equitySnapshot.findMany.mockResolvedValue([
      { credentialId: 'a', totalEquity: 100, capturedAt: new Date(base) },
      { credentialId: 'a', totalEquity: 110, capturedAt: new Date(base + 5 * 60_000) },
    ]);
    const res = await controller.getEquityHistory(undefined as never);
    expect(res.bucketMs).toBe(5 * 60_000);
    expect(res.series.length).toBe(2);
    expect(res.series[1].equity).toBe(110);
    const arg = mockPrismaService.equitySnapshot.findMany.mock.calls[0][0];
    const gte: Date = arg.where.capturedAt.gte;
    expect(Date.now() - gte.getTime()).toBeGreaterThan(6.9 * 24 * 3600_000);
    expect(Date.now() - gte.getTime()).toBeLessThan(7.1 * 24 * 3600_000);
  });

  it('GET equity/history range=all：窗口下限为 epoch，桶 2h', async () => {
    mockPrismaService.equitySnapshot.findFirst.mockResolvedValue(null);
    mockPrismaService.equitySnapshot.findMany.mockResolvedValue([]);
    const res = await controller.getEquityHistory('all');
    expect(res).toEqual({ series: [], bucketMs: 120 * 60_000 });
    const arg = mockPrismaService.equitySnapshot.findMany.mock.calls[0][0];
    expect(arg.where.capturedAt.gte.getTime()).toBe(0);
  });

  it('GET savings/history：窗口内 fills 聚合为累计 alpha 序列', async () => {
    const base = Date.now() - 3600_000;
    mockPrismaService.fill.findMany.mockResolvedValue([
      { savings: 1, filledAt: new Date(base) },
      { savings: 2, filledAt: new Date(base + 60_000) },
    ]);
    const res = await controller.getSavingsHistory('7d');
    expect(res.bucketMs).toBe(5 * 60_000);
    expect(res.series.at(-1)).toMatchObject({ alpha: 3 });
  });
});

describe('GET /trading-engine/robots/:id/fills', () => {
  let controller: TradingEngineController;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [TradingEngineController],
      providers: [
        { provide: TradingEngineService, useValue: mockTradingEngineService },
        { provide: SessionService, useValue: mockSessionService },
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: PersistenceService, useValue: mockPersistenceService },
        { provide: SavingsService, useValue: mockSavingsService },
        { provide: BotManagerService, useValue: mockBotManagerService },
        { provide: CredentialService, useValue: mockCredentialService },
        { provide: ExchangeAdapterFactory, useValue: mockAdapterFactory },
      ],
    })
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = moduleRef.get<TradingEngineController>(TradingEngineController);
    vi.clearAllMocks();
  });

  it('返回机器人级成交(含 feeAsset/boxId) + boxes 几何表(含已删箱) + summary', async () => {
    mockBotManagerService.getRobotDetail.mockResolvedValue({ id: 'robot-1', boxes: [] } as any);
    mockPrismaService.box.findMany.mockResolvedValue([
      { id: 'b1', direction: 'LONG', takeProfitPrice: 2800, mainGridCount: 235, mainGridStep: 2.5, stopLossGridCount: 4, stopLossGridStep: 2.5, isolationStep: 2.5, activationPrice: 0 },
      { id: 'b2', direction: 'LONG', takeProfitPrice: 3000, mainGridCount: 100, mainGridStep: 2, stopLossGridCount: 4, stopLossGridStep: 2, isolationStep: 2, activationPrice: 0 },
    ]);
    mockPrismaService.fill.findMany.mockResolvedValue([
      { id: 'fl1', side: 'BUY', qty: 0.01, price: 2500, gridIndex: 3, savings: 0.5, savingsRate: 0.02, fee: 0.01, feeAsset: 'USDT', realizedPnlDelta: 0, avgGridPrice: 1812, filledAt: new Date(1000), run: { boxId: 'b1' }, order: { price: 1818.18 } },
    ]);
    mockSavingsService.getRobotSummaryMetrics.mockResolvedValue({ todayRealizedPnl: 1.2, alphaTotal: 0.5 });

    const result = await controller.getRobotFills('robot-1', '20');

    expect(mockPrismaService.fill.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { run: { box: { robotId: 'robot-1' } } }, take: 20 }),
    );
    expect(result.total).toBe(1);
    expect(result.data[0].eventData).toMatchObject({ side: 'BUY', fillQty: 0.01, fee: 0.01, feeAsset: 'USDT', savings: 0.5 });
    expect(result.data[0].eventData.orderPrice).toBe(1818.18);
    expect(result.data[0].eventData.avgGridPrice).toBe(1812);
    expect(result.data[0].boxId).toBe('b1');
    expect(result.boxes.b1).toMatchObject({ direction: 'LONG', takeProfitPrice: 2800 });
    expect(result.boxes.b2).toMatchObject({ direction: 'LONG', takeProfitPrice: 3000 });
    expect(result.summary).toEqual({ todayRealizedPnl: 1.2, alphaTotal: 0.5 });
  });

  it('route 字段来自 order.tif，不再永远是未知(此接口曾遗漏 select order.tif)', async () => {
    mockBotManagerService.getRobotDetail.mockResolvedValue({ id: 'robot-1', boxes: [] } as any);
    mockPrismaService.box.findMany.mockResolvedValue([]);
    mockPrismaService.fill.findMany.mockResolvedValue([
      { id: 'fl2', side: 'SELL', qty: 0.01, price: 2500, gridIndex: 3, savings: 0, savingsRate: 0, fee: 0, realizedPnlDelta: 0, filledAt: new Date(1000), run: { boxId: 'b1' }, order: { price: 2500, tif: 'GTC' } },
    ]);
    mockSavingsService.getRobotSummaryMetrics.mockResolvedValue({ todayRealizedPnl: 0, alphaTotal: 0 });

    const result = await controller.getRobotFills('robot-1', '20');

    expect(mockPrismaService.fill.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ include: expect.objectContaining({ order: { select: { price: true, exchangeOrderId: true, clientOrderId: true, tif: true } } }) }),
    );
    expect(result.data[0]).toMatchObject({ route: 'GTC' });
  });

  it('avgGridPrice 为 0(零哨兵)或 null(历史)时 eventData 透出 undefined → 前端显示「—」', async () => {
    mockBotManagerService.getRobotDetail.mockResolvedValue({ id: 'robot-1', boxes: [] } as any);
    mockPrismaService.box.findMany.mockResolvedValue([]);
    mockPrismaService.fill.findMany.mockResolvedValue([
      { id: 'z0', side: 'SELL', qty: 0.01, price: 1783, gridIndex: 1, savings: 0, savingsRate: 0, fee: 0, feeAsset: null, realizedPnlDelta: 0, avgGridPrice: 0, filledAt: new Date(2000), run: { boxId: 'b1' }, order: null },
      { id: 'zn', side: 'BUY', qty: 0.01, price: 1790, gridIndex: 1, savings: 0, savingsRate: 0, fee: 0, feeAsset: null, realizedPnlDelta: 0, avgGridPrice: null, filledAt: new Date(1000), run: { boxId: 'b1' }, order: null },
    ]);
    mockSavingsService.getRobotSummaryMetrics.mockResolvedValue({ todayRealizedPnl: 0, alphaTotal: 0 });

    const result = await controller.getRobotFills('robot-1', '20');

    expect(result.data[0].eventData.avgGridPrice).toBeUndefined();
    expect(result.data[1].eventData.avgGridPrice).toBeUndefined();
  });

  it('robot 不存在抛 NotFound', async () => {
    const { NotFoundException } = await import('@nestjs/common');
    mockBotManagerService.getRobotDetail.mockResolvedValue(null);
    await expect(controller.getRobotFills('nope')).rejects.toThrow(NotFoundException);
  });

  it('cursor 透传为 Prisma 游标(cursor+skip:1)', async () => {
    mockBotManagerService.getRobotDetail.mockResolvedValue({ id: 'robot-1', boxes: [] } as any);
    mockPrismaService.box.findMany.mockResolvedValue([]);
    mockPrismaService.fill.findMany.mockResolvedValue([]);
    mockSavingsService.getRobotSummaryMetrics.mockResolvedValue({});

    await controller.getRobotFills('robot-1', '20', 'fl5');

    expect(mockPrismaService.fill.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: { id: 'fl5' }, skip: 1, take: 20 }),
    );
  });

  it('orderSearch 过滤为 exchangeOrderId 或 clientOrderId 命中其一(OR)', async () => {
    mockBotManagerService.getRobotDetail.mockResolvedValue({ id: 'robot-1', boxes: [] } as any);
    mockPrismaService.box.findMany.mockResolvedValue([]);
    mockPrismaService.fill.findMany.mockResolvedValue([]);
    mockSavingsService.getRobotSummaryMetrics.mockResolvedValue({});

    await controller.getRobotFills('robot-1', undefined, undefined, 'EX123');

    expect(mockPrismaService.fill.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          run: { box: { robotId: 'robot-1' } },
          order: { OR: [{ exchangeOrderId: 'EX123' }, { clientOrderId: 'EX123' }] },
        },
      }),
    );
  });

  it('nextCursor: 满页时为末条 id, 不满页时为 null', async () => {
    mockBotManagerService.getRobotDetail.mockResolvedValue({ id: 'robot-1', boxes: [] } as any);
    mockPrismaService.box.findMany.mockResolvedValue([]);
    mockSavingsService.getRobotSummaryMetrics.mockResolvedValue({});
    const mkFill = (id: string) => ({ id, side: 'BUY', qty: 1, price: 1, gridIndex: 0, savings: 0, savingsRate: 0, fee: 0, feeAsset: 'USDT', realizedPnlDelta: 0, filledAt: new Date(1000), run: { boxId: 'b1' }, order: { price: 1 } });

    mockPrismaService.fill.findMany.mockResolvedValueOnce([mkFill('a'), mkFill('b')]);
    const full = await controller.getRobotFills('robot-1', '2');
    expect(full.nextCursor).toBe('b');

    mockPrismaService.fill.findMany.mockResolvedValueOnce([mkFill('a')]);
    const partial = await controller.getRobotFills('robot-1', '2');
    expect(partial.nextCursor).toBeNull();
  });

  it('eventData 含 orderId/clientOrderId(来自 order 关联)', async () => {
    mockBotManagerService.getRobotDetail.mockResolvedValue({ id: 'robot-1', boxes: [] } as any);
    mockPrismaService.box.findMany.mockResolvedValue([]);
    mockPrismaService.fill.findMany.mockResolvedValue([
      { id: 'fl1', side: 'BUY', qty: 0.01, price: 2500, gridIndex: 3, savings: 0, savingsRate: 0, fee: 0, feeAsset: 'USDT', realizedPnlDelta: 0, filledAt: new Date(1000), run: { boxId: 'b1' }, order: { price: 1818, exchangeOrderId: 'EX1', clientOrderId: 'C1' } },
    ]);
    mockSavingsService.getRobotSummaryMetrics.mockResolvedValue({});

    const result = await controller.getRobotFills('robot-1');

    expect(result.data[0].eventData).toMatchObject({ orderId: 'EX1', clientOrderId: 'C1' });
  });
});
