-- Box.gtcBoundary 从未被任何策略计算逻辑读取(全仓库排查确认，只在类型定义/赋值处出现，
-- 从未参与实际下单/定价决策)，是历史残留的死列，予以删除。
ALTER TABLE "Box" DROP COLUMN "gtcBoundary";
