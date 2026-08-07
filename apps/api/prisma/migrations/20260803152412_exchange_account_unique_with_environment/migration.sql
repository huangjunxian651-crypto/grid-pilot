/*
  Warnings:

  - A unique constraint covering the columns `[exchangeId,accountId,environment]` on the table `ExchangeAccount` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "ExchangeAccount_exchangeId_accountId_key";

-- CreateIndex
CREATE UNIQUE INDEX "ExchangeAccount_exchangeId_accountId_environment_key" ON "ExchangeAccount"("exchangeId", "accountId", "environment");
