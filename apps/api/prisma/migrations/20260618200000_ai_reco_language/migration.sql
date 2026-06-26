-- AiRecommendation 缓存键加 language（按用户语言生成/缓存推荐内容）。
-- 旧行 language 默认 'zh'；唯一键由 (symbol,direction) 改为 (symbol,direction,language)。
ALTER TABLE "AiRecommendation" ADD COLUMN "language" TEXT NOT NULL DEFAULT 'zh';
DROP INDEX IF EXISTS "AiRecommendation_symbol_direction_key";
CREATE UNIQUE INDEX "AiRecommendation_symbol_direction_language_key" ON "AiRecommendation"("symbol", "direction", "language");
