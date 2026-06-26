/**
 * Credential verification using actual adapter classes.
 * This tests the real code paths that the bot will use.
 *
 * Usage:
 *   set -a && source .env.testnet && set +a
 *   npx ts-node src/modules/exchange/adapters/__integration-tests__/verify-adapters.ts
 */

import { BinanceAdapter } from "../binance/binance.adapter";
import { GateioAdapter } from "../gateio/gateio.adapter";
import { OkxAdapter } from "../okx/okx.adapter";

async function verifyBinance(): Promise<void> {
  console.log("\n=== BinanceAdapter (Demo) ===");
  const key = process.env.BINANCE_API_KEY;
  const secret = process.env.BINANCE_API_SECRET;
  if (!key || !secret) {
    console.log("  SKIP — credentials not set");
    return;
  }

  const adapter = new BinanceAdapter({ apiKey: key, apiSecret: secret, accountId: "verify" });
  try {
    const balance = await adapter.fetchBalance();
    console.log("  Auth: OK");
    console.log(`  Available: ${balance.usdt} USDT`);
    console.log(`  Total Equity: ${balance.totalEquity} USDT`);

    const info = await adapter.getMarketInfo("ETH/USDT");
    console.log(`  ETH/USDT contract size: ${info.contractSize}`);
    console.log(`  ETH/USDT tick size: ${info.tickSize}`);
    console.log(`  ETH/USDT min qty: ${info.minQty}`);
    console.log("  Status: PASS");
  } catch (err: any) {
    console.error("  Status: FAIL");
    console.error("  Error:", err.message);
  } finally {
    adapter.destroy();
  }
}

async function verifyGateio(): Promise<void> {
  console.log("\n=== GateioAdapter (Testnet) ===");
  const key = process.env.GATEIO_API_KEY;
  const secret = process.env.GATEIO_API_SECRET;
  if (!key || !secret) {
    console.log("  SKIP — credentials not set");
    return;
  }

  const adapter = new GateioAdapter({ apiKey: key, apiSecret: secret, accountId: "verify" });
  try {
    const balance = await adapter.fetchBalance();
    console.log("  Auth: OK");
    console.log(`  Available: ${balance.usdt} USDT`);
    console.log(`  Total Equity: ${balance.totalEquity} USDT`);

    const info = await adapter.getMarketInfo("ETH/USDT");
    console.log(`  ETH/USDT contract size: ${info.contractSize}`);
    console.log(`  ETH/USDT tick size: ${info.tickSize}`);
    console.log(`  ETH/USDT min qty: ${info.minQty}`);
    console.log("  Status: PASS");
  } catch (err: any) {
    console.error("  Status: FAIL");
    console.error("  Error:", err.message);
    if (err.message?.includes("permission") || err.message?.includes("read")) {
      console.error("  Hint: API key may be read-only; create a new key with trading permission");
    }
  } finally {
    adapter.destroy();
  }
}

async function verifyOkx(): Promise<void> {
  console.log("\n=== OkxAdapter (Simulated Trading) ===");
  const key = process.env.OKX_API_KEY;
  const secret = process.env.OKX_API_SECRET;
  const passphrase = process.env.OKX_PASSPHRASE;
  if (!key || !secret || !passphrase) {
    console.log("  SKIP — credentials not set");
    return;
  }

  const adapter = new OkxAdapter({ apiKey: key, apiSecret: secret, passphrase, accountId: "verify" });
  try {
    const balance = await adapter.fetchBalance();
    console.log("  Auth: OK");
    console.log(`  Available: ${balance.usdt} USDT`);
    console.log(`  Total Equity: ${balance.totalEquity} USDT`);

    const info = await adapter.getMarketInfo("ETH/USDT");
    console.log(`  ETH-USDT-SWAP contract size: ${info.contractSize}`);
    console.log(`  ETH-USDT-SWAP tick size: ${info.tickSize}`);
    console.log(`  ETH-USDT-SWAP min qty: ${info.minQty}`);
    console.log("  Status: PASS");
  } catch (err: any) {
    console.error("  Status: FAIL");
    console.error("  Error:", err.message);
  } finally {
    adapter.destroy();
  }
}

async function main(): Promise<void> {
  console.log("GridPilot Adapter Verification (Real API)");
  console.log("=========================================");

  await verifyBinance();
  await verifyGateio();
  await verifyOkx();

  console.log("\nDone.");
}

main().catch(console.error);
