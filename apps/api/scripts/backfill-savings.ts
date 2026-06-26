/**
 * 回填历史 Fill.savings/savingsRate 与 Run.totalSavings。
 * 用修复后的 computeSavings（买上沿/卖下沿）按 order.gridIndex + run.configSnapshot
 * 几何逐笔重算。幂等：可重复运行。默认 dry-run，加 --apply 才写库。
 */
import { PrismaClient } from '@prisma/client';
import { computeSavings } from '../src/modules/trading-engine/grid-geometry/savings-calculator';

const APPLY = process.argv.includes('--apply');
const p = new PrismaClient();

function buildConfig(snap: Record<string, unknown>): any {
  const sls = (snap?.stopLossGridStep as number) ?? 5;
  return {
    takeProfitPrice: (snap?.takeProfitPrice as number) ?? (snap?.boxTop as number) ?? 0,
    mainGridCount: (snap?.mainGridCount as number) ?? 0,
    mainGridStep: (snap?.mainGridStep as number) ?? 0,
    mainGridPortionSize: (snap?.mainGridPortionSize as number) ?? 1,
    stopLossGridCount: (snap?.stopLossGridCount as number) ?? 0,
    stopLossGridStep: sls,
    isolationStep: (snap?.isolationStep as number | null) ?? sls,
    direction: ((snap?.direction as string) ?? 'LONG'),
  };
}

(async () => {
  const runs = await p.run.findMany({ select: { id: true, runCode: true, configSnapshot: true, totalSavings: true } });
  let fillsChanged = 0, runsChanged = 0;
  let beforeTotal = 0, afterTotal = 0;
  for (const run of runs) {
    const cfg = buildConfig(run.configSnapshot as Record<string, unknown>); if (!(cfg.takeProfitPrice > 0)) { continue; }
    const fills = await p.fill.findMany({ where: { runId: run.id }, include: { order: { select: { gridIndex: true } } } });
    let runSavings = 0;
    for (const f of fills) {
      const gi = f.order?.gridIndex ?? -1;
      let savings = 0, savingsRate = 0;
      if (gi >= 0 && cfg.mainGridPortionSize > 0) {
        const portion = f.qty / cfg.mainGridPortionSize;
        const r = computeSavings(f.price, f.side as 'BUY' | 'SELL', gi, cfg, portion);
        savings = r.savings; savingsRate = r.savingsRate;
      }
      runSavings += savings;
      if (Math.abs(savings - f.savings) > 1e-9 || Math.abs(savingsRate - f.savingsRate) > 1e-9) {
        fillsChanged++;
        if (APPLY) await p.fill.update({ where: { id: f.id }, data: { savings, savingsRate } });
      }
    }
    beforeTotal += run.totalSavings; afterTotal += runSavings;
    if (Math.abs(runSavings - run.totalSavings) > 1e-9) {
      runsChanged++;
      if (APPLY) await p.run.update({ where: { id: run.id }, data: { totalSavings: runSavings } });
    }
  }
  console.log(`runs=${runs.length} fillsChanged=${fillsChanged} runsChanged=${runsChanged}`);
  console.log(`totalSavings before=${beforeTotal.toFixed(4)} after=${afterTotal.toFixed(4)} (${APPLY ? 'APPLIED' : 'DRY-RUN'})`);
  await p.$disconnect();
})().catch(e => { console.error(e); process.exit(1); });
