-- AlterTable
ALTER TABLE "BotSession" ADD COLUMN "sessionCode" TEXT;

-- Backfill existing rows with unique sessionCode values
UPDATE "BotSession" SET "sessionCode" = 'SESSION_' || id WHERE "sessionCode" IS NULL;

-- AlterTable (set NOT NULL after backfill)
ALTER TABLE "BotSession" ALTER COLUMN "sessionCode" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "BotSession_sessionCode_key" ON "BotSession"("sessionCode");
