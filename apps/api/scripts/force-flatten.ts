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
  // 护栏：本脚本会真实撤单/强平，只允许触达 demo 账户，避免误伤 live 实盘持仓
  const accounts = await prisma.exchangeAccount.findMany({ where: { isActive: true, environment: 'demo' } });

  const liveCount = await prisma.exchangeAccount.count({ where: { isActive: true, environment: 'live' } });
  if (liveCount > 0) {
    console.warn(`SKIPPED ${liveCount} live-environment account(s) — this script only touches demo accounts by design. 如需清理 live 账户请手动确认后单独处理，本脚本不做。`);
  }

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
