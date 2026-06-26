-- AlterTable
ALTER TABLE "BotRangeConfig" ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'CREATED',
ADD COLUMN     "userId" TEXT;

-- AlterTable
ALTER TABLE "BotSession" ADD COLUMN     "configSnapshot" JSONB,
ADD COLUMN     "finalPnl" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "StateSnapshot" ADD COLUMN     "position" JSONB;

-- AddForeignKey
ALTER TABLE "BotRangeConfig" ADD CONSTRAINT "BotRangeConfig_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
