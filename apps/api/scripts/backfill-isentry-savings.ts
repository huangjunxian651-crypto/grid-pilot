/**
 * 回填历史 Order.isEntry，并把「首笔建仓」成交的超额收益归零。
 *
 * 背景：df257a5 给「进场首笔市价建仓」加了 isEntry 标记——这类成交不是网格买卖往返，
 * 不存在相对网格线的额外价差，故 savings/avgGridPrice 应为 0（computeFillSavings 对 isEntry 返回 ZERO）。
 * 但该修复只加了列(默认 false)+改新成交逻辑，**没有回填历史**，导致历史建仓单仍把首笔计入超额收益。
 *
 * 口径与 grid-bot-runner.isInitialEntryBuild 完全一致：
 *   加仓方向（LONG→BUY / SHORT→SELL）且 |下单前持仓| ≤ max(portion·0.5, 1e-8)。
 *
 * 动作：① 给符合口径的 Order 置 isEntry=true；② 其成交 savings/savingsRate/avgGridPrice 归 0；
 *      ③ 重算受影响 Run.totalSavings。幂等，默认 dry-run，加 --apply 才写库。
 *   运行：cd apps/api && npx ts-node scripts/backfill-isentry-savings.ts [--apply]
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const APPLY = process.argv.includes('--apply');
const prisma = new PrismaClient();

function isPositionIncreasing(direction: string, side: string): boolean {
  return direction === 'LONG' ? side === 'BUY' : side === 'SELL';
}

(async () => {
  const runs = await prisma.run.findMany({
    select: { id: true, runCode: true, configSnapshot: true, totalSavings: true },
  });

  let ordersMarked = 0;
  let fillsZeroed = 0;
  let runsChanged = 0;
  let beforeTotal = 0;
  let afterTotal = 0;

  for (const run of runs) {
    const snap = (run.configSnapshot ?? {}) as Record<string, unknown>;
    const direction = (snap.direction as string) ?? 'LONG';
    const portion = (snap.mainGridPortionSize as number) ?? 1;
    const flatEps = Math.max(portion * 0.5, 1e-8);

    const orders = await prisma.order.findMany({
      where: { runId: run.id },
      select: { id: true, side: true, preOrderPosition: true, isEntry: true },
    });

    const entryOrderIds: string[] = [];
    for (const o of orders) {
      const entry =
        isPositionIncreasing(direction, o.side) &&
        Math.abs(o.preOrderPosition ?? 0) <= flatEps;
      if (entry) entryOrderIds.push(o.id);
      if (entry && !o.isEntry) {
        ordersMarked++;
        if (APPLY) await prisma.order.update({ where: { id: o.id }, data: { isEntry: true } });
      }
    }

    // 受影响成交：建仓单上的成交 → savings/avgGridPrice 归 0
    if (entryOrderIds.length > 0) {
      const entryFills = await prisma.fill.findMany({
        where: { orderId: { in: entryOrderIds } },
        select: { id: true, savings: true, savingsRate: true, avgGridPrice: true },
      });
      for (const f of entryFills) {
        const changed =
          Math.abs(f.savings) > 1e-9 ||
          Math.abs(f.savingsRate) > 1e-9 ||
          Math.abs(f.avgGridPrice ?? 0) > 1e-9;
        if (changed) {
          fillsZeroed++;
          if (APPLY) {
            await prisma.fill.update({
              where: { id: f.id },
              data: { savings: 0, savingsRate: 0, avgGridPrice: 0 },
            });
          }
        }
      }
    }

    // 重算该 run 的 totalSavings（成交归零后的真实和）
    const fills = await prisma.fill.findMany({
      where: { runId: run.id },
      select: { orderId: true, savings: true },
    });
    const entrySet = new Set(entryOrderIds);
    const runSavings = fills.reduce(
      (sum, f) => sum + (entrySet.has(f.orderId) ? 0 : f.savings),
      0,
    );
    beforeTotal += run.totalSavings;
    afterTotal += runSavings;
    if (Math.abs(runSavings - run.totalSavings) > 1e-9) {
      runsChanged++;
      if (APPLY) await prisma.run.update({ where: { id: run.id }, data: { totalSavings: runSavings } });
    }
  }

  console.log(`runs=${runs.length} 标记 isEntry 订单=${ordersMarked} 归零建仓成交=${fillsZeroed}`);
  console.log(`runsChanged=${runsChanged} totalSavings before=${beforeTotal.toFixed(4)} after=${afterTotal.toFixed(4)} (差=${(afterTotal - beforeTotal).toFixed(4)})`);
  console.log(APPLY ? 'APPLIED ✅' : 'DRY-RUN（加 --apply 才写库）');
  await prisma.$disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
