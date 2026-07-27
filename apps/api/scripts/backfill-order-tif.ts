/**
 * 回填历史 Order.tif（POC/GTC）。tif 补采集链路上线前下的单没有持久化这个字段，但成交时的
 * 手续费费率是确凿的历史事实——汇总该订单名下全部成交的手续费/成交额，按贴近 maker/taker
 * 哪个基准费率来反推（见 aggregateOrderTif/inferHistoricalTif）。幂等：只处理 tif 仍为 NULL 的
 * Order，可重复运行。默认 dry-run，加 --apply 才写库。
 */
import { PrismaClient } from '@prisma/client';
import { aggregateOrderTif } from '../src/modules/trading-engine/fills/backfill-historical-tif';

const APPLY = process.argv.includes('--apply');
const p = new PrismaClient();

(async () => {
  const orders = await p.order.findMany({
    where: { tif: null },
    select: {
      id: true,
      run: { select: { box: { select: { symbol: true } } } },
      fills: { select: { fee: true, feeAsset: true, qty: true, price: true, notional: true } },
    },
  });

  let pocCount = 0;
  let gtcCount = 0;
  let noFillCount = 0;

  for (const order of orders) {
    const symbol = order.run?.box?.symbol ?? '';
    if (order.fills.length === 0) noFillCount++;
    const tif = aggregateOrderTif(order.fills, symbol);
    if (tif === 'POC') pocCount++;
    else gtcCount++;

    if (APPLY) {
      await p.order.update({ where: { id: order.id }, data: { tif } });
    }
  }

  console.log(`orders=${orders.length} → POC=${pocCount} GTC=${gtcCount} (其中无成交/默认归 POC 的=${noFillCount})`);
  console.log(APPLY ? 'APPLIED' : 'DRY-RUN（加 --apply 才真正写库）');
  await p.$disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
