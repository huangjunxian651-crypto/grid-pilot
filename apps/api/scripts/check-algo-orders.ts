import { PrismaClient } from '@prisma/client';
import { CredentialCrypto } from '../src/modules/credential/credential-crypto';
import { BinanceAdapter } from '../src/modules/exchange/adapters/binance/binance.adapter';
import { GateioAdapter } from '../src/modules/exchange/adapters/gateio/gateio.adapter';
import { OkxAdapter } from '../src/modules/exchange/adapters/okx/okx.adapter';
async function main() {
  const prisma = new PrismaClient();
  const crypto = new CredentialCrypto(process.env.ENCRYPTION_KEY || '');
  for (const acct of await prisma.exchangeAccount.findMany({ where: { isActive: true } })) {
    const k = crypto.isEncrypted(acct.apiKey) ? crypto.decrypt(acct.apiKey) : acct.apiKey;
    const s = crypto.isEncrypted(acct.apiSecret) ? crypto.decrypt(acct.apiSecret) : acct.apiSecret;
    const p = acct.passphrase ? (crypto.isEncrypted(acct.passphrase) ? crypto.decrypt(acct.passphrase) : acct.passphrase) : '';
    const environment = acct.environment as 'demo' | 'live';
    const a = acct.exchangeId === 'binance' ? new BinanceAdapter({ apiKey: k, apiSecret: s, accountId: acct.id, environment })
      : acct.exchangeId === 'gateio' ? new GateioAdapter({ apiKey: k, apiSecret: s, accountId: acct.id, environment })
      : new OkxAdapter({ apiKey: k, apiSecret: s, passphrase: p, accountId: acct.id, environment });
    try {
      const algos = await a.fetchAlgoOrders('ETH/USDT');
      console.log(JSON.stringify({ exchange: acct.exchangeId, algoOrders: algos.length, sample: algos.slice(0,3).map((x:any)=>({trigger:x.triggerPrice,id:(x.clientAlgoId||x.algoId||'').slice(0,40)})) }));
    } catch (e) { console.log(JSON.stringify({ exchange: acct.exchangeId, error: (e as Error).message })); }
  }
  await prisma.$disconnect(); process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
