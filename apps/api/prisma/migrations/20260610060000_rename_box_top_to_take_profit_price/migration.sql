-- 字段改名：boxTop → takeProfitPrice（LONG 语义不变：原值即止盈线）
ALTER TABLE "Box" RENAME COLUMN "boxTop" TO "takeProfitPrice";

-- SHORT 存量配置语义不兼容（旧值=箱体最高价，新值=止盈端低价），直接作废
UPDATE "Box" SET "deletedAt" = now()
WHERE "direction" = 'SHORT' AND "deletedAt" IS NULL;
