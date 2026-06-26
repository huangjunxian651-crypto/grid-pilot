-- AlterTable: 支持为 Anthropic provider 配置自定义/兼容端点 baseURL（与 openaiBaseUrl 对称）
ALTER TABLE "AiSettings" ADD COLUMN "anthropicBaseUrl" TEXT;
