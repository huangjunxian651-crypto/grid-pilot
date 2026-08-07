/**
 * 回填 ExchangeCredential.exchangeAccountId（通过真实 testnet getAccountUid），
 * 再把每个 GridRobot.exchangeAccountId 设为其 credential 的值。
 * 幂等：只处理 exchangeAccountId 为空的记录；Binance 等不支持 UID 的所自动跳过（保持 NULL）。
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { CredentialCrypto } from '../src/modules/credential/credential-crypto';
import { ExchangeAdapterFactory } from '../src/modules/exchange/exchange-adapter.factory';
import { ExchangeRegistryService } from '../src/modules/exchange/exchange-registry.service';

export async function backfillExchangeAccountId(
  prisma: PrismaClient,
  crypto: CredentialCrypto,
  factory: ExchangeAdapterFactory,
): Promise<{ credsResolved: number; credsSkipped: number; robotsLinked: number }> {
  let credsResolved = 0;
  let credsSkipped = 0;

  const creds = await prisma.exchangeCredential.findMany({ where: { exchangeAccountId: null } });
  for (const c of creds) {
    const adapter = factory.createAdapter({
      exchangeId: c.exchangeId,
      accountId: c.accountId,
      apiKey: crypto.decrypt(c.apiKey),
      apiSecret: crypto.decrypt(c.apiSecret),
      passphrase: c.passphrase ? crypto.decrypt(c.passphrase) : undefined,
      environment: c.environment as "demo" | "live",
    });
    try {
      const uid = await adapter.getAccountUid();
      await prisma.exchangeCredential.update({ where: { id: c.id }, data: { exchangeAccountId: uid } });
      credsResolved += 1;
      console.log(`credential ${c.exchangeId}/${c.accountId} -> uid ${uid}`);
    } catch (e) {
      credsSkipped += 1;
      console.log(`credential ${c.exchangeId}/${c.accountId} skipped: ${(e as Error).message}`);
    } finally {
      adapter.destroy();
    }
  }

  let robotsLinked = 0;
  const robots = await prisma.gridRobot.findMany({ where: { exchangeAccountId: null } });
  for (const r of robots) {
    const cred = await prisma.exchangeCredential.findUnique({ where: { id: r.credentialId } });
    if (cred?.exchangeAccountId) {
      await prisma.gridRobot.update({ where: { id: r.id }, data: { exchangeAccountId: cred.exchangeAccountId } });
      robotsLinked += 1;
    }
  }

  return { credsResolved, credsSkipped, robotsLinked };
}

if (require.main === module) {
  const prisma = new PrismaClient();
  const crypto = new CredentialCrypto(process.env.ENCRYPTION_KEY!);
  const factory = new ExchangeAdapterFactory(new ExchangeRegistryService());
  backfillExchangeAccountId(prisma, crypto, factory)
    .then((r) => console.log(`Done: ${r.credsResolved} creds resolved, ${r.credsSkipped} skipped, ${r.robotsLinked} robots linked`))
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => void prisma.$disconnect());
}
