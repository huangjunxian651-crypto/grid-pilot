// 一次性清场脚本:撤掉三所全部挂单 + 强制平掉残留持仓,达到冷启动状态
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

    let adapter;
    if (acct.exchangeId === 'binance') adapter = new BinanceAdapter({ apiKey, apiSecret, accountId: acct.id });
    else if (acct.exchangeId === 'gateio') adapter = new GateioAdapter({ apiKey, apiSecret, accountId: acct.id });
    else adapter = new OkxAdapter({ apiKey, apiSecret, passphrase, accountId: acct.id });

    const result: Record<string, unknown> = { exchange: acct.exchangeId, label: acct.label };
    try {
      await adapter.cancelAllOrders(SYMBOL);
      result.cancelAll = 'ok';
    } catch (err) {
      result.cancelAll = `error: ${(err as Error).message}`;
    }

    try {
      const pos = await adapter.fetchPosition(SYMBOL);
      const side = (pos as any)?.side;
      if (pos && pos.qty > 0 && (side === 'long' || side === 'short')) {
        const order = await adapter.closePosition(SYMBOL, side);
        result.closed = { side, qty: pos.qty, orderId: order.orderId };
      } else {
        result.closed = 'no-position';
      }
    } catch (err) {
      result.closed = `error: ${(err as Error).message}`;
    }

    // 复核
    try {
      const pos2 = await adapter.fetchPosition(SYMBOL);
      const orders2 = await adapter.fetchOpenOrders(SYMBOL);
      result.verify = { qty: pos2?.qty ?? 0, side: (pos2 as any)?.side ?? 'none', openOrders: orders2.length };
    } catch (err) {
      result.verify = `error: ${(err as Error).message}`;
    }
    console.log(JSON.stringify(result));
  }
  await prisma.$disconnect();
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
