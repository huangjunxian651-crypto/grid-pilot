/**
 * analyze-fills.ts — 解剖某 run 的 Fill 行,定位双记/漏记机制。
 *   DATABASE_URL=... ts-node scripts/reconcile/analyze-fills.ts --runCode=<runCode>
 */
import { PrismaClient } from "@prisma/client";
function arg(n: string) {
  const h = process.argv.find((a) => a.startsWith(`--${n}=`));
  return h ? h.slice(n.length + 3) : undefined;
}
async function main() {
  const runCode = arg("runCode")!;
  const prisma = new PrismaClient();
  const run = await prisma.run.findUnique({ where: { runCode }, include: { fills: { orderBy: { filledAt: "asc" }, include: { order: true } } } });
  if (!run) throw new Error("no run");
  const fills = run.fills;
  const composite = fills.filter((f) => /_/.test(f.exchangeFillId));
  const numeric = fills.filter((f) => !/_/.test(f.exchangeFillId));
  console.log(`run=${runCode} fills=${fills.length} pnlSignedPosition=${run.pnlSignedPosition} realizedPnl=${run.realizedPnl}`);
  console.log(`exchangeFillId 形态: 纯数字(真实tradeId)=${numeric.length}  组合键(含_)=${composite.length}`);

  // 按 (side,qty,price,秒级时间) 分组,找疑似同一笔交易被记多次
  const groups = new Map<string, typeof fills>();
  for (const f of fills) {
    const k = `${f.side}|${f.qty}|${f.price}|${Math.floor(new Date(f.filledAt).getTime() / 1000)}`;
    const arr = groups.get(k) ?? [];
    arr.push(f);
    groups.set(k, arr);
  }
  const dups = [...groups.entries()].filter(([, a]) => a.length > 1);
  console.log(`\n疑似重复组(同 side/qty/price/秒, 多条不同 exchangeFillId): ${dups.length} 组`);
  let extraQty = 0;
  for (const [k, a] of dups.slice(0, 12)) {
    const ids = a.map((f) => f.exchangeFillId);
    const orderIds = [...new Set(a.map((f) => f.orderId))];
    console.log(`  ${k} ×${a.length}  ids=[${ids.join(", ")}]  内部orderId数=${orderIds.length}`);
    const q = a[0].qty * (a.length - 1) * (a[0].side === "BUY" || a[0].side === "buy" ? 1 : -1);
    extraQty += q;
  }
  console.log(`\n重复组多记的净持仓(前若干组估算): ${Math.round(extraQty * 1e6) / 1e6}`);

  // 按内部 orderId 看是否一笔交易跨多个内部 order
  const byFillId = new Map<string, Set<string>>();
  for (const f of fills) {
    const base = f.exchangeFillId.split("_")[0];
    const s = byFillId.get(base) ?? new Set();
    s.add(f.orderId);
    byFillId.set(base, s);
  }
  const crossOrder = [...byFillId.entries()].filter(([, s]) => s.size > 1);
  console.log(`同一 tradeId 跨多个内部 order 的: ${crossOrder.length}`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
