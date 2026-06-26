/*
  Warnings:

  - You are about to drop the `BotRangeConfig` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `BotSession` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ExchangeCredential` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `GridRobot` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `TradeFill` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `TradeOrder` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "BotRangeConfig" DROP CONSTRAINT "BotRangeConfig_credentialId_fkey";

-- DropForeignKey
ALTER TABLE "BotRangeConfig" DROP CONSTRAINT "BotRangeConfig_robotId_fkey";

-- DropForeignKey
ALTER TABLE "BotRangeConfig" DROP CONSTRAINT "BotRangeConfig_userId_fkey";

-- DropForeignKey
ALTER TABLE "BotSession" DROP CONSTRAINT "BotSession_configId_fkey";

-- DropForeignKey
ALTER TABLE "GridRobot" DROP CONSTRAINT "GridRobot_credentialId_fkey";

-- DropForeignKey
ALTER TABLE "StateSnapshot" DROP CONSTRAINT "StateSnapshot_configId_fkey";

-- DropForeignKey
ALTER TABLE "TradeFill" DROP CONSTRAINT "TradeFill_tradeOrderId_fkey";

-- DropForeignKey
ALTER TABLE "TradeOrder" DROP CONSTRAINT "TradeOrder_sessionId_fkey";

-- DropTable
DROP TABLE "BotRangeConfig";

-- DropTable
DROP TABLE "BotSession";

-- DropTable
DROP TABLE "ExchangeCredential";

-- DropTable
DROP TABLE "GridRobot";

-- DropTable
DROP TABLE "TradeFill";

-- DropTable
DROP TABLE "TradeOrder";

-- CreateTable
CREATE TABLE "ExchangeAccount" (
    "id" TEXT NOT NULL,
    "exchangeId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "apiKey" TEXT NOT NULL,
    "apiSecret" TEXT NOT NULL,
    "passphrase" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "exchangeUid" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExchangeAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Robot" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "exchangeUid" TEXT,
    "symbol" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PAUSED',
    "activeBoxId" TEXT,
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Robot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Box" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "accountId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CREATED',
    "symbol" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "boxTop" DOUBLE PRECISION NOT NULL,
    "mainGridCount" INTEGER NOT NULL,
    "mainGridStep" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "mainGridPortionSize" DOUBLE PRECISION NOT NULL,
    "leverage" INTEGER NOT NULL,
    "stopLossGridCount" INTEGER NOT NULL DEFAULT 4,
    "stopLossGridStep" DOUBLE PRECISION NOT NULL,
    "activationPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "trailingCallbackRate" DOUBLE PRECISION NOT NULL DEFAULT 0.002,
    "excessProfitMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 2.0,
    "reorderThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0.0002,
    "gtcBoundary" DOUBLE PRECISION NOT NULL DEFAULT 0.02,
    "trailingEntry" BOOLEAN NOT NULL DEFAULT false,
    "trailDistance" DOUBLE PRECISION,
    "entryPrice" DOUBLE PRECISION,
    "aiConfig" JSONB,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "robotId" TEXT,

    CONSTRAINT "Box_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Run" (
    "id" TEXT NOT NULL,
    "boxId" TEXT NOT NULL,
    "runCode" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "exitReason" TEXT,
    "configSnapshot" JSONB,
    "realizedPnl" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalFees" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalSavings" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "fillCount" INTEGER NOT NULL DEFAULT 0,
    "pnlSignedPosition" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "pnlAvgCost" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "Run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "exchangeOrderId" TEXT,
    "algoOrderId" TEXT,
    "clientOrderId" TEXT,
    "orderType" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "qty" DOUBLE PRECISION NOT NULL,
    "price" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "filledQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgFillPrice" DOUBLE PRECISION,
    "gridIndex" INTEGER,
    "subGridIndex" INTEGER,
    "isAlgo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "filledAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "rejectedReason" TEXT,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Fill" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "exchangeFillId" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "qty" DOUBLE PRECISION NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "fee" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "feeAsset" TEXT,
    "gridIndex" INTEGER,
    "savings" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "savingsRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "realizedPnlDelta" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "filledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Fill_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExchangeAccount_exchangeId_accountId_key" ON "ExchangeAccount"("exchangeId", "accountId");

-- CreateIndex
CREATE INDEX "Robot_accountId_idx" ON "Robot"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "Run_runCode_key" ON "Run"("runCode");

-- CreateIndex
CREATE INDEX "Run_boxId_idx" ON "Run"("boxId");

-- CreateIndex
CREATE INDEX "Order_runId_status_idx" ON "Order"("runId", "status");

-- CreateIndex
CREATE INDEX "Order_clientOrderId_idx" ON "Order"("clientOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_runId_clientOrderId_key" ON "Order"("runId", "clientOrderId");

-- CreateIndex
CREATE INDEX "Fill_runId_idx" ON "Fill"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "Fill_exchangeFillId_orderId_key" ON "Fill"("exchangeFillId", "orderId");

-- AddForeignKey
ALTER TABLE "Robot" ADD CONSTRAINT "Robot_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "ExchangeAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Box" ADD CONSTRAINT "Box_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Box" ADD CONSTRAINT "Box_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "ExchangeAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Box" ADD CONSTRAINT "Box_robotId_fkey" FOREIGN KEY ("robotId") REFERENCES "Robot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Run" ADD CONSTRAINT "Run_boxId_fkey" FOREIGN KEY ("boxId") REFERENCES "Box"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fill" ADD CONSTRAINT "Fill_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StateSnapshot" ADD CONSTRAINT "StateSnapshot_configId_fkey" FOREIGN KEY ("configId") REFERENCES "Box"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
