-- AlterTable
ALTER TABLE "BotRangeConfig" ADD COLUMN     "aiConfig" JSONB,
ADD COLUMN     "entryPrice" DOUBLE PRECISION,
ADD COLUMN     "gtcBoundary" DOUBLE PRECISION NOT NULL DEFAULT 0.02,
ADD COLUMN     "trailDistance" DOUBLE PRECISION,
ADD COLUMN     "trailingEntry" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "TradeOrder" ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "gridIndex" INTEGER,
ADD COLUMN     "isAlgo" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "rejectedReason" TEXT,
ADD COLUMN     "subGridIndex" INTEGER;

-- CreateTable
CREATE TABLE "TradeFill" (
    "id" TEXT NOT NULL,
    "tradeOrderId" TEXT NOT NULL,
    "fillId" TEXT,
    "qty" DOUBLE PRECISION NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "commission" DOUBLE PRECISION,
    "commissionAsset" TEXT,
    "filledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TradeFill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StateSnapshot" (
    "id" TEXT NOT NULL,
    "configId" TEXT NOT NULL,
    "fsmState" JSONB NOT NULL,
    "orderManager" JSONB,
    "sentinel" JSONB,
    "seq" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StateSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventLog" (
    "id" TEXT NOT NULL,
    "configId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "eventData" JSONB NOT NULL,
    "seq" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketData" (
    "id" TEXT NOT NULL,
    "exchange" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "open" DOUBLE PRECISION NOT NULL,
    "high" DOUBLE PRECISION NOT NULL,
    "low" DOUBLE PRECISION NOT NULL,
    "close" DOUBLE PRECISION NOT NULL,
    "volume" DOUBLE PRECISION NOT NULL,
    "bestBid" DOUBLE PRECISION,
    "bestAsk" DOUBLE PRECISION,

    CONSTRAINT "MarketData_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TradeFill_tradeOrderId_idx" ON "TradeFill"("tradeOrderId");

-- CreateIndex
CREATE INDEX "StateSnapshot_configId_createdAt_idx" ON "StateSnapshot"("configId", "createdAt");

-- CreateIndex
CREATE INDEX "EventLog_configId_seq_idx" ON "EventLog"("configId", "seq");

-- CreateIndex
CREATE INDEX "EventLog_configId_createdAt_idx" ON "EventLog"("configId", "createdAt");

-- CreateIndex
CREATE INDEX "MarketData_exchange_symbol_timestamp_idx" ON "MarketData"("exchange", "symbol", "timestamp");

-- AddForeignKey
ALTER TABLE "TradeFill" ADD CONSTRAINT "TradeFill_tradeOrderId_fkey" FOREIGN KEY ("tradeOrderId") REFERENCES "TradeOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StateSnapshot" ADD CONSTRAINT "StateSnapshot_configId_fkey" FOREIGN KEY ("configId") REFERENCES "BotRangeConfig"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
