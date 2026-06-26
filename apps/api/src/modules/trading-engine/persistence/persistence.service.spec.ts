import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PersistenceService } from './persistence.service';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { BotState, Event } from '../types/bot-state.types';

describe('PersistenceService', () => {
  let prisma: PrismaService;
  let service: PersistenceService;

  beforeEach(() => {
    prisma = {
      stateSnapshot: {
        create: vi.fn().mockResolvedValue({ id: 'snap1' }),
        findFirst: vi.fn(),
      },
      eventLog: {
        create: vi.fn().mockResolvedValue({ id: 'log1' }),
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
      },
    } as unknown as PrismaService;

    service = new PersistenceService(prisma);
  });

  it('should write snapshot', async () => {
    const state: BotState = {
      fsm: { kind: 'RUNNING', since: Date.now() },
      config: { takeProfitPrice: 2200, mainGridStep: 40, mainGridCount: 10 },
      position: { symbol: 'ETH/USDT', baseAssetQty: 0.5, quoteAssetQty: -1000, entryPrice: 2000, leverage: 10, marginType: 'CROSS' },
      openOrders: [],
      algoOrders: [],
      lastPrice: 2000,
      lastPriceTime: Date.now(),
      orderManager: { activeOrder: null, recentlyCancelled: new Set() },
      sentinel: { subGrids: new Map(), isActive: false },
      nextSeq: 1,
      stats: { totalOrdersPlaced: 0, totalFills: 0, totalReorders: 0, lastPersistTime: 0, realizedPnl: 0 },
    };

    await service.writeSnapshot('config1', state, 1);

    expect(prisma.stateSnapshot.create).toHaveBeenCalledOnce();
    const call = (prisma.stateSnapshot.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.data.configId).toBe('config1');
    expect(call.data.seq).toBe(1);
    expect(call.data.fsmState).toEqual(state.fsm);
  });

  it('should write event log', async () => {
    const event: Event = { type: 'TICK', price: 2000, timestamp: Date.now() };

    await service.writeEventLog('config1', event, 2);

    expect(prisma.eventLog.create).toHaveBeenCalledOnce();
    const call = (prisma.eventLog.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.data.configId).toBe('config1');
    expect(call.data.eventType).toBe('TICK');
    expect(call.data.seq).toBe(2);
  });

  it('should write event log with sessionCode', async () => {
    const event: Event = { type: 'FILL', price: 2000, timestamp: Date.now() };

    await service.writeEventLog('config1', event, 2, 'session-abc');

    const call = (prisma.eventLog.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.data.configId).toBe('config1');
    expect(call.data.sessionCode).toBe('session-abc');
    expect(call.data.seq).toBe(2);
  });

  it('should write event log without sessionCode (backward compat)', async () => {
    const event: Event = { type: 'TICK', price: 2000, timestamp: Date.now() };

    await service.writeEventLog('config1', event, 2);

    const call = (prisma.eventLog.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.data.sessionCode).toBeUndefined();
  });

  it('should get latest snapshot', async () => {
    (prisma.stateSnapshot.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'snap1',
      fsmState: { kind: 'RUNNING' },
      position: { symbol: 'ETH/USDT' },
      orderManager: {},
      sentinel: { subGrids: [], isActive: true },
      seq: 5,
      createdAt: new Date('2024-01-01'),
    });

    const result = await service.getLatestSnapshot('config1');

    expect(result).not.toBeNull();
    expect(result!.seq).toBe(5);
    expect(result!.fsmState).toEqual({ kind: 'RUNNING' });
  });

  it('should return null when no snapshot exists', async () => {
    (prisma.stateSnapshot.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const result = await service.getLatestSnapshot('config1');

    expect(result).toBeNull();
  });

  it('should get event logs', async () => {
    (prisma.eventLog.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { eventType: 'TICK', eventData: { price: 2000 }, seq: 1, createdAt: new Date() },
      { eventType: 'FILL', eventData: { qty: 0.01 }, seq: 2, createdAt: new Date() },
    ]);

    const logs = await service.getEventLogs('config1');

    expect(logs).toHaveLength(2);
    expect(logs[0].eventType).toBe('TICK');
    expect(logs[1].seq).toBe(2);
  });

  describe('getFillsByConfigId', () => {
    it('queries EventLog with eventType FILL and configId', async () => {
      const mockFills = [
        {
          id: 'ev1',
          configId: 'cfg1',
          eventType: 'FILL',
          eventData: { type: 'FILL', side: 'BUY', fillQty: 0.01, fillPrice: 2000, orderId: 'o1' },
          seq: 5,
          createdAt: new Date('2026-06-01T10:00:00Z'),
        },
        {
          id: 'ev2',
          configId: 'cfg1',
          eventType: 'FILL',
          eventData: { type: 'FILL', side: 'SELL', fillQty: 0.01, fillPrice: 2050, orderId: 'o2' },
          seq: 8,
          createdAt: new Date('2026-06-01T10:05:00Z'),
        },
      ];
      (prisma.eventLog.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(mockFills);
      (prisma.eventLog.count as ReturnType<typeof vi.fn>).mockResolvedValue(2);

      const result = await service.getFillsByConfigId('cfg1', 50);

      expect(prisma.eventLog.findMany).toHaveBeenCalledWith({
        where: { configId: 'cfg1', eventType: 'FILL' },
        orderBy: { seq: 'desc' },
        take: 50,
      });
      expect(result.fills).toEqual(mockFills);
      expect(result.total).toBe(2);
    });

    it('defaults limit to 50 when not provided', async () => {
      (prisma.eventLog.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      (prisma.eventLog.count as ReturnType<typeof vi.fn>).mockResolvedValue(0);

      await service.getFillsByConfigId('cfg1');

      expect(prisma.eventLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 50 }),
      );
    });
  });

  describe('getMaxOrderSeq', () => {
    beforeEach(() => {
      (prisma as unknown as { order: unknown }).order = { findMany: vi.fn().mockResolvedValue([]) };
    });

    it('返回本 run 已落库订单 clientOrderId 的最大序号', async () => {
      const orderFindMany = (prisma as unknown as { order: { findMany: ReturnType<typeof vi.fn> } }).order.findMany;
      orderFindMany.mockResolvedValue([
        { clientOrderId: 'ETHUSDT260611040719B1' },
        { clientOrderId: 'ETHUSDT260611040719S7' },
        { clientOrderId: 'ETHUSDT260611040719B3' },
      ]);

      const maxSeq = await service.getMaxOrderSeq('ETHUSDT_260611040719');

      expect(orderFindMany).toHaveBeenCalledWith({
        where: { run: { runCode: 'ETHUSDT_260611040719' } },
        select: { clientOrderId: true },
      });
      expect(maxSeq).toBe(7);
    });

    it('无订单或格式不可解析（旧格式/algo 单/null）时返回 0', async () => {
      const orderFindMany = (prisma as unknown as { order: { findMany: ReturnType<typeof vi.fn> } }).order.findMany;
      orderFindMany.mockResolvedValue([
        { clientOrderId: 'ETHUSDT_1700000000000_BUY_4' },
        { clientOrderId: 'ETHUSDT_260611040719_algo_emergency_ab12' },
        { clientOrderId: null },
      ]);

      const maxSeq = await service.getMaxOrderSeq('ETHUSDT_260611040719');

      expect(maxSeq).toBe(0);
    });
  });
});
