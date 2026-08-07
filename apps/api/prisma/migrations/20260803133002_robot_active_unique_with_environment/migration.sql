-- AlterTable
ALTER TABLE "Robot" ADD COLUMN     "environment" TEXT NOT NULL DEFAULT 'demo';

-- 存量 Robot 行按其账户当前 environment 回填（多数会等于 'demo'，但不能想当然假设——
-- 用真实 join 取值而非全量硬编码 'demo'，防止 Task 1 之后、本迁移之前创建的 live 凭证下的
-- 存量机器人被错误回填成 demo）。
UPDATE "Robot" r
SET "environment" = a."environment"
FROM "ExchangeAccount" a
WHERE r."accountId" = a."id";

-- 重建偏唯一索引，补上 environment 维度。
DROP INDEX "Robot_active_unique";
CREATE UNIQUE INDEX "Robot_active_unique"
ON "Robot" ("exchangeUid", "environment", "symbol")
WHERE "endedAt" IS NULL;
