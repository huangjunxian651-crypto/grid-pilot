/**
 * 真实 testnet 验证：用库内已配置的 testnet 凭证调各所 getAccountUid。
 * 期望：gateio/okx 返回非空数字串；binance 抛 NOT_SUPPORTED。
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { CredentialCrypto } from '../src/modules/credential/credential-crypto';
import { ExchangeAdapterFactory } from '../src/modules/exchange/exchange-adapter.factory';
import { ExchangeRegistryService } from '../src/modules/exchange/exchange-registry.service';

async function main() {
  const prisma = new PrismaClient();
  const crypto = new CredentialCrypto(process.env.ENCRYPTION_KEY!);
  const factory = new ExchangeAdapterFactory(new ExchangeRegistryService());
  const creds = await prisma.exchangeCredential.findMany();

  let failures = 0;
  for (const c of creds) {
    const adapter = factory.createAdapter({
      exchangeId: c.exchangeId,
      accountId: c.accountId,
      apiKey: crypto.decrypt(c.apiKey),
      apiSecret: crypto.decrypt(c.apiSecret),
      passphrase: c.passphrase ? crypto.decrypt(c.passphrase) : undefined,
    });
    try {
      const uid = await adapter.getAccountUid();
      const ok = c.exchangeId === 'binance' ? false : /^\d+$/.test(uid);
      console.log(`${c.exchangeId}: uid=${uid} ${ok ? 'OK' : 'UNEXPECTED'}`);
      if (c.exchangeId === 'binance') { console.log('  binance UNEXPECTED: should have thrown'); failures++; }
      else if (!ok) failures++;
    } catch (e) {
      if (c.exchangeId === 'binance') {
        console.log(`binance: threw as expected (${(e as Error).message}) OK`);
      } else {
        console.log(`${c.exchangeId}: threw UNEXPECTEDLY: ${(e as Error).message}`);
        failures++;
      }
    } finally {
      adapter.destroy();
    }
  }
  await prisma.$disconnect();
  if (failures > 0) { console.error(`\n${failures} failure(s)`); process.exit(1); }
  console.log('\nAll account UID checks passed.');
}

main().catch((e) => { console.error(e); process.exit(1); });
