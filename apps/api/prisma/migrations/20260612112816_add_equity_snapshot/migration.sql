-- CreateTable
CREATE TABLE "EquitySnapshot" (
    "id" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "totalEquity" DOUBLE PRECISION NOT NULL,
    "totalWalletBalance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "availableUsdt" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EquitySnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EquitySnapshot_credentialId_capturedAt_idx" ON "EquitySnapshot"("credentialId", "capturedAt");

-- CreateIndex
CREATE INDEX "EquitySnapshot_capturedAt_idx" ON "EquitySnapshot"("capturedAt");
