-- AlterTable
ALTER TABLE "BotRangeConfig" ADD COLUMN     "robotId" TEXT;

-- AlterTable
ALTER TABLE "ExchangeCredential" ADD COLUMN     "exchangeAccountId" TEXT;

-- CreateTable
CREATE TABLE "GridRobot" (
    "id" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "exchangeAccountId" TEXT,
    "symbol" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PAUSED',
    "activeBotRangeConfigId" TEXT,
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GridRobot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GridRobot_credentialId_idx" ON "GridRobot"("credentialId");

-- AddForeignKey
ALTER TABLE "GridRobot" ADD CONSTRAINT "GridRobot_credentialId_fkey" FOREIGN KEY ("credentialId") REFERENCES "ExchangeCredential"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BotRangeConfig" ADD CONSTRAINT "BotRangeConfig_robotId_fkey" FOREIGN KEY ("robotId") REFERENCES "GridRobot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 活跃机器人唯一：同一真实账户+交易对，未结束的机器人最多一个。
-- 必须用 partial index：Postgres 默认 NULL != NULL，普通 @@unique 含 NULL 时挡不住重复。
-- exchangeAccountId 为 NULL 时（Phase 1-A 回填的机器人）多行 (symbol, NULL) 互不冲突，
-- 待 Phase 1-B 填入真实 UID 后约束才真正生效。
CREATE UNIQUE INDEX "GridRobot_active_unique"
  ON "GridRobot" (symbol, "exchangeAccountId")
  WHERE "endedAt" IS NULL;
