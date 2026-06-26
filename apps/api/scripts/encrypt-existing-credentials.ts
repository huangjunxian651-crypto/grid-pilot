#!/usr/bin/env tsx
/**
 * One-time migration: encrypt plaintext credentials in ExchangeCredential.
 * Idempotent — skips rows whose apiKey is already a v1: ciphertext.
 *
 * Requires ENCRYPTION_KEY to be set (the same key the app uses). Run from apps/api:
 *   npx tsx scripts/encrypt-existing-credentials.ts [--dry-run]
 */
import { PrismaClient } from "@prisma/client";
import { CredentialCrypto } from "../src/modules/credential/credential-crypto";

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const crypto = new CredentialCrypto(process.env.ENCRYPTION_KEY ?? "");
  const prisma = new PrismaClient();
  const rows = await prisma.exchangeCredential.findMany();
  let migrated = 0;
  let skipped = 0;
  for (const r of rows) {
    if (crypto.isEncrypted(r.apiKey)) {
      skipped++;
      continue;
    }
    const data = {
      apiKey: crypto.encrypt(r.apiKey),
      apiSecret: crypto.encrypt(r.apiSecret),
      ...(r.passphrase ? { passphrase: crypto.encrypt(r.passphrase) } : {}),
    };
    console.log(`[migrate] ${r.exchangeId}/${r.accountId} ${dryRun ? "(dry-run)" : ""}`);
    if (!dryRun) {
      await prisma.exchangeCredential.update({ where: { id: r.id }, data });
    }
    migrated++;
  }
  console.log(
    `Done. migrated=${migrated} skipped(already-encrypted)=${skipped} total=${rows.length}`,
  );
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
