-- CreateTable
CREATE TABLE "RunBalanceSnapshot" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "totalEquity" DOUBLE PRECISION NOT NULL,
    "totalWalletBalance" DOUBLE PRECISION NOT NULL,
    "availableUsdt" DOUBLE PRECISION NOT NULL,
    "marginUsed" DOUBLE PRECISION NOT NULL,
    "symbol" TEXT NOT NULL,
    "positionQty" DOUBLE PRECISION NOT NULL,
    "entryPrice" DOUBLE PRECISION,
    "unrealizedPnl" DOUBLE PRECISION NOT NULL,
    "markPrice" DOUBLE PRECISION NOT NULL,
    "realizedPnl" DOUBLE PRECISION NOT NULL,
    "totalFees" DOUBLE PRECISION NOT NULL,
    "totalSavings" DOUBLE PRECISION NOT NULL,
    "credentialId" TEXT NOT NULL,
    "boxId" TEXT NOT NULL,
    "robotId" TEXT,
    "exitReason" TEXT,
    "liquidationOk" BOOLEAN,

    CONSTRAINT "RunBalanceSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RunBalanceSnapshot_runId_event_key" ON "RunBalanceSnapshot"("runId", "event");

-- CreateIndex
CREATE INDEX "RunBalanceSnapshot_credentialId_capturedAt_idx" ON "RunBalanceSnapshot"("credentialId", "capturedAt");

-- AddForeignKey
ALTER TABLE "RunBalanceSnapshot" ADD CONSTRAINT "RunBalanceSnapshot_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
