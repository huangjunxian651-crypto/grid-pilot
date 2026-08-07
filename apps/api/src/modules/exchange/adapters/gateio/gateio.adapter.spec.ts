import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import nock from 'nock';
import { GATEIO_REST_TESTNET } from './gateio.types';

// 在模块边界 mock WS client：可控的 EventEmitter 式假客户端，connect/authenticate 立即 resolve。
// 记录构造函数收到的第二参数 environment，用于验证 adapter 是否把 this.environment 透传给它创建的 GateioWsClient。
const h = vi.hoisted(() => {
  const wsInstances: Array<{ handlers: Record<string, Array<(a: unknown) => void>>; emitData: (a: unknown) => void; environment: unknown }> = [];
  class FakeGateioWsClient {
    handlers: Record<string, Array<(a: unknown) => void>> = {};
    environment: unknown;
    constructor(_credentials: unknown, environment?: unknown) {
      this.environment = environment;
      wsInstances.push(this);
    }
    async connect() {}
    async authenticate() {}
    subscribe() {}
    on(ev: string, fn: (a: unknown) => void) { (this.handlers[ev] ??= []).push(fn); }
    off() {}
    disconnect() {}
    emitData(arg: unknown) { (this.handlers['data'] ?? []).forEach((fn) => fn(arg)); }
  }
  return { wsInstances, FakeGateioWsClient };
});
vi.mock('./gateio-ws-client', () => ({ GateioWsClient: h.FakeGateioWsClient }));

import { mapGateUserTrade, mapGateRestTrade, mapGateAccountBookEntry, GateioAdapter } from './gateio.adapter';

describe('mapGateUserTrade', () => {
  it('逐笔 usertrade：size 符号定方向、绝对值×面值定量，带 fee/tradeId', () => {
    const raw = { id: 'TR1', order_id: 'o9', contract: 'ETH_USDT', size: -3, price: '2000', text: 't-cid', fee: '0.12', create_time_ms: 1700000000000 };
    const f = mapGateUserTrade(raw as any, 0.01); // contractSize 0.01 → 3 张 = 0.03 币
    expect(f).toMatchObject({ orderId: 'o9', tradeId: 'TR1', symbol: 'ETH/USDT', side: 'sell', filledQty: 0.03, avgPrice: 2000, fee: 0.12, feeAsset: 'USDT', status: 'filled' });
  });

  it('正 size → buy', () => {
    const raw = { id: 'TR2', order_id: 'o1', contract: 'ETH_USDT', size: 2, price: '2000', fee: '0.01', create_time_ms: 1 };
    expect(mapGateUserTrade(raw as any, 0.01)?.side).toBe('buy');
  });

  it('size 为 0 → null', () => {
    expect(mapGateUserTrade({ size: 0, price: '2000', contract: 'ETH_USDT' } as any, 0.01)).toBeNull();
  });
});

describe('mapGateRestTrade', () => {
  it('mapGateRestTrade 映射 REST 成交', () => {
    const t = { tradeId: '7', createTime: 1700000000, contract: 'ETH_USDT', orderId: 'o9', size: '-3', price: '2000', text: 't-c', fee: '0.12' };
    expect(mapGateRestTrade(t as any, 0.01)).toMatchObject({ orderId: 'o9', tradeId: '7', symbol: 'ETH/USDT', side: 'sell', filledQty: 0.03, avgPrice: 2000, fee: 0.12, feeAsset: 'USDT', status: 'filled', ts: 1700000000000 });
  });

  it('size 为 0 → null', () => {
    expect(mapGateRestTrade({ tradeId: '1', createTime: 0, contract: 'ETH_USDT', orderId: 'o1', size: '0', price: '2000', fee: '0' } as any, 0.01)).toBeNull();
  });
});

// ── mapGateAccountBookEntry (纯函数) ──────────────────────────────────────────

describe('mapGateAccountBookEntry', () => {
  it('Gate time 是秒 → fundingTime 须×1000 转毫秒，amount 为 Number(change)', () => {
    const entry = { time: 1718000000, change: '-1.23', type: 'fund', contract: 'ETH_USDT' };
    const record = mapGateAccountBookEntry('ETH/USDT', entry as any);
    expect(record).toEqual({ symbol: 'ETH/USDT', fundingTime: 1718000000000, amount: -1.23 });
  });

  it('正向资金费（收取）amount 为正', () => {
    const entry = { time: 1718000000, change: '0.55', type: 'fund', contract: 'ETH_USDT' };
    expect(mapGateAccountBookEntry('ETH/USDT', entry as any).amount).toBeCloseTo(0.55);
  });
});

// ── GateioAdapter.fetchFundingHistory（SDK 路径，nock 拦截）──────────────────

// GATEIO_REST_TESTNET = "https://api-testnet.gateapi.io/api/v4"
// SDK basePath 与 REST base 相同；nock 拦截主机 + 路径前缀。
const GATE_HOST = new URL(GATEIO_REST_TESTNET).origin; // "https://api-testnet.gateapi.io"
const API_BASE = new URL(GATEIO_REST_TESTNET).pathname; // "/api/v4"

