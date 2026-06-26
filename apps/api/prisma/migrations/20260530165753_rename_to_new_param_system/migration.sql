-- 1. Derive mainGridStep from existing params (only for rows where mainGridStep=0)
UPDATE "BotRangeConfig"
SET "mainGridStep" = (
  "boxHighPrice"
  - ("boxLowPrice" + "stopLossSubGridCount" * "stopLossSubGridStep" + "isolationGridStep")
) / "gridCount"
WHERE "mainGridStep" = 0 AND "gridCount" > 0;

-- 2. Rename columns (preserves data)
ALTER TABLE "BotRangeConfig" RENAME COLUMN "boxHighPrice" TO "boxTop";
ALTER TABLE "BotRangeConfig" RENAME COLUMN "gridCount" TO "mainGridCount";
ALTER TABLE "BotRangeConfig" RENAME COLUMN "orderSize" TO "mainGridPortionSize";
ALTER TABLE "BotRangeConfig" RENAME COLUMN "stopLossSubGridCount" TO "stopLossGridCount";
ALTER TABLE "BotRangeConfig" RENAME COLUMN "stopLossSubGridStep" TO "stopLossGridStep";
ALTER TABLE "BotRangeConfig" RENAME COLUMN "isolationGridStep" TO "isolationStep";

-- 3. Drop boxLowPrice (no longer needed — derived from boxTop, mainGridStep, etc.)
ALTER TABLE "BotRangeConfig" DROP COLUMN "boxLowPrice";
