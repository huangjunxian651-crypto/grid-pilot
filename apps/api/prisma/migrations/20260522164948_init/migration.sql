-- CreateTable
CREATE TABLE "ExchangeCredential" (
    "id" TEXT NOT NULL,
    "exchangeId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "apiKey" TEXT NOT NULL,
    "apiSecret" TEXT NOT NULL,
    "passphrase" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExchangeCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BotRangeConfig" (
    "id" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "boxLowPrice" DOUBLE PRECISION NOT NULL,
    "boxHighPrice" DOUBLE PRECISION NOT NULL,
    "gridCount" INTEGER NOT NULL,
    "orderSize" DOUBLE PRECISION NOT NULL,
    "leverage" INTEGER NOT NULL,
    "stopLossSubGridCount" INTEGER NOT NULL DEFAULT 4,
    "stopLossSubGridStep" DOUBLE PRECISION NOT NULL,
    "isolationGridStep" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "activationPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "trailingCallbackRate" DOUBLE PRECISION NOT NULL DEFAULT 0.002,
    "excessProfitMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 2.0,
    "reorderThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0.0002,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BotRangeConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BotSession" (
    "id" TEXT NOT NULL,
    "configId" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "exitReason" TEXT,

    CONSTRAINT "BotSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeOrder" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "exchangeOrderId" TEXT NOT NULL,
    "algoOrderId" TEXT,
    "clientOrderId" TEXT,
    "orderType" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "qty" DOUBLE PRECISION NOT NULL,
    "price" DOUBLE PRECISION,
    "avgFillPrice" DOUBLE PRECISION,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "filledAt" TIMESTAMP(3),

    CONSTRAINT "TradeOrder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExchangeCredential_exchangeId_accountId_key" ON "ExchangeCredential"("exchangeId", "accountId");

-- CreateIndex
CREATE INDEX "TradeOrder_sessionId_orderType_idx" ON "TradeOrder"("sessionId", "orderType");

-- CreateIndex
CREATE INDEX "TradeOrder_clientOrderId_idx" ON "TradeOrder"("clientOrderId");

-- AddForeignKey
ALTER TABLE "BotRangeConfig" ADD CONSTRAINT "BotRangeConfig_credentialId_fkey" FOREIGN KEY ("credentialId") REFERENCES "ExchangeCredential"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BotSession" ADD CONSTRAINT "BotSession_configId_fkey" FOREIGN KEY ("configId") REFERENCES "BotRangeConfig"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeOrder" ADD CONSTRAINT "TradeOrder_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "BotSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
