-- CreateTable
CREATE TABLE "AiSettings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "provider" TEXT NOT NULL DEFAULT 'anthropic',
    "anthropicApiKey" TEXT,
    "anthropicModel" TEXT,
    "openaiApiKey" TEXT,
    "openaiModel" TEXT,
    "openaiBaseUrl" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiSettings_pkey" PRIMARY KEY ("id")
);
