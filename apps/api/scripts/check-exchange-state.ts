// 一次性核对脚本:直接查询三所(交易所侧)的持仓与挂单,验证冷启动状态
// 用法: cd apps/api && npx ts-node --transpile-only -r tsconfig-paths/register check-exchange-state.ts
import { PrismaClient } from '@prisma/client';
import { CredentialCrypto } from '../src/modules/credential/credential-crypto';
import { BinanceAdapter } from '../src/modules/exchange/adapters/binance/binance.adapter';
import { GateioAdapter } from '../src/modules/exchange/adapters/gateio/gateio.adapter';
import { OkxAdapter } from '../src/modules/exchange/adapters/okx/okx.adapter';

const SYMBOL = 'ETH/USDT';

async function main() {
  const prisma = new PrismaClient();
  const crypto = new CredentialCrypto(process.env.ENCRYPTION_KEY || '');
  const accounts = await prisma.exchangeAccount.findMany({ where: { isActive: true } });

  for (const acct of accounts) {
    const apiKey = crypto.isEncrypted(acct.apiKey) ? crypto.decrypt(acct.apiKey) : acct.apiKey;
    const apiSecret = crypto.isEncrypted(acct.apiSecret) ? crypto.decrypt(acct.apiSecret) : acct.apiSecret;
    const passphrase = acct.passphrase
      ? (crypto.isEncrypted(acct.passphrase) ? crypto.decrypt(acct.passphrase) : acct.passphrase)
      : '';

    const environment = acct.environment as 'demo' | 'live';
    let adapter;
    if (acct.exchangeId === 'binance') adapter = new BinanceAdapter({ apiKey, apiSecret, accountId: acct.id, environment });
    else if (acct.exchangeId === 'gateio') adapter = new GateioAdapter({ apiKey, apiSecret, accountId: acct.id, environment });
    else adapter = new OkxAdapter({ apiKey, apiSecret, passphrase, accountId: acct.id, environment });

    try {
      const pos = await adapter.fetchPosition(SYMBOL);
      const orders = await adapter.fetchOpenOrders(SYMBOL);
      console.log(JSON.stringify({
        exchange: acct.exchangeId,
        label: acct.label,
        position: { qty: pos?.qty ?? 0, entryPrice: pos?.avgCost ?? null, side: (pos as any)?.side ?? null },
        openOrders: orders.length,
        orderSample: orders.slice(0, 5).map((o) => ({ id: o.orderId, side: o.side, price: o.price, status: o.status })),
      }));
    } catch (err) {
      console.log(JSON.stringify({ exchange: acct.exchangeId, label: acct.label, error: (err as Error).message }));
    }
  }
  await prisma.$disconnect();
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
