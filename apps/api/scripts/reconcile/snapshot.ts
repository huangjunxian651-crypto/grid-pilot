/**
 * snapshot.ts — 单检查点采集「交易所真值层 + 后端 DB 层」，落 JSON。
 * 页面层（kimi-webbridge）由编排侧单独采集并并入同一条记录。
 *
 * 用法（apps/api 下，ts-node）：
 *   DATABASE_URL=... ENCRYPTION_KEY=... ts-node scripts/reconcile/snapshot.ts \
 *     --robotId=<id> --label=cp-00 [--since=<ms>] [--out=<dir>]
 *
 * 每层独立 try/catch：失败记 {error}，不中断整轮（设计·风险兜底）。
 */
import { PrismaClient } from "@prisma/client";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { BinanceAdapter } from "../../src/modules/exchange/adapters/binance/binance.adapter";
import { GateioAdapter } from "../../src/modules/exchange/adapters/gateio/gateio.adapter";
import { OkxAdapter } from "../../src/modules/exchange/adapters/okx/okx.adapter";
import { CredentialCrypto } from "../../src/modules/credential/credential-crypto";
import type { IExchangeAdapter } from "../../src/modules/exchange/interfaces/exchange-adapter.interface";

function arg(name: string, def?: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : def;
}

function createAdapter(exchangeId: string, c: { apiKey: string; apiSecret: string; passphrase?: string; accountId: string }): IExchangeAdapter {
  switch (exchangeId) {
    case "binance":
      return new BinanceAdapter({ apiKey: c.apiKey, apiSecret: c.apiSecret, accountId: c.accountId });
    case "gateio":
      return new GateioAdapter({ apiKey: c.apiKey, apiSecret: c.apiSecret, accountId: c.accountId });
    case "okx":
      return new OkxAdapter({ apiKey: c.apiKey, apiSecret: c.apiSecret, passphrase: c.passphrase ?? "", accountId: c.accountId });
    default:
      throw new Error(`Unsupported exchange: ${exchangeId}`);
  }
}

async function safe<T>(fn: () => Promise<T>): Promise<{ value?: T; error?: string; capturedAt: number }> {
  const capturedAt = Date.now();
  try {
    return { value: await fn(), capturedAt };
  } catch (e: any) {
    return { error: e?.message ?? String(e), capturedAt };
  }
}

async function main() {
  const robotId = arg("robotId");
  const label = arg("label") ?? "cp";
  const outDir = arg("out") ?? join(__dirname, "../../../../e2e/reconcile/out");
  if (!robotId) throw new Error("--robotId 必填");

  const prisma = new PrismaClient();
  const crypto = new CredentialCrypto(process.env.ENCRYPTION_KEY ?? "");

  const robot = await prisma.robot.findUnique({ where: { id: robotId }, include: { account: true } });
  if (!robot) throw new Error(`robot not found: ${robotId}`);
  const exchangeId = robot.account.exchangeId;
  const symbol = robot.symbol;

  // 最新 run（优先未结束）
  const activeBoxId = robot.activeBoxId ?? undefined;
  const run = await prisma.run.findFirst({
    where: { box: { robotId: robot.id } },
    orderBy: { startedAt: "desc" },
    include: { fills: { orderBy: { filledAt: "desc" }, take: 60 }, box: true },
  });

  // 取数窗口：run.startedAt 回滚 5 分钟（与后端对账一致），无 run 则近 2h
  const sinceArg = arg("since");
  const since = sinceArg ? Number(sinceArg) : run ? run.startedAt.getTime() - 5 * 60_000 : Date.now() - 2 * 3600_000;

  // ---- 后端 DB 层 ----
  const dbLayer = {
    capturedAt: Date.now(),
    robot: { id: robot.id, exchangeId, symbol, direction: robot.direction, status: robot.status, activeBoxId },
    run: run
      ? {
          runCode: run.runCode,
          state: run.state,
          startedAt: run.startedAt.toISOString(),
          endedAt: run.endedAt?.toISOString() ?? null,
          exitReason: run.exitReason,
          realizedPnl: run.realizedPnl,
          totalFees: run.totalFees,
          totalSavings: run.totalSavings,
          fillCount: run.fillCount,
          pnlSignedPosition: run.pnlSignedPosition,
          pnlAvgCost: run.pnlAvgCost,
        }
      : null,
    fills: (run?.fills ?? []).map((f) => ({
      exchangeFillId: f.exchangeFillId,
      side: f.side,
      qty: f.qty,
      price: f.price,
      fee: f.fee,
      gridIndex: f.gridIndex,
      savings: f.savings,
      savingsRate: f.savingsRate,
      realizedPnlDelta: f.realizedPnlDelta,
      filledAt: f.filledAt.toISOString(),
    })),
  };

  // ---- 交易所真值层 ----
  const adapter = createAdapter(exchangeId, {
    apiKey: crypto.decrypt(robot.account.apiKey),
    apiSecret: crypto.decrypt(robot.account.apiSecret),
    passphrase: robot.account.passphrase ? crypto.decrypt(robot.account.passphrase) : undefined,
    accountId: robot.account.accountId,
  });

  const exLayer = {
    balance: await safe(() => adapter.fetchBalance()),
    position: await safe(() => adapter.fetchPosition(symbol)),
    openOrders: await safe(() => adapter.fetchOpenOrders(symbol)),
    algoOrders: await safe(() => (adapter.fetchAlgoOrders ? adapter.fetchAlgoOrders(symbol) : Promise.resolve([]))),
    myTrades: await safe(() => (adapter.fetchMyTrades ? adapter.fetchMyTrades(symbol, since) : Promise.resolve([]))),
  };

  try {
    adapter.destroy?.();
  } catch {
    /* ignore */
  }

  const record = {
    checkpoint: label,
    exchangeId,
    symbol,
    robotId: robot.id,
    runCode: run?.runCode ?? null,
    since,
    db: dbLayer,
    exchange: exLayer,
    page: null, // 由编排侧 kimi-webbridge 写入
  };

  const dir = join(outDir, exchangeId, robot.id);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${label}.json`);
  writeFileSync(file, JSON.stringify(record, null, 2));

  // 控制台速览
  const pos = exLayer.position.value as any;
  const bal = exLayer.balance.value as any;
  console.log(`\n[${label}] ${exchangeId} ${symbol} robot=${robot.status} run=${run?.runCode ?? "-"}(${run?.state ?? "-"})`);
  console.log(`  交易所: 权益=${bal?.totalEquity ?? exLayer.balance.error ?? "?"} usdt=${bal?.usdt ?? "?"} | 持仓 ${pos?.side ?? exLayer.position.error ?? "?"} qty=${pos?.qty ?? "?"} avg=${pos?.avgCost ?? "?"} uPnL=${pos?.unrealizedPnl ?? "?"}`);
  console.log(`  交易所: 挂单=${(exLayer.openOrders.value as any[])?.length ?? exLayer.openOrders.error} algo=${(exLayer.algoOrders.value as any[])?.length ?? exLayer.algoOrders.error} 成交(since)=${(exLayer.myTrades.value as any[])?.length ?? exLayer.myTrades.error}`);
  console.log(`  后端DB: realizedPnl=${dbLayer.run?.realizedPnl} savings=${dbLayer.run?.totalSavings} fills=${dbLayer.run?.fillCount} pos=${dbLayer.run?.pnlSignedPosition} avg=${dbLayer.run?.pnlAvgCost}`);
  console.log(`  → ${file}`);

  await prisma.$disconnect();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
