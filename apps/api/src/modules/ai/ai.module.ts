import { Module } from "@nestjs/common";
import { AiController } from "./ai.controller";
import { BinanceMarketService } from "./binance-market.service";
import { GridAdvisorService } from "./grid-advisor.service";
import { AiSettingsService } from "./ai-settings.service";
import { AiJobService } from "./ai-job.service";
import { RecommendationComputeService } from "./recommendation-compute.service";
import { AiRecommendationService } from "./ai-recommendation.service";
import { AnthropicProvider } from "./providers/anthropic.provider";
import { OpenAiProvider } from "./providers/openai.provider";

@Module({
  controllers: [AiController],
  providers: [BinanceMarketService, GridAdvisorService, AiSettingsService, AiJobService, RecommendationComputeService, AiRecommendationService, AnthropicProvider, OpenAiProvider],
})
export class AiModule {}
