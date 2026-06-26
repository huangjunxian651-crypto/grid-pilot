-- Partial unique index: one active runner per (exchangeUid, symbol).
-- Active = endedAt IS NULL. Prisma 5 cannot declare partial indexes, so it lives in SQL only.
CREATE UNIQUE INDEX "Robot_active_unique"
ON "Robot" ("exchangeUid", "symbol")
WHERE "endedAt" IS NULL;
