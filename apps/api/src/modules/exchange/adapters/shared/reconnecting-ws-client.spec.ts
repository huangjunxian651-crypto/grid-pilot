import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// 受控的假 WebSocket：记录每次实例化，可手动 emit open/close 驱动重连生命周期。
const { WebSocketMock, sockets } = vi.hoisted(() => {
  const { EventEmitter } = require('events');
  const sockets: any[] = [];
  class FakeSocket extends EventEmitter {
    readyState = 0; // CONNECTING
    url: string;
    constructor(url: string) {
      super();
      this.url = url;
      sockets.push(this);
    }
    close() {
      this.emit('close');
    }
  }
  // 必须是普通函数（可被 `new` 调用并返回 FakeSocket）；箭头函数不能 new。
  const WebSocketMock: any = vi.fn(function (url: string) {
    return new FakeSocket(url);
  });
  WebSocketMock.CONNECTING = 0;
  WebSocketMock.OPEN = 1;
  WebSocketMock.CLOSING = 2;
  WebSocketMock.CLOSED = 3;
  return { WebSocketMock, sockets };
});

vi.mock('ws', () => ({ default: WebSocketMock }));

import { ReconnectingWsClient } from './reconnecting-ws-client';

class TestClient extends ReconnectingWsClient {
  constructor() {
    super('Test');
  }
  protected buildConnectUrl(): string {
    return 'wss://test/ws';
  }
  protected afterSocketOpen(): void {}
  protected handleParsedMessage(): void {}
  protected heartbeatIntervalMs(): number | null {
    return null;
  }
  protected sendHeartbeat(): void {}
}

describe('ReconnectingWsClient 自动重连', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    sockets.length = 0;
    WebSocketMock.mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // 关闭最新 socket 触发重连调度，断言重连「恰好」在 delayMs 后发起（精确验证退避序列）：
  // 先快进 delayMs-1 应无新连接，再快进 1ms 才出现新连接。
  async function expectReconnectAfter(delayMs: number): Promise<void> {
    const before = sockets.length;
    sockets[before - 1].emit('close');
    await vi.advanceTimersByTimeAsync(delayMs - 1);
    expect(sockets.length, `${delayMs - 1}ms 时不应重连`).toBe(before);
    await vi.advanceTimersByTimeAsync(1);
    expect(sockets.length, `${delayMs}ms 时应重连`).toBe(before + 1);
  }

  it('指数退避 1s→…→60s 封顶，且超过旧上限(10)后仍持续重连', async () => {
    const client = new TestClient();
    client.on('error', () => {});
    void client.connect();
    await vi.advanceTimersByTimeAsync(0); // flush buildConnectUrl 微任务 → 建立首个 socket
    expect(WebSocketMock).toHaveBeenCalledTimes(1);

    // 精确退避序列：1,2,4,8,16,32s 后封顶 60s 并一直 60s；共 13 次（远超旧上限 10）。
    const expected = [1000, 2000, 4000, 8000, 16000, 32000, 60000, 60000, 60000, 60000, 60000, 60000, 60000];
    for (const delayMs of expected) await expectReconnectAfter(delayMs);

    // 13 次重连 + 首连 = 14 个 socket；旧实现 10 次后放弃 → 至多 11。
    expect(sockets.length).toBe(expected.length + 1);
    expect(sockets.length).toBeGreaterThan(11);
    client.disconnect();
  });

  it('退避封顶 60s；成功 open 后退避重置回 1s', async () => {
    const client = new TestClient();
    client.on('error', () => {});
    void client.connect();
    await vi.advanceTimersByTimeAsync(0);

    // 爬到 60s 封顶（退避序列前 8 段）
    for (const delayMs of [1000, 2000, 4000, 8000, 16000, 32000, 60000, 60000]) {
      await expectReconnectAfter(delayMs);
    }

    // 一次成功握手应把退避计数归零
    const opened = sockets[sockets.length - 1];
    opened.readyState = 1; // OPEN
    opened.emit('open');
    await vi.advanceTimersByTimeAsync(0);

    const before = sockets.length;
    opened.emit('close');
    // 若已重置回 1s，则 1s 内必发起重连；若仍是 60s 退避，则 1s 内不会。
    await vi.advanceTimersByTimeAsync(1000);
    expect(sockets.length).toBe(before + 1);
    client.disconnect();
  });
});

describe('ReconnectingWsClient.forceReconnect', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    sockets.length = 0;
    WebSocketMock.mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('未 disposed 时关闭当前 socket 并触发重连', async () => {
    const client = new TestClient();
    client.on('error', () => {});
    void client.connect();
    await vi.advanceTimersByTimeAsync(0); // 建立首个 socket
    const sock = sockets[sockets.length - 1];
    sock.readyState = 1; // OPEN
    sock.emit('open');
    await vi.advanceTimersByTimeAsync(0);

    const closeSpy = vi.spyOn(sock, 'close');
    const before = sockets.length;
    (client as any).forceReconnect();
    expect(closeSpy).toHaveBeenCalledTimes(1);
    // close → scheduleReconnect（开局退避 1s）→ 新 socket
    await vi.advanceTimersByTimeAsync(1000);
    expect(sockets.length).toBe(before + 1);
    client.disconnect();
  });

  it('已 disposed（disconnect 后）时为 no-op，不再触发连接', async () => {
    const client = new TestClient();
    client.on('error', () => {});
    void client.connect();
    await vi.advanceTimersByTimeAsync(0);
    client.disconnect(); // isDisposed = true，且内部已 ws.close + ws=null
    const before = sockets.length;
    (client as any).forceReconnect();
    await vi.advanceTimersByTimeAsync(60000);
    expect(sockets.length).toBe(before); // 无新连接
  });
});
