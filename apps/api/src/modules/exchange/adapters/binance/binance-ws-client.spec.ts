import { describe, it, expect, vi, beforeEach } from 'vitest';

// 仅 mock axios 的 put/post（refreshListenKey 用 put 续期、createListenKey 用 post 重建）
vi.mock('axios', () => ({ default: { put: vi.fn(), post: vi.fn() } }));
import axios from 'axios';
import { BinanceWsClient } from './binance-ws-client';
import { BINANCE_REST_DEMO, BINANCE_WS_DEMO, BINANCE_REST_LIVE, BINANCE_WS_LIVE } from './binance.types';

function makeUserDataClient(): any {
  const client = new BinanceWsClient({ apiKey: 'k', apiSecret: 's' }, true);
  (client as any).listenKey = 'old-key'; // 让 refreshListenKey 进入「有 listenKey」分支
  return client;
}

describe('BinanceWsClient listenKey 续期恢复（方案A）', () => {
  beforeEach(() => {
    vi.mocked(axios.put).mockReset();
    vi.mocked(axios.post).mockReset();
  });

  it('PUT 续期与 POST 重建均失败 → 触发一次 forceReconnect', async () => {
    const client = makeUserDataClient();
    vi.mocked(axios.put).mockRejectedValue(new Error('PUT down'));
    vi.mocked(axios.post).mockRejectedValue(new Error('POST down'));
    const forceSpy = vi.spyOn(client, 'forceReconnect').mockImplementation(() => {});
    await client.refreshListenKey();
    expect(forceSpy).toHaveBeenCalledTimes(1);
  });

  it('PUT 续期失败但 POST 重建成功 → 不重连，仅更新 listenKey（保守）', async () => {
    const client = makeUserDataClient();
    vi.mocked(axios.put).mockRejectedValue(new Error('PUT down'));
    vi.mocked(axios.post).mockResolvedValue({ data: { listenKey: 'new-key' } });
    const forceSpy = vi.spyOn(client, 'forceReconnect').mockImplementation(() => {});
    await client.refreshListenKey();
    expect(forceSpy).not.toHaveBeenCalled();
    expect((client as any).listenKey).toBe('new-key');
  });
});

// 直接读取构造函数解析出的 baseUrl/wsUrl（私有字段，与仓库内其余用例访问受保护/私有
// 成员的方式一致，见上方对 listenKey 的直接读写）——覆盖此前 review 指出的缺口：
// REST 侧（BinanceAdapter）已有环境路由测试，但 WS 侧三元表达式方向此前无测试兜底。
describe('BinanceWsClient environment routing', () => {
  it('environment 缺省 → baseUrl/wsUrl 解析为 DEMO', () => {
    const client = new BinanceWsClient({ apiKey: 'k', apiSecret: 's' });
    expect((client as any).baseUrl).toBe(BINANCE_REST_DEMO);
    expect((client as any).wsUrl).toBe(BINANCE_WS_DEMO);
  });

  it('environment: "demo" → baseUrl/wsUrl 解析为 DEMO', () => {
    const client = new BinanceWsClient({ apiKey: 'k', apiSecret: 's' }, false, 'demo');
    expect((client as any).baseUrl).toBe(BINANCE_REST_DEMO);
    expect((client as any).wsUrl).toBe(BINANCE_WS_DEMO);
  });

  it('environment: "live" → baseUrl/wsUrl 解析为 LIVE', () => {
    const client = new BinanceWsClient({ apiKey: 'k', apiSecret: 's' }, false, 'live');
    expect((client as any).baseUrl).toBe(BINANCE_REST_LIVE);
    expect((client as any).wsUrl).toBe(BINANCE_WS_LIVE);
  });
});
