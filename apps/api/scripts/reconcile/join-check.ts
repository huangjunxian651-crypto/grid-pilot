/**
 * join-check.ts — 按 tradeId join 交易所成交(快照) 与 DB Fill,逐笔比 side/qty,定位污染。
 *   DATABASE_URL=... ts-node scripts/reconcile/join-check.ts --file=<snapshot.json>
 */
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";
function arg(n: string) { const h = process.argv.find((a) => a.startsWith(`--${n}=`)); return h ? h.slice(n.length + 3) : undefined; }
const norm = (s: string) => s.toUpperCase();
async function main() {
  const snap = JSON.parse(readFileSync(arg("file")!, "utf8"));
  const exTrades: any[] = snap.exchange?.myTrades?.value ?? [];
  const prisma = new PrismaClient();
  const run = await prisma.run.findUnique({ where: { runCode: snap.runCode }, include: { fills: true } });
  const dbFills = run!.fills;

  const exById = new Map<string, any>();
  for (const t of exTrades) exById.set(String(t.tradeId ?? t.orderId), t);
  const dbById = new Map<string, any>();
  for (const f of dbFills) dbById.set(String(f.exchangeFillId), f);

  let sideMismatch = 0, qtyMismatch = 0, matched = 0;
  let netFromSideErr = 0, netFromQtyErr = 0;
  const samples: string[] = [];
  for (const [id, f] of dbById) {
    const t = exById.get(id);
    if (!t) continue;
    matched++;
    const exSide = norm(t.side), dbSide = norm(f.side);
    if (exSide !== dbSide) {
      sideMismatch++;
      // DB 记反方向: 净额误差 = 2*qty*(DB方向符号)
      const sign = dbSide === "BUY" ? 1 : -1;
      netFromSideErr += 2 * f.qty * sign; // DB 比真实多算的净额
      if (samples.length < 8) samples.push(`id=${id} 交易所=${exSide} DB=${dbSide} qty=${f.qty} px=${f.price}`);
    }
    if (Math.abs((t.filledQty ?? 0) - f.qty) > 1e-9) {
      qtyMismatch++;
      const sign = dbSide === "BUY" ? 1 : -1;
      netFromQtyErr += (f.qty - (t.filledQty ?? 0)) * sign;
    }
  }
  console.log(`\n=== join-check ${snap.exchangeId} run=${snap.runCode} ===`);
  console.log(`交易所成交=${exTrades.length} DB成交=${dbFills.length} 按id匹配=${matched}`);
  console.log(`side 不一致(DB存反): ${sideMismatch} 笔  → 由此多算净持仓 ≈ ${Math.round(netFromSideErr * 1e6) / 1e6}`);
  console.log(`qty 不一致: ${qtyMismatch} 笔  → 由此净持仓误差 ≈ ${Math.round(netFromQtyErr * 1e6) / 1e6}`);
  console.log(`实测净持仓差(DB ${run!.pnlSignedPosition} - 交易所真值) 需由上面误差解释`);
  if (samples.length) console.log(`side 不一致样本:\n  ${samples.join("\n  ")}`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
