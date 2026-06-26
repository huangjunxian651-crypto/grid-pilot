import { describe, it, expect, vi } from 'vitest';
import { MockExchangeAdapter } from './mock-exchange-adapter';
import { BotManagerService, type TickerSource } from '../../robot/bot-manager.service';
import { delay } from './test-helpers';

const boxRow = (id: string) => ({
  id, direction: 'LONG', takeProfitPrice: 2800, mainGridCount: 200, mainGridStep: 2,
  stopLossGridCount: 4, stopLossGridStep: 2, activationPrice: 0, trailingEntry: true, enabled: true,
});

describe('BotManager activation driven by real ticker stream (blackbox)', () => {
  it('activates a box when the ticker stream enters the activation window', async () => {
    const adapter = new MockExchangeAdapter();
    // MockExchangeAdapter.subscribeTicker loops while this._connected; must connect first.
    await adapter.connect();

    const prisma = {
      robot: {
        update: vi.fn().mockResolvedValue({}),
        findUnique: vi.fn().mockResolvedValue({
          id: 'robot-1',
          symbol: 'ETH/USDT',
          status: 'PAUSED',
          accountId: 'cred-1',
        }),
      },
      box: { findMany: vi.fn().mockResolvedValue([boxRow('box-1')]), count: vi.fn().mockResolvedValue(1) },
      run: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    };
    const startBot = vi.fn().mockResolvedValue({ runCode: 'sc' });
    const launcher = { startBot, stopBot: vi.fn().mockResolvedValue(undefined), setOnBoxTerminated: vi.fn() };

    // Wire MockExchangeAdapter.subscribeTicker into the TickerSource interface.
    // The yielded Ticker.last field carries the price pushed via pushTick().
    const tickerSource: TickerSource = {
      subscribe(_robotId, _credentialId, symbol, onPrice) {
        let active = true;
        void (async () => {
          for await (const t of adapter.subscribeTicker(symbol)) {
            if (!active) break;
            onPrice(t.last);
          }
        })();
        return () => { active = false; };
      },
    };

    const svc = new BotManagerService(prisma as any, launcher as any, tickerSource, { getSnapshot: vi.fn() } as any, { createAndBroadcast: vi.fn().mockResolvedValue({}) } as any);
    await svc.startRobot('robot-1');

    // price=2700 is above activationPrice=2600 → outside window (2400, 2600) → no activation
    adapter.pushTick(2700);
    await delay(50);
    expect(startBot).not.toHaveBeenCalled();

    // price=2550 is in (2400, 2600) → inside window → activation triggered
    adapter.pushTick(2550);
    await delay(50);
    expect(startBot).toHaveBeenCalledTimes(1);
    expect(svc.getLatestPrice('robot-1')).toBe(2550);

    await svc.requestStop('robot-1', { closePosition: true });
    await adapter.disconnect();
  });
});
