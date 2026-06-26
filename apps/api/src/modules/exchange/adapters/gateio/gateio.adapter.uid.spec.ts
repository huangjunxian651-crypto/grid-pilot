import { describe, it, expect } from 'vitest';
import { GateioAdapter } from './gateio.adapter';

describe('GateioAdapter.getAccountUid', () => {
  it('returns the userId from getAccountDetail as a string', async () => {
    const adapter = new GateioAdapter({ apiKey: 'k', apiSecret: 's', accountId: 'acc' });
    (adapter as any).accountApi = {
      getAccountDetail: async () => ({ body: { userId: 5524474 } }),
    };
    expect(await adapter.getAccountUid()).toBe('5524474');
  });

  it('throws when getAccountDetail returns no userId', async () => {
    const adapter = new GateioAdapter({ apiKey: 'k', apiSecret: 's', accountId: 'acc' });
    (adapter as any).accountApi = {
      getAccountDetail: async () => ({ body: {} }),
    };
    await expect(adapter.getAccountUid()).rejects.toThrow();
  });
});
