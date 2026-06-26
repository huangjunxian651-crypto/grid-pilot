import { describe, it, expect, vi } from 'vitest';
import { BinanceAdapter } from './binance.adapter';

describe('BinanceAdapter.getAccountUid', () => {
  it('returns accountAlias from /fapi/v2/balance', async () => {
    const adapter = new BinanceAdapter({ apiKey: 'k', apiSecret: 's', accountId: 'acc' });
    (adapter as any).signedRequest = vi.fn().mockResolvedValue([
      { accountAlias: 'SgsR', asset: 'USDT', balance: '100' },
      { accountAlias: 'SgsR', asset: 'BNB', balance: '0' },
    ]);
    expect(await adapter.getAccountUid()).toBe('SgsR');
    expect((adapter as any).signedRequest).toHaveBeenCalledWith('GET', '/fapi/v2/balance');
  });

  it('throws ACCOUNT_UID_MISSING when balance array is empty', async () => {
    const adapter = new BinanceAdapter({ apiKey: 'k', apiSecret: 's', accountId: 'acc' });
    (adapter as any).signedRequest = vi.fn().mockResolvedValue([]);
    await expect(adapter.getAccountUid()).rejects.toThrow(/accountAlias|UID/i);
  });

  it('throws when accountAlias is blank', async () => {
    const adapter = new BinanceAdapter({ apiKey: 'k', apiSecret: 's', accountId: 'acc' });
    (adapter as any).signedRequest = vi.fn().mockResolvedValue([{ accountAlias: '', asset: 'USDT' }]);
    await expect(adapter.getAccountUid()).rejects.toThrow(/accountAlias|UID/i);
  });
});
