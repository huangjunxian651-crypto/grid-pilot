/**
 * reconcile.ts — 读一条 snapshot 记录，做三层/手算对账，输出判定。
 *   - diff-A：交易所成交净额/持仓 vs 后端 DB(pnlSignedPosition、全量 fills)
 *   - diff-C：用 computeRealizedPnl 对「交易所成交」与「DB 成交」分别手算 realizedPnl，
 *             与 DB Run.realizedPnl 三方比对，定位是数据缺漏还是状态机发散
 *   - 成交 ID 集合差集：交易所 tradeId/orderId vs DB exchangeFillId
 *
 * 用法（apps/api 下）：
 *   DATABASE_URL=... ts-node scripts/reconcile/reconcile.ts --file=<snapshot.json>
 */
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";
import { computeRealizedPnl, FillLite } from "../../src/modules/trading-engine/savings/compute-realized-pnl";

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}
const round = (n: number) => Math.round(n * 1e8) / 1e8;
const near = (a: number, b: number, tol = 1e-6) => Math.abs(a - b) <= tol;

async function main() {
  const file = arg("file");
  if (!file) throw new Error("--file 必填");
  const snap = JSON.parse(readFileSync(file, "utf8"));
  const exTrades: any[] = snap.exchange?.myTrades?.value ?? [];
  const exPos: any = snap.exchange?.position?.value ?? null;
  const runCode: string | null = snap.runCode;

  const prisma = new PrismaClient();
  const run = runCode
    ? await prisma.run.findUnique({ where: { runCode }, include: { fills: true } })
    : null;
  const dbFills = run?.fills ?? [];

  // ---- 净持仓 ----
  const exNet = round(
    exTrades.reduce((s, t) => s + (t.side === "buy" ? t.filledQty : -t.filledQty), 0),
  );
  const dbNet = round(
    dbFills.reduce((s, f) => s + (f.side === "BUY" || f.side === "buy" ? f.qty : -f.qty), 0),
  );
  const exPosQty = exPos ? (exPos.side === "short" ? -exPos.qty : exPos.qty) : null;

  // ---- 手算 realizedPnl ----
  const toLite = (side: string, qty: number, price: number, ts: number): FillLite => ({
    side: side.toUpperCase() === "BUY" ? "BUY" : "SELL",
    fillQty: qty,
    fillPrice: price,
    ts,
  });
  const exRealized = round(
    computeRealizedPnl(exTrades.map((t) => toLite(t.side, t.filledQty, t.avgPrice, t.ts))),
  );
  const dbRealized = round(
    computeRealizedPnl(
      dbFills.map((f) => toLite(f.side, f.qty, f.price, new Date(f.filledAt).getTime())),
    ),
  );

  // ---- 成交 ID 集合差集 ----
  const exIds = new Set(exTrades.map((t) => String(t.tradeId ?? t.orderId)));
  const dbIds = new Set(dbFills.map((f) => f.exchangeFillId));
  const onlyEx = [...exIds].filter((id) => !dbIds.has(id));
  const onlyDb = [...dbIds].filter((id) => !exIds.has(id));

  const J = (ok: boolean) => (ok ? "✓" : "✗");
  console.log(`\n========== reconcile ${snap.exchangeId} ${snap.checkpoint} run=${runCode} ==========`);
  console.log(`持仓净额:`);
  console.log(`  交易所 fetchPosition = ${exPosQty}`);
  console.log(`  交易所 成交净额(Σbuy-Σsell) = ${exNet}   ${J(exPosQty !== null && near(exNet, exPosQty, 1e-3))} (vs fetchPosition)`);
  console.log(`  后端DB pnlSignedPosition = ${run?.pnlSignedPosition}`);
  console.log(`  后端DB 成交净额(全量${dbFills.length}笔) = ${dbNet}   ${J(run != null && near(dbNet, run.pnlSignedPosition, 1e-3))} (vs pnlSignedPosition)`);
  console.log(`  diff-A 交易所持仓 vs DB签名持仓: ${J(exPosQty !== null && run != null && near(exPosQty, run.pnlSignedPosition, 1e-3))}`);
  console.log(`已实现盈亏:`);
  console.log(`  手算(交易所成交) = ${exRealized}`);
  console.log(`  手算(DB成交)     = ${dbRealized}`);
  console.log(`  后端DB Run.realizedPnl = ${run?.realizedPnl}`);
  console.log(`  diff-C 手算(DB成交) vs DB.realizedPnl: ${J(run != null && near(dbRealized, run.realizedPnl, 1e-2))}`);
  console.log(`  diff   手算(交易所) vs DB.realizedPnl: ${J(run != null && near(exRealized, run.realizedPnl, 1e-2))}`);
  console.log(`成交计数: 交易所=${exTrades.length} DB=${dbFills.length}  缺漏(仅交易所有)=${onlyEx.length} 多余(仅DB有)=${onlyDb.length}`);
  if (onlyEx.length) console.log(`  仅交易所有的 id(前5): ${onlyEx.slice(0, 5).join(", ")}`);
  if (onlyDb.length) console.log(`  仅DB有的 id(前5): ${onlyDb.slice(0, 5).join(", ")}`);

  await prisma.$disconnect();
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
