/**
 * Binance 模拟盘(demo-fapi)实测:条件单(algoType=CONDITIONAL)触发后,
 * clientAlgoId 是否传播到生成的普通订单与成交。
 *
 * 与 scripts/verify-okx-algo-clordid.ts 同法:用 BTC/USDT(避开正在跑
 * ETHUSDT bot 的仓位)下贴近市价的 STOP_MARKET 触发单,等触发后检查:
 *   1. /fapi/v1/allOrders 中生成订单的 clientOrderId 字段
 *   2. /fapi/v1/historyAlgoOrders(若存在)中的关联 orderId
 *   3. /fapi/v1/userTrades 成交回报的字段
 *
 * 运行:npx ts-node scripts/verify-binance-algo-clientid.ts
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { CredentialCrypto } from '../src/modules/credential/credential-crypto';
import { BinanceAdapter } from '../src/modules/exchange/adapters/binance/binance.adapter';

const SYMBOL = 'BTC/USDT';
const BINANCE_SYMBOL = 'BTCUSDT';

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const prisma = new PrismaClient();
  const account = await prisma.exchangeAccount.findFirst({ where: { exchangeId: 'binance' } });
  if (!account) throw new Error('no binance account in DB');
  const crypto = new CredentialCrypto(process.env.ENCRYPTION_KEY!);
  const adapter = new BinanceAdapter({
    apiKey: crypto.decrypt(account.apiKey),
    apiSecret: crypto.decrypt(account.apiSecret),
    accountId: 'verify-binance-algo',
  });
  // 护栏：脚本会真实下单，必须确认在 demo 环境（当前 adapter 硬编码 demo，
  // 将来若支持实盘切换，此断言阻止脚本静默跟进实盘）
  const baseUrl = (adapter as unknown as { baseUrl: string }).baseUrl;
  if (!/demo|testnet/.test(baseUrl)) {
    throw new Error(`REFUSING TO RUN: adapter base URL is not a demo environment (${baseUrl})`);
  }

  const raw = (method: string, endpoint: string, params: Record<string, unknown>) =>
    (adapter as unknown as { signedRequest: (m: string, e: string, p: Record<string, unknown>) => Promise<unknown> })
      .signedRequest(method, endpoint, params);

  const cleanupAlgoIds: string[] = [];
  let positionOpened = false;
  const startTime = Date.now() - 10_000;

  try {
    const info = await adapter.getMarketInfo(SYMBOL);
    const ticker = await adapter.getTicker(SYMBOL);
    console.log(`[setup] last=${ticker.lastPrice} minQty=${info.minQty} tick=${info.tickSize}`);

    const pos = await adapter.fetchPosition(SYMBOL);
    if (pos.side !== 'none' && Math.abs(pos.qty) > 1e-12) {
      throw new Error(`BTC position already exists (${pos.qty}), aborting to avoid interference`);
    }

    const clientAlgoId = `VERIFYBNALGO${Date.now().toString(36)}`.slice(0, 36);
    const roundToTick = (p: number) => Math.round(p / info.tickSize) * info.tickSize;

    let triggered = false;
    for (let attempt = 0; attempt < 3 && !triggered; attempt++) {
      const t = await adapter.getTicker(SYMBOL);
      const triggerPrice = roundToTick(t.lastPrice * (1 + 0.0002 / (attempt + 1)));
      // Binance 名义价值须 ≥50 USDT(-4164)
      const step = info.stepSize ?? info.minQty;
      const minNotionalQty = Math.ceil((55 / t.lastPrice) / step) * step;
      const algo = await adapter.createAlgoOrder({
        symbol: SYMBOL,
        side: 'buy',
        triggerPrice,
        triggerCondition: 'price_above',
        qty: Math.max(info.minQty, minNotionalQty),
        clientAlgoId,
      });
      console.log(`[attempt ${attempt + 1}] algoId=${algo.algoOrderId} clientAlgoId(sent)=${clientAlgoId} trigger=${triggerPrice}`);
      cleanupAlgoIds.push(algo.algoOrderId);

      const deadline = Date.now() + 60_000;
      while (Date.now() < deadline) {
        await sleep(3000);
        const open = await adapter.fetchAlgoOrders(SYMBOL);
        const still = open.find((o) => o.algoOrderId === algo.algoOrderId);
        process.stdout.write(`  pending=${!!still} last=${(await adapter.getTicker(SYMBOL)).lastPrice}\r`);
        if (!still) {
          triggered = true;
          console.log('\n[triggered] algo no longer pending');
          break;
        }
      }
      if (!triggered) {
        await adapter.cancelAlgoOrder(cleanupAlgoIds[cleanupAlgoIds.length - 1], SYMBOL).catch(() => {});
      }
    }

    if (!triggered) {
      console.log('RESULT: INCONCLUSIVE — algo never triggered within time budget');
      return;
    }
    positionOpened = true;

    await sleep(2000);

    // 1. algo 历史:触发后状态与关联 orderId(端点若不存在则忽略)
    try {
      const hist = (await raw('GET', '/fapi/v1/historyAlgoOrders', { symbol: BINANCE_SYMBOL, startTime })) as Record<string, unknown>;
      console.log(`[algoHistory] ${JSON.stringify(hist).slice(0, 600)}`);
    } catch (e) {
      console.log(`[algoHistory] unavailable: ${(e as Error).message.slice(0, 120)}`);
    }

    // 2. 生成的普通订单:clientOrderId 字段
    const orders = (await raw('GET', '/fapi/v1/allOrders', { symbol: BINANCE_SYMBOL, startTime, limit: 10 })) as Array<Record<string, unknown>>;
    for (const o of orders) {
      console.log(`[order] orderId=${o.orderId} clientOrderId="${o.clientOrderId}" type=${o.type ?? o.origType} status=${o.status}`);
    }

    // 3. 成交回报字段
    const trades = (await raw('GET', '/fapi/v1/userTrades', { symbol: BINANCE_SYMBOL, startTime })) as Array<Record<string, unknown>>;
    for (const t of trades) {
      console.log(`[fill] tradeId=${t.id} orderId=${t.orderId} keys=${Object.keys(t).join(',')}`);
    }

    const generated = orders.find((o) => o.clientOrderId === clientAlgoId);
    console.log('');
    console.log(`RESULT: 生成订单 clientOrderId 传播=${!!generated}${generated ? ` (orderId=${generated.orderId})` : ''}`);
    console.log(`RESULT: userTrades 是否带 clientOrderId 字段=${trades.some((t) => 'clientOrderId' in t)}`);
  } finally {
    for (const algoId of cleanupAlgoIds) {
      await adapter.cancelAlgoOrder(algoId, SYMBOL).catch(() => {});
    }
    if (positionOpened) {
      await adapter.closePosition(SYMBOL, 'long').catch((e: Error) => console.log(`[cleanup] close failed: ${e.message}`));
      console.log('[cleanup] test position closed');
    }
    adapter.destroy?.();
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
