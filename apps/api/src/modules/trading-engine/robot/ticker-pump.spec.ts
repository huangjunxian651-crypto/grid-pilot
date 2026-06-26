import { describe, it, expect } from 'vitest';
import { pumpTickerWithReconnect } from './ticker-pump';

const noSleep = async () => {};

describe('pumpTickerWithReconnect', () => {
  it('流正常结束（不抛错）后自动重连续推——修复列表标记价冻结', async () => {
    // 复现根因：旧实现 for-await 跑完一次流就退出、永不重订，latestPrice Map 冻结。
    // 这里每条流 yield 一个价后"干净结束"（模拟 WS 关闭 / 迭代器 done，不抛错）。
    const prices: number[] = [];
    let subscribeCalls = 0;
    const subscribe = () => {
      subscribeCalls += 1;
      const round = subscribeCalls;
      return (async function* () {
        yield { last: round };
      })();
    };

    await pumpTickerWithReconnect({
      subscribe,
      onPrice: (p) => prices.push(p),
      isActive: () => prices.length < 2,
      sleep: noSleep,
    });

    // 第一条流结束后必须重连（第二次 subscribe），并继续推价
    expect(subscribeCalls).toBe(2);
    expect(prices).toEqual([1, 2]);
  });

  it('流抛错也重连，并通过 onError 上报（不静默吞）', async () => {
    const prices: number[] = [];
    const errors: string[] = [];
    let calls = 0;
    const subscribe = () => {
      calls += 1;
      const round = calls;
      return (async function* () {
        if (round === 1) throw new Error('ws drop');
        yield { last: 99 };
      })();
    };

    await pumpTickerWithReconnect({
      subscribe,
      onPrice: (p) => prices.push(p),
      onError: (e) => errors.push((e as Error).message),
      isActive: () => prices.length < 1,
      sleep: noSleep,
    });

    expect(errors).toContain('ws drop');
    expect(prices).toEqual([99]);
  });

  it('重连前按 reconnectDelayMs 退避', async () => {
    const delays: number[] = [];
    let calls = 0;
    await pumpTickerWithReconnect({
      subscribe: () => {
        calls += 1;
        const round = calls;
        return (async function* () {
          yield { last: round };
        })();
      },
      onPrice: () => {},
      isActive: () => calls < 2, // 第一条流结束→退避→第二次 subscribe 后停
      reconnectDelayMs: 500,
      sleep: async (ms) => {
        delays.push(ms);
      },
    });
    expect(delays).toContain(500);
  });

  it('isActive 初始为 false 时立即返回，不订阅', async () => {
    let calls = 0;
    await pumpTickerWithReconnect({
      subscribe: () => {
        calls += 1;
        return (async function* () {})();
      },
      onPrice: () => {},
      isActive: () => false,
      sleep: noSleep,
    });
    expect(calls).toBe(0);
  });

  it('isActive 转为 false 后停止：流跑到一半被叫停则不再推价', async () => {
    const prices: number[] = [];
    let active = true;
    const subscribe = () =>
      (async function* () {
        yield { last: 1 };
        yield { last: 2 }; // 第二个价在 active=false 后不应被推
      })();

    await pumpTickerWithReconnect({
      subscribe,
      onPrice: (p) => {
        prices.push(p);
        active = false; // 推第一个价后立即停
      },
      isActive: () => active,
      sleep: noSleep,
    });

    expect(prices).toEqual([1]);
  });
});
