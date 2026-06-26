import { describe, it, expect, vi, beforeEach } from 'vitest';

// 仅 mock axios 的 put/post（refreshListenKey 用 put 续期、createListenKey 用 post 重建）
vi.mock('axios', () => ({ default: { put: vi.fn(), post: vi.fn() } }));
import axios from 'axios';
import { BinanceWsClient } from './binance-ws-client';

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
