/** 对比 OKX 原始 positions 接口与 adapter.fetchPosition 映射值（排查分数合约虚增）。 */
import { PrismaClient } from "@prisma/client";
import { OkxAdapter } from "../../src/modules/exchange/adapters/okx/okx.adapter";
import { CredentialCrypto } from "../../src/modules/credential/credential-crypto";

async function main() {
  const prisma = new PrismaClient();
  const account = await prisma.exchangeAccount.findFirst({ where: { exchangeId: "okx" } });
  if (!account) throw new Error("no okx account");
  const crypto = new CredentialCrypto(process.env.ENCRYPTION_KEY ?? "");
  const adapter = new OkxAdapter({
    apiKey: crypto.decrypt(account.apiKey),
    apiSecret: crypto.decrypt(account.apiSecret),
    passphrase: account.passphrase ? crypto.decrypt(account.passphrase) : "",
    accountId: account.accountId,
  });
  const mapped = await adapter.fetchPosition("ETH/USDT");
  console.log("mapped:", JSON.stringify(mapped));
  const raw = await (adapter as unknown as { request: (m: string, p: string, q?: unknown) => Promise<unknown> })
    .request("GET", "/api/v5/account/positions", { instId: "ETH-USDT-SWAP" })
    .catch((e: Error) => `request-helper-missing: ${e.message}`);
  console.log("raw:", JSON.stringify(raw).slice(0, 800));
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e.message); process.exit(1); });
