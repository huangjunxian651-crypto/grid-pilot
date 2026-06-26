import { Controller, Get, Post, Put, Query, Param, Body, NotFoundException } from "@nestjs/common";
import { AiSettingsService, type AiSettingsUpdate } from "./ai-settings.service";
import { AiJobService } from "./ai-job.service";
import { RecommendationComputeService } from "./recommendation-compute.service";
import { AiRecommendationService } from "./ai-recommendation.service";

@Controller("ai")
export class AiController {
  constructor(
    private readonly settings: AiSettingsService,
    private readonly jobs: AiJobService,
    private readonly compute: RecommendationComputeService,
    private readonly recommendations: AiRecommendationService,
  ) {}

  @Get("settings")
  getSettings() {
    return this.settings.getMasked();
  }

  @Put("settings")
  updateSettings(@Body() body: AiSettingsUpdate) {
    return this.settings.upsert(body);
  }

  /** 每个交易对最近一次后台分析结果（AI 推荐页打开即展示）。 */
  @Get("recommendations/latest")
  latestRecommendations(@Query("language") language = "zh") {
    return this.recommendations.getLatest(language);
  }

  /** 同步生成（小/快模型适用；慢推理模型请用下面的异步任务避免代理超时）。language 指定 label/rationale 生成语种。 */
  @Get("grid-recommendations")
  gridRecommendations(@Query("symbol") symbol = "ETH/USDT", @Query("direction") direction = "LONG", @Query("language") language = "zh") {
    return this.compute.compute(symbol, direction, language);
  }

  /** 异步生成：立即返回 jobId，后台跑 LLM；前端轮询 GET jobs/:id 取结果。对慢模型/任意代理都健壮。 */
  @Post("grid-recommendations/jobs")
  startJob(@Query("symbol") symbol = "ETH/USDT", @Query("direction") direction = "LONG", @Query("language") language = "zh") {
    const jobId = this.jobs.run(() => this.compute.compute(symbol, direction, language));
    return { jobId, status: "pending" as const };
  }

  @Get("grid-recommendations/jobs/:id")
  getJob(@Param("id") id: string) {
    const job = this.jobs.get(id);
    if (!job) throw new NotFoundException({ code: "AI_JOB_NOT_FOUND", message: `Job ${id} not found` });
    if (job.status === "error") return { status: "error" as const, errorCode: job.errorCode };
    return { status: job.status, result: job.status === "done" ? job.result : undefined };
  }
}
