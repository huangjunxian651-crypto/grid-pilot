import { describe, it, expect } from 'vitest';
import { OkxAdapter } from './okx.adapter';

describe('OkxAdapter.getAccountUid', () => {
  it('returns uid from account/config', async () => {
    const adapter = new OkxAdapter({ apiKey: 'k', apiSecret: 's', passphrase: 'p', accountId: 'acc' });
    (adapter as any).rest = {
      getAccountConfig: async () => ({ code: '0', msg: '', data: [{ uid: '179248442252632064' }] }),
    };
    expect(await adapter.getAccountUid()).toBe('179248442252632064');
  });

  it('throws when account/config has no data', async () => {
    const adapter = new OkxAdapter({ apiKey: 'k', apiSecret: 's', passphrase: 'p', accountId: 'acc' });
    (adapter as any).rest = {
      getAccountConfig: async () => ({ code: '0', msg: '', data: [] }),
    };
    await expect(adapter.getAccountUid()).rejects.toThrow();
  });
});