describe('GateioAdapter.fetchFundingHistory', () => {
  let adapter: GateioAdapter;

  beforeEach(() => {
    adapter = new GateioAdapter({ apiKey: 'k', apiSecret: 's' });
    nock.cleanAll();
  });

  afterEach(() => {
    adapter.destroy();
    nock.cleanAll();
  });

  it('account_book fund 条目 → FundingFeeRecord（秒→毫秒，contract 过滤，amount 符号保留）', async () => {
    nock(GATE_HOST)
      .get(`${API_BASE}/futures/usdt/account_book`)
      .query((q) => q['type'] === 'fund')
      .reply(200, [
        { time: 1718000000, change: '-1.23', type: 'fund', contract: 'ETH_USDT' },
        { time: 1718028800, change: '0.55', type: 'fund', contract: 'BTC_USDT' }, // 不同合约，应过滤
      ]);

    const records = await adapter.fetchFundingHistory!('ETH/USDT', 0);
    expect(records).toHaveLength(1);
    expect(records[0]).toEqual({ symbol: 'ETH/USDT', fundingTime: 1718000000000, amount: -1.23 });
  });

  it('sinceMs 转换为秒后传 from 参数', async () => {
    let capturedQuery: Record<string, string> = {};
    nock(GATE_HOST)
      .get(`${API_BASE}/futures/usdt/account_book`)
      .query((q) => { capturedQuery = q as Record<string, string>; return true; })
      .reply(200, []);

    await adapter.fetchFundingHistory!('ETH/USDT', 1718000000000);
    expect(capturedQuery['from']).toBe('1718000000');
    expect(capturedQuery['type']).toBe('fund');
  });

  it('untilMs 转换为秒后传 to 参数', async () => {
    let capturedQuery: Record<string, string> = {};
    nock(GATE_HOST)
      .get(`${API_BASE}/futures/usdt/account_book`)
      .query((q) => { capturedQuery = q as Record<string, string>; return true; })
      .reply(200, []);

    await adapter.fetchFundingHistory!('ETH/USDT', 1718000000000, 1718028800000);
    expect(capturedQuery['to']).toBe('1718028800');
  });

  it('不带 untilMs 时不传 to 参数', async () => {
    let capturedQuery: Record<string, string> = {};
    nock(GATE_HOST)
      .get(`${API_BASE}/futures/usdt/account_book`)
      .query((q) => { capturedQuery = q as Record<string, string>; return true; })
      .reply(200, []);

    await adapter.fetchFundingHistory!('ETH/USDT', 0);
    expect(capturedQuery['to']).toBeUndefined();
  });
});

describe('GateioAdapter.watchOrderFills 顺序不变量', () => {
  beforeEach(() => { h.wsInstances.length = 0; });

  it('即使 getContractSize 逆序 resolve，产出顺序仍等于到达顺序（防御 async 回调乱序）', async () => {
    const adapter = new GateioAdapter({ apiKey: 'k', apiSecret: 's' });

    // 控制 getContractSize 的 resolve 时机：收集 resolver，由测试驱动。
    const resolvers: Array<(n: number) => void> = [];
    vi.spyOn(adapter as unknown as { getContractSize: (s: string) => Promise<number> }, 'getContractSize')
      .mockImplementation(() => new Promise<number>((res) => { resolvers.push(res); }));

    const got: string[] = [];
    const collect = (async () => {
      for await (const f of adapter.watchOrderFills('')) {
        got.push(f.tradeId!);
        if (got.length === 3) break;
      }
    })();

    // 等生成器把 'data' handler 挂上
    await new Promise((r) => setTimeout(r, 0));
    const ws = h.wsInstances[h.wsInstances.length - 1];
    const trade = (id: string, ct: number) => ({ channel: 'futures.usertrades', result: { id, order_id: 'o', contract: 'ETH_USDT', size: 1, price: '100', fee: '0', create_time_ms: ct } });
    ws.emitData(trade('M1', 1));
    ws.emitData(trade('M2', 2));
    ws.emitData(trade('M3', 3));

    // 驱动：反复把「当前所有未决 resolver」逆序 resolve（旧实现 3 个同时挂起→逆序产出乱序；
    // 新实现消费端逐条 await→每次仅 1 个未决→始终按序）。
    for (let i = 0; i < 12 && got.length < 3; i++) {
      while (resolvers.length > 0) resolvers.pop()!(0.01);
      await new Promise((r) => setTimeout(r, 0));
    }
    await collect;

    expect(got).toEqual(['M1', 'M2', 'M3']);
  });
});

describe('GateioAdapter → GateioWsClient environment 透传', () => {
  beforeEach(() => { h.wsInstances.length = 0; });

  it('environment: "live" 透传给 watchOrderFills 创建的 GateioWsClient', async () => {
    const adapter = new GateioAdapter({ apiKey: 'k', apiSecret: 's', environment: 'live' });
    vi.spyOn(adapter as unknown as { getContractSize: (s: string) => Promise<number> }, 'getContractSize')
      .mockResolvedValue(1);

    const collect = (async () => {
      for await (const _f of adapter.watchOrderFills('')) {
        break;
      }
    })();

    await new Promise((r) => setTimeout(r, 0));
    const ws = h.wsInstances[h.wsInstances.length - 1];
    expect(ws.environment).toBe('live');

    ws.emitData({ channel: 'futures.usertrades', result: { id: '1', order_id: 'o', contract: 'ETH_USDT', size: 1, price: '100', fee: '0', create_time_ms: 1 } });
    await collect;
  });

  it('environment 缺省 → watchOrderFills 创建的 GateioWsClient 收到 "demo"', async () => {
    const adapter = new GateioAdapter({ apiKey: 'k', apiSecret: 's' });
    vi.spyOn(adapter as unknown as { getContractSize: (s: string) => Promise<number> }, 'getContractSize')
      .mockResolvedValue(1);

    const collect = (async () => {
      for await (const _f of adapter.watchOrderFills('')) {
        break;
      }
    })();

    await new Promise((r) => setTimeout(r, 0));
    const ws = h.wsInstances[h.wsInstances.length - 1];
    expect(ws.environment).toBe('demo');

    ws.emitData({ channel: 'futures.usertrades', result: { id: '1', order_id: 'o', contract: 'ETH_USDT', size: 1, price: '100', fee: '0', create_time_ms: 1 } });
    await collect;
  });
});
