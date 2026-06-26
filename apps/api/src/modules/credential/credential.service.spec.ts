import { describe, it, expect, beforeEach } from 'vitest';
import { CredentialService } from './credential.service';
import { CredentialCrypto } from './credential-crypto';

function applySelect(row: any, select?: Record<string, boolean>) {
  if (!row || !select) return row;
  const out: Record<string, any> = {};
  for (const key of Object.keys(select)) {
    if (select[key]) out[key] = row[key];
  }
  return out;
}

function makePrismaMock() {
  const store: Record<string, any> = {};
  return {
    _store: store,
    exchangeAccount: {
      create: async ({ data }: any) => { const r = { id: 'c1', ...data }; store['c1'] = r; return r; },
      findUnique: async ({ where, select }: any) => applySelect(store[where.id] ?? null, select),
      findMany: async ({ select }: any = {}) => Object.values(store).map((r) => applySelect(r, select)),
      update: async ({ where, data }: any) => { store[where.id] = { ...store[where.id], ...data }; return store[where.id]; },
      delete: async ({ where }: any) => { const r = store[where.id]; delete store[where.id]; return r; },
    },
  };
}

describe('CredentialService encryption', () => {
  let service: CredentialService;
  let prisma: ReturnType<typeof makePrismaMock>;
  const crypto = new CredentialCrypto('test-key-for-service-spec-123456');

  beforeEach(() => {
    prisma = makePrismaMock();
    service = new CredentialService(prisma as any, crypto);
  });

  it('create stores apiKey/apiSecret/passphrase encrypted (not plaintext)', async () => {
    await service.create({ exchangeId: 'okx', accountId: 'a', label: 'l', apiKey: 'KEY123', apiSecret: 'SEC456', passphrase: 'PASS789' } as any);
    const row = prisma._store['c1'];
    expect(row.apiKey).not.toBe('KEY123');
    expect(crypto.isEncrypted(row.apiKey)).toBe(true);
    expect(crypto.isEncrypted(row.apiSecret)).toBe(true);
    expect(crypto.isEncrypted(row.passphrase)).toBe(true);
  });

  it('findOneWithSecrets returns DECRYPTED plaintext', async () => {
    await service.create({ exchangeId: 'okx', accountId: 'a', label: 'l', apiKey: 'KEY123', apiSecret: 'SEC456', passphrase: 'PASS789' } as any);
    const got = await service.findOneWithSecrets('c1');
    expect(got.apiKey).toBe('KEY123');
    expect(got.apiSecret).toBe('SEC456');
    expect(got.passphrase).toBe('PASS789');
  });

  it('create without passphrase leaves it null/empty, no crash', async () => {
    await service.create({ exchangeId: 'binance', accountId: 'a', label: 'l', apiKey: 'K', apiSecret: 'S' } as any);
    const got = await service.findOneWithSecrets('c1');
    expect(got.apiKey).toBe('K');
    expect(got.passphrase == null || got.passphrase === '').toBe(true);
  });

  it('findAll does NOT expose passphrase', async () => {
    await service.create({ exchangeId: 'okx', accountId: 'a', label: 'l', apiKey: 'K', apiSecret: 'S', passphrase: 'P' } as any);
    const all = await service.findAll();
    expect('passphrase' in all[0]).toBe(false);
  });

  describe('findOneMasked', () => {
    it('returns masked apiKey/apiSecret showing first 4 and last 4 chars', async () => {
      await service.create({ exchangeId: 'binance', accountId: 'a', label: 'l', apiKey: 'ABCDEFGHIJ1234', apiSecret: 'SECRETKEY9876' } as any);
      const got = await service.findOneMasked('c1');
      expect(got.apiKeyMasked).toBe('ABCD***1234');
      expect(got.apiSecretMasked).toBe('SECR***9876');
      expect((got as any).apiKey).toBeUndefined();
      expect((got as any).apiSecret).toBeUndefined();
    });

    it('handles short keys (< 8 chars) by showing first 2 and last 2', async () => {
      await service.create({ exchangeId: 'binance', accountId: 'a', label: 'l', apiKey: 'ABC', apiSecret: 'XY' } as any);
      const got = await service.findOneMasked('c1');
      expect(got.apiKeyMasked).toBe('AB***C');
      expect(got.apiSecretMasked).toBe('XY***');
    });

    it('throws NotFoundException for missing id', async () => {
      await expect(service.findOneMasked('nonexistent')).rejects.toThrow('Credential nonexistent not found');
    });
  });

  describe('update with encryption', () => {
    it('encrypts new apiKey/apiSecret/passphrase on update', async () => {
      await service.create({ exchangeId: 'binance', accountId: 'a', label: 'l', apiKey: 'OLDKEY', apiSecret: 'OLDSEC', passphrase: 'OLDPASS' } as any);
      await service.update('c1', { apiKey: 'NEWKEY', apiSecret: 'NEWSEC', passphrase: 'NEWPASS' } as any);
      const decrypted = await service.findOneWithSecrets('c1');
      expect(decrypted.apiKey).toBe('NEWKEY');
      expect(decrypted.apiSecret).toBe('NEWSEC');
      expect(decrypted.passphrase).toBe('NEWPASS');
    });

    it('does NOT overwrite encrypted values when secret fields are omitted', async () => {
      await service.create({ exchangeId: 'binance', accountId: 'a', label: 'l', apiKey: 'ORIGKEY', apiSecret: 'ORIGSEC' } as any);
      await service.update('c1', { label: 'new-label' } as any);
      const decrypted = await service.findOneWithSecrets('c1');
      expect(decrypted.apiKey).toBe('ORIGKEY');
      expect(decrypted.apiSecret).toBe('ORIGSEC');
      expect(decrypted.label).toBe('new-label');
    });

    it('clears passphrase when empty string is sent', async () => {
      await service.create({ exchangeId: 'okx', accountId: 'a', label: 'l', apiKey: 'K', apiSecret: 'S', passphrase: 'P' } as any);
      await service.update('c1', { passphrase: '' } as any);
      const decrypted = await service.findOneWithSecrets('c1');
      expect(decrypted.passphrase == null || decrypted.passphrase === '').toBe(true);
    });
  });
});
