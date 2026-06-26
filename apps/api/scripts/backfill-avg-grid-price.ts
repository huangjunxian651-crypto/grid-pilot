/**
 * 回填历史 Fill.avgGridPrice / savings / savingsRate（及 Run.totalSavings）。
 *
 * 用修复后的 computeFillSavings（按持仓区间归属网格线，与成交价无关）逐笔重算，
 * 修复「追价成交落在网格线上方一丝 → avgGridPrice=0 → 前端显示 —」的历史数据。
 *
 * 关键：每张订单的多次部分成交需按时间顺序累加，重建 prevFilledQty
 * （落库时 fill-ingestion 用的是「本笔之前」的 order.filledQty，回填时 order.filledQty
 * 已是最终累计值，不能直接用，必须自行按序累加）。
 *
 * 幂等：仅在结果变化时写库。默认 dry-run，加 --apply 才写。
 *   运行：cd apps/api && npx ts-node scripts/backfill-avg-grid-price.ts [--apply]
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { computeFillSavings } from '../src/modules/trading-engine/grid-geometry/avg-grid-price';
import type { BoxTargetConfig } from '@gridpilot/shared-types';

const APPLY = process.argv.includes("--apply");
const MAX_FIX_PORTIONS = 4; // 只回填跨格数 <= 此值的普通网格成交；更大的视为重建/异常单，保持原样
const p = new PrismaClient();

function buildConfig(snap: Record<string, unknown>): BoxTargetConfig {
  const sls = (snap?.stopLossGridStep as number) ?? 5;
  return {
    takeProfitPrice: (snap?.takeProfitPrice as number) ?? (snap?.boxTop as number) ?? 0,
    mainGridCount: (snap?.mainGridCount as number) ?? 0,
    mainGridStep: (snap?.mainGridStep as number) ?? 0,
    mainGridPortionSize: (snap?.mainGridPortionSize as number) ?? 1,
    stopLossGridCount: (snap?.stopLossGridCount as number) ?? 0,
    stopLossGridStep: sls,
    isolationStep: (snap?.isolationStep as number | null) ?? sls,
    direction: ((snap?.direction as string) ?? 'LONG') as 'LONG' | 'SHORT',
  };
}

(async () => {
  const runs = await p.run.findMany({ select: { id: true, runCode: true, configSnapshot: true, totalSavings: true } });
  let totalFills = 0;
  let fillsChanged = 0;
  let runsChanged = 0;
  let bigSkipped = 0;
  let beforeTotal = 0;
  let afterTotal = 0;

  for (const run of runs) {
    const cfg = buildConfig(run.configSnapshot as Record<string, unknown>);
    if (!(cfg.takeProfitPrice > 0)) continue;

    const fills = await p.fill.findMany({
      where: { runId: run.id },
      include: { order: { select: { preOrderPosition: true, gridIndex: true } } },
      orderBy: [{ filledAt: 'asc' }, { id: 'asc' }],
    });

    const filledSoFar = new Map<string, number>(); // orderId -> 已累计成交量（结转 prevFilledQty）
    let runSavings = 0;

    for (const f of fills) {
      totalFills++;
      const prev = filledSoFar.get(f.orderId) ?? 0;
      const r = computeFillSavings({
        side: f.side as 'BUY' | 'SELL',
        price: f.price,
        config: cfg,
        preOrderPosition: f.order?.preOrderPosition ?? 0,
        prevFilledQty: prev,
        thisFillQty: f.qty,
      });
      filledSoFar.set(f.orderId, prev + f.qty);

      // 仅修复「本就该有网格价、却被旧实现错算成 0/— 」的**普通网格成交**：
      // 当前 avgGridPrice 为 0/空、订单 gridIndex 有效、新口径能算出非 0、且这笔只跨少数几格
      // （正常网格成交 1~数格）。不动已有数值的成交（避免扰动既有 savings）、不动 CLOSE/止盈平仓单
      // （gridIndex 空），也不动重建/异常大单（横跨几十上百格，其「跨线加权」不是真实套利 alpha）。
      const curAgp = f.avgGridPrice ?? 0;
      const inGrid = (f.order?.gridIndex ?? -1) >= 0;
      const portions = cfg.mainGridPortionSize > 0 ? f.qty / cfg.mainGridPortionSize : Infinity;
      const normalSize = portions <= MAX_FIX_PORTIONS + 1e-9;
      // 合理性护栏：网格价应落在「这笔成交可能跨过的格范围」内、即离成交价不远。
      // 早期 run 存在持仓与配置/价格不一致的脏数据（持仓远深于该价档），会算出离价数百的离谱网格价，
      // 须排除（保持 —），避免把假 alpha 写进库。
      const sane =
        r.avgGridPrice > 0 &&
        Math.abs(r.avgGridPrice - f.price) <= (portions + 2) * cfg.mainGridStep + 1e-9;
      if (curAgp === 0 && inGrid && r.avgGridPrice !== 0 && (!normalSize || !sane)) bigSkipped++;
      const shouldFix = curAgp === 0 && inGrid && r.avgGridPrice !== 0 && normalSize && sane;
      runSavings += shouldFix ? r.savings : f.savings;
      if (shouldFix) {
        fillsChanged++;
        if (APPLY) {
          await p.fill.update({
            where: { id: f.id },
            data: { avgGridPrice: r.avgGridPrice, savings: r.savings, savingsRate: r.savingsRate },
          });
        }
      }
    }

    beforeTotal += run.totalSavings;
    afterTotal += runSavings;
    if (Math.abs(runSavings - run.totalSavings) > 1e-9) {
      runsChanged++;
      if (APPLY) await p.run.update({ where: { id: run.id }, data: { totalSavings: runSavings } });
    }
  }

  console.log(`runs=${runs.length} fills=${totalFills} 修复主网格成交(0/—→真实网格价)=${fillsChanged}`);
  console.log(`  跳过的重建/异常大单(主网格内但跨格过多,保持 —)=${bigSkipped}`);
  console.log(`runsChanged=${runsChanged} totalSavings before=${beforeTotal.toFixed(4)} after=${afterTotal.toFixed(4)}`);
  console.log(APPLY ? 'APPLIED ✅' : 'DRY-RUN（加 --apply 才写库）');
  await p.$disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
