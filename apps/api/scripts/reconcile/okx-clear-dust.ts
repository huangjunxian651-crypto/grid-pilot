/** 一次性清掉 OKX 残仓（机器人已 STOPPED，无对账窗口污染）。 */
import { PrismaClient } from "@prisma/client";
import { OkxAdapter } from "../../src/modules/exchange/adapters/okx/okx.adapter";
import { CredentialCrypto } from "../../src/modules/credential/credential-crypto";
async function main() {
  const prisma = new PrismaClient();
  // 护栏：本脚本会真实平仓，只允许触达 demo 账户，避免误伤 live 实盘持仓
  const account = await prisma.exchangeAccount.findFirst({ where: { exchangeId: "okx", environment: "demo" } });
  if (!account) {
    console.error("No demo-environment OKX account found. This script only targets demo accounts by design.");
    process.exit(1);
  }
  const crypto = new CredentialCrypto(process.env.ENCRYPTION_KEY ?? "");
  const adapter = new OkxAdapter({
    apiKey: crypto.decrypt(account!.apiKey),
    apiSecret: crypto.decrypt(account!.apiSecret),
    passphrase: account!.passphrase ? crypto.decrypt(account!.passphrase) : "",
    accountId: account!.accountId,
    environment: account!.environment as "demo" | "live",
  });
  const before = await adapter.fetchPosition("ETH/USDT");
  console.log("before:", before.side, before.qty);
  if (before.qty > 0) {
    await adapter.closePosition("ETH/USDT", before.side as "long" | "short");
    await new Promise((r) => setTimeout(r, 3000));
  }
  const after = await adapter.fetchPosition("ETH/USDT");
  console.log("after:", after.side, after.qty);
  await prisma.$disconnect();
  process.exit(0);
}
main().catch((e) => { console.error(e.message); process.exit(1); });
