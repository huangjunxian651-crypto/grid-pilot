import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TradingEngineGateway } from './trading-engine.gateway';
import type { TradingEngineService } from './trading-engine.service';
import type { FillPayload } from './types/fill-payload';

describe('TradingEngineGateway', () => {
  let gateway: TradingEngineGateway;
  let mockServer: any;
  let mockService: any;

  beforeEach(() => {
    mockServer = {
      to: vi.fn().mockReturnThis(),
      emit: vi.fn(),
      sockets: {
        adapter: {
          rooms: new Map(),
        },
      },
    };

    mockService = {
      getStatus: vi.fn(),
      getAllStatuses: vi.fn().mockReturnValue([]),
      getAccountSnapshot: vi.fn(),
    };

    gateway = new TradingEngineGateway(mockService);
    (gateway as any).server = mockServer;
  });

  describe('handleSubscribe', () => {
    it('subscribe 后立即推一次 status 快照', () => {
      const status = { sessionCode: 'S1', positionQty: 1 } as any;
      (mockService.getStatus as any) = vi.fn().mockReturnValue(status);
      const client: any = { id: 'c1', join: vi.fn(), emit: vi.fn() };
      (gateway as any).clientSubscriptions.set('c1', new Set());
      gateway.handleSubscribe(client, 'S1');
      expect(client.emit).toHaveBeenCalledWith('status', status);
    });

    it('getStatus 为 null 时不推 status', () => {
      (mockService.getStatus as any) = vi.fn().mockReturnValue(undefined);
      const client: any = { id: 'c2', join: vi.fn(), emit: vi.fn() };
      (gateway as any).clientSubscriptions.set('c2', new Set());
      gateway.handleSubscribe(client, 'S2');
      expect(client.emit).not.toHaveBeenCalledWith('status', expect.anything());
    });
  });

  describe('broadcastFill', () => {
    it('emits fill event to session room', () => {
      mockServer.sockets.adapter.rooms.set('ETHUSDT_test', new Set(['client1']));

      const fill: FillPayload = {
        sessionCode: 'ETHUSDT_test',
        id: 'fill_1',
        side: 'buy',
        price: 2000,
        qty: 0.01,
        gridIndex: 3,
        route: 'POC',
        fee: 0,
        ts: Date.now(),
      };

      gateway.broadcastFill('ETHUSDT_test', fill);

      expect(mockServer.to).toHaveBeenCalledWith('ETHUSDT_test');
      expect(mockServer.emit).toHaveBeenCalledWith('fill', fill);
    });

    it('does not emit when no clients are in the session room', () => {
      const fill: FillPayload = {
        sessionCode: 'ETHUSDT_empty',
        id: 'fill_1',
        side: 'buy',
        price: 2000,
        qty: 0.01,
        gridIndex: 3,
        route: 'POC',
        fee: 0,
        ts: Date.now(),
      };

      gateway.broadcastFill('ETHUSDT_empty', fill);

      expect(mockServer.to).not.toHaveBeenCalled();
      expect(mockServer.emit).not.toHaveBeenCalled();
    });

    it('does not throw when server is null', () => {
      (gateway as any).server = null;
      const fill: FillPayload = {
        sessionCode: 'ETHUSDT_test',
        id: 'fill_1',
        side: 'buy',
        price: 2000,
        qty: 0.01,
        gridIndex: 3,
        route: 'POC',
        fee: 0,
        ts: Date.now(),
      };

      expect(() => gateway.broadcastFill('ETHUSDT_test', fill)).not.toThrow();
    });
  });

  describe('onModuleDestroy', () => {
    it('清理广播定时器，避免关闭时仍有客户端连接导致泄漏', () => {
      (gateway as any).startBroadcastIfNeeded();
      expect((gateway as any).broadcastInterval).not.toBeNull();
      gateway.onModuleDestroy();
      expect((gateway as any).broadcastInterval).toBeNull();
    });
  });
});
