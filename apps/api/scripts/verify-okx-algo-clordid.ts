/**
 * OKX 模拟盘实测:algo 触发单的 algoClOrdId 是否传播到生成的普通订单与成交。
 *
 * 背景:紧急止损 algo 不经 onOrderPlaced 落库,触发后的平仓成交靠 ingest
 * 按 clientOrderId 解析兜底补建 Order 行——该兜底仅在交易所把 algoClOrdId
 * 传播到触发单/成交回报时对 OKX 生效,此前 spec 标注"待实盘验证"。
 *
 * 流程(全程 OKX 模拟盘,x-simulated-trading 恒开):
 *   1. 用 BTC/USDT(避开正在跑 ETHUSDT bot 的仓位)下一个贴近市价的
 *      price_above 触发单,带 algoClOrdId
 *   2. 轮询 algo 状态直到 effective,拿生成的 ordId
 *   3. 查该订单与其成交的 clOrdId / algoClOrdId 字段
 *   4. 清理:撤未触发 algo / 市价平掉测试仓位
 *
 * 运行:npx ts-node scripts/verify-okx-algo-clordid.ts
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { CredentialCrypto } from '../src/modules/credential/credential-crypto';
import { OkxAdapter } from '../src/modules/exchange/adapters/okx/okx.adapter';

const SYMBOL = 'BTC/USDT';
const INST_ID = 'BTC-USDT-SWAP';

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const prisma = new PrismaClient();
  const account = await prisma.exchangeAccount.findFirst({ where: { exchangeId: 'okx' } });
  if (!account) throw new Error('no okx account in DB');
  const crypto = new CredentialCrypto(process.env.ENCRYPTION_KEY!);
  const adapter = new OkxAdapter({
    apiKey: crypto.decrypt(account.apiKey),
    apiSecret: crypto.decrypt(account.apiSecret),
    passphrase: account.passphrase ? crypto.decrypt(account.passphrase) : '',
    accountId: 'verify-algo-clordid',
  });
  const rest = (adapter as unknown as { rest: { client: { get: Function; post: Function; defaults: { headers: Record<string, unknown> } } } }).rest;

  // 护栏：脚本会真实下单，必须确认在模拟盘（当前 adapter 硬编码 demo，
  // 将来若支持实盘切换，此断言阻止脚本静默跟进实盘）
  if (String(rest.client.defaults.headers['x-simulated-trading']) !== '1') {
    throw new Error('REFUSING TO RUN: adapter is not in simulated-trading mode');
  }

  const cleanupAlgoIds: string[] = [];
  let positionOpened = false;

  try {
    const info = await adapter.getMarketInfo(SYMBOL);
    const ticker = await adapter.getTicker(SYMBOL);
    console.log(`[setup] last=${ticker.lastPrice} minQty=${info.minQty} tick=${info.tickSize}`);

    const pos = await adapter.fetchPosition(SYMBOL);
    if (pos.side !== 'none' && Math.abs(pos.qty) > 1e-12) {
      throw new Error(`BTC position already exists (${pos.qty}), aborting to avoid interference`);
    }

    await adapter.setLeverage(SYMBOL, 5).catch(() => {});

    const algoClOrdId = `VERIFYALGO${Date.now().toString(36)}`.replace(/[^a-zA-Z0-9]/g, '').slice(0, 32);
    const roundToTick = (p: number) => Math.round(p / info.tickSize) * info.tickSize;

    // 贴近市价挂 price_above 触发单,等行情波动触发;60s 未触发则撤掉重挂更近的
    let triggered: { ordId: string } | null = null;
    for (let attempt = 0; attempt < 3 && !triggered; attempt++) {
      const t = await adapter.getTicker(SYMBOL);
      const triggerPrice = roundToTick(t.lastPrice * (1 + 0.0002 / (attempt + 1)));
      const algo = await adapter.createAlgoOrder({
        symbol: SYMBOL,
        side: 'buy',
        triggerPrice,
        triggerCondition: 'price_above',
        qty: Math.max(info.minQty, info.contractSize ?? 0.01), // 至少 1 张
        clientAlgoId: algoClOrdId,
      });
      console.log(`[attempt ${attempt + 1}] algoId=${algo.algoOrderId} algoClOrdId(sent)=${algoClOrdId} trigger=${triggerPrice}`);
      cleanupAlgoIds.push(algo.algoOrderId);

      const deadline = Date.now() + 60_000;
      while (Date.now() < deadline) {
        await sleep(3000);
        const { data: res } = await rest.client.get('/api/v5/trade/order-algo', {
          params: { algoId: algo.algoOrderId },
        });
        const d = (res as { data?: Array<Record<string, string>> }).data?.[0];
        if (!d) continue;
        process.stdout.write(`  state=${d.state} last=${(await adapter.getTicker(SYMBOL)).lastPrice}\r`);
        if (d.state === 'effective') {
          triggered = { ordId: d.ordId ?? '' };
          positionOpened = true;
          console.log(`\n[triggered] generated ordId=${d.ordId}`);
          break;
        }
        if (d.state === 'canceled' || d.state === 'order_failed') {
          console.log(`\n[failed] state=${d.state} msg=${d.failCode ?? ''} ${d.failReason ?? ''}`);
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

    // 触发单详情:clOrdId / algoClOrdId 字段
    const { data: orderRes } = await rest.client.get('/api/v5/trade/order', {
      params: { instId: INST_ID, ordId: triggered.ordId },
    });
    const order = (orderRes as { data?: Array<Record<string, string>> }).data?.[0] ?? {};
    console.log(`[order]  ordId=${order.ordId} clOrdId="${order.clOrdId}" algoClOrdId="${order.algoClOrdId}" state=${order.state}`);

    // 成交回报:clOrdId 字段
    await sleep(2000);
    const { data: fillsRes } = await rest.client.get('/api/v5/trade/fills', {
      params: { instType: 'SWAP', instId: INST_ID, ordId: triggered.ordId },
    });
    const fills = (fillsRes as { data?: Array<Record<string, string>> }).data ?? [];
    for (const f of fills) {
      console.log(`[fill]   tradeId=${f.tradeId} clOrdId="${f.clOrdId}" ordId=${f.ordId}`);
    }

    const propagatedToOrder = order.clOrdId === algoClOrdId || order.algoClOrdId === algoClOrdId;
    const propagatedToFills = fills.length > 0 && fills.every((f) => f.clOrdId === algoClOrdId);
    console.log('');
    console.log(`RESULT: order.clOrdId 传播=${order.clOrdId === algoClOrdId} order.algoClOrdId 传播=${order.algoClOrdId === algoClOrdId}`);
    console.log(`RESULT: fills.clOrdId 传播=${propagatedToFills} (${fills.length} fills)`);
    console.log(`RESULT: ingest 兜底对 OKX ${propagatedToFills || propagatedToOrder ? '可用(至少经 REST 订单查询)' : '不可用,需另行处理'}`);
  } finally {
    for (const algoId of cleanupAlgoIds) {
      await adapter.cancelAlgoOrder(algoId, SYMBOL).catch(() => {});
    }
    if (positionOpened) {
      await adapter.closePosition(SYMBOL, 'long').catch((e: Error) => console.log(`[cleanup] close failed: ${e.message}`));
      console.log('[cleanup] test position closed');
    }
    adapter.destroy();
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
