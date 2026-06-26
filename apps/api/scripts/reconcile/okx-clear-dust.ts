/** 一次性清掉 OKX 残仓（机器人已 STOPPED，无对账窗口污染）。 */
import { PrismaClient } from "@prisma/client";
import { OkxAdapter } from "../../src/modules/exchange/adapters/okx/okx.adapter";
import { CredentialCrypto } from "../../src/modules/credential/credential-crypto";
async function main() {
  const prisma = new PrismaClient();
  const account = await prisma.exchangeAccount.findFirst({ where: { exchangeId: "okx" } });
  const crypto = new CredentialCrypto(process.env.ENCRYPTION_KEY ?? "");
  const adapter = new OkxAdapter({
    apiKey: crypto.decrypt(account!.apiKey),
    apiSecret: crypto.decrypt(account!.apiSecret),
    passphrase: account!.passphrase ? crypto.decrypt(account!.passphrase) : "",
    accountId: account!.accountId,
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
