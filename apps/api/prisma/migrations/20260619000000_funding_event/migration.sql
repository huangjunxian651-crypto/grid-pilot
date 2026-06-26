-- AlterTable: add totalFunding column to Run
ALTER TABLE "Run" ADD COLUMN "totalFunding" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- CreateTable: FundingEvent
CREATE TABLE "FundingEvent" (
    "id" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "fundingTime" TIMESTAMP(3) NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "attributedRunId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FundingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: unique constraint on credentialId, symbol, fundingTime
CREATE UNIQUE INDEX "FundingEvent_credentialId_symbol_fundingTime_key" ON "FundingEvent"("credentialId", "symbol", "fundingTime");

-- CreateIndex: index on credentialId, fundingTime
CREATE INDEX "FundingEvent_credentialId_fundingTime_idx" ON "FundingEvent"("credentialId", "fundingTime");

-- CreateIndex: index on attributedRunId
CREATE INDEX "FundingEvent_attributedRunId_idx" ON "FundingEvent"("attributedRunId");
