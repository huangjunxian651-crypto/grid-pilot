#!/usr/bin/env ts-node
/**
 * GridPilot Admin Account Reset Script
 *
 * Resets the single admin account's email and password.
 * Since this is a single-user system, no email lookup is needed.
 *
 * Usage:
 *   npx ts-node scripts/reset-account.ts <new-email> <new-password>
 *
 * Example:
 *   npx ts-node scripts/reset-account.ts admin@example.com NewPass123!
 */

import { PrismaClient } from "@prisma/client";
import * as bcrypt from "bcrypt";

const prisma = new PrismaClient();

async function main() {
  const [newEmail, newPassword] = process.argv.slice(2);

  if (!newEmail || !newPassword) {
    console.error("Usage: npx ts-node scripts/reset-account.ts <new-email> <new-password>");
    process.exit(1);
  }

  if (newPassword.length < 8) {
    console.error("Error: Password must be at least 8 characters");
    process.exit(1);
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(newEmail)) {
    console.error("Error: Please provide a valid email address");
    process.exit(1);
  }

  // Single-user system: find the one and only user
  const user = await prisma.user.findFirst();
  if (!user) {
    console.error("Error: No user found in the system. Register first via the web UI.");
    process.exit(1);
  }

  // Defensive: ensure new email is not already used by another account
  const existingByEmail = await prisma.user.findUnique({ where: { email: newEmail } });
  if (existingByEmail && existingByEmail.id !== user.id) {
    console.error(`Error: Email "${newEmail}" is already in use by another account.`);
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { email: newEmail, passwordHash },
    select: { email: true, updatedAt: true },
  });

  console.log(`Account reset successfully:`);
  console.log(`  Email:     ${updated.email}`);
  console.log(`  Updated:   ${updated.updatedAt.toISOString()}`);
  console.log(`  Password:  (updated)`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("Error:", err.message);
  await prisma.$disconnect();
  process.exit(1);
});
