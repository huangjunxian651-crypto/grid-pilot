#!/usr/bin/env ts-node
/**
 * GridPilot List Users Script
 *
 * Lists all users in the system.
 *
 * Usage:
 *   npx ts-node scripts/list-users.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      email: true,
      displayName: true,
      language: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (users.length === 0) {
    console.log("No users found in the system.");
    process.exit(0);
  }

  console.log(`Found ${users.length} user(s):\n`);
  users.forEach((user, idx) => {
    console.log(`  [${idx + 1}] ${user.email}`);
    console.log(`      ID:            ${user.id}`);
    console.log(`      Display Name:  ${user.displayName || "(empty)"}`);
    console.log(`      Language:      ${user.language || "(empty)"}`);
    console.log(`      Created:       ${user.createdAt.toISOString()}`);
    console.log(`      Updated:       ${user.updatedAt.toISOString()}`);
  });

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("Error:", err.message);
  await prisma.$disconnect();
  process.exit(1);
});
