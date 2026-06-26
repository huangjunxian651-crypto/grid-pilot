/**
 * 发现脚本：列出每个交易所真实可测的账户/robot/最近 run。
 * 用法： npx dotenv -e ../../.env -- tsx discover.ts   （在 apps/api 下运行以复用 prisma client）
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const accounts = await prisma.exchangeAccount.findMany({
    orderBy: { exchangeId: "asc" },
  });
  console.log(`\n=== ExchangeAccount (${accounts.length}) ===`);
  for (const a of accounts) {
    console.log(
      `  [${a.exchangeId}] id=${a.id} label=${a.label} active=${a.isActive} uid=${a.exchangeUid ?? "-"} acct=${a.accountId}`,
    );
  }

  const robots = await prisma.robot.findMany({
    include: { account: true, boxes: true },
    orderBy: { createdAt: "desc" },
  });
  console.log(`\n=== Robot (${robots.length}) ===`);
  for (const r of robots) {
    console.log(
      `  id=${r.id} ex=${r.account.exchangeId} sym=${r.symbol} dir=${r.direction} status=${r.status} activeBox=${r.activeBoxId ?? "-"} acctId=${r.accountId} boxes=${r.boxes.length}`,
    );
  }

  const boxes = await prisma.box.findMany({
    where: { deletedAt: null },
    include: { account: true },
    orderBy: { updatedAt: "desc" },
    take: 20,
  });
  console.log(`\n=== Box/config (latest ${boxes.length}) ===`);
  for (const b of boxes) {
    console.log(
      `  id=${b.id} ex=${b.account.exchangeId} sym=${b.symbol} dir=${b.direction} status=${b.status} robotId=${b.robotId ?? "-"} grid=${b.mainGridCount}x portion=${b.mainGridPortionSize} lev=${b.leverage} excessMult=${b.excessProfitMultiplier} trailingEntry=${b.trailingEntry}`,
    );
  }

  const runs = await prisma.run.findMany({
    include: { box: { include: { account: true } } },
    orderBy: { startedAt: "desc" },
    take: 15,
  });
  console.log(`\n=== Run (latest ${runs.length}) ===`);
  for (const r of runs) {
    const live = r.endedAt ? "ended" : "LIVE";
    console.log(
      `  ${live} runCode=${r.runCode} ex=${r.box.account.exchangeId} sym=${r.box.symbol} state=${r.state} startedAt=${r.startedAt.toISOString()} realizedPnl=${r.realizedPnl} savings=${r.totalSavings} fills=${r.fillCount} pos=${r.pnlSignedPosition} avg=${r.pnlAvgCost} exit=${r.exitReason ?? "-"}`,
    );
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
