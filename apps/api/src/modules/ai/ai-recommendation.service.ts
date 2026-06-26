import { Injectable, Logger, type OnModuleInit, type OnModuleDestroy } from "@nestjs/common";
import { RECOMMENDED_SYMBOLS } from "@gridpilot/shared-types";
import { PrismaService } from "../../prisma/prisma.service";
import { AiSettingsService } from "./ai-settings.service";
import { RecommendationComputeService } from "./recommendation-compute.service";

const DIRECTIONS = ["LONG", "SHORT"] as const;
/** 后台定期分析间隔：6 小时（日线级策略，足够新鲜且 LLM 成本可控）。 */
const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * 「每个交易对最近一次 AI 箱体分析结果」的存储 + 后台定期分析。
 * 定时对 RECOMMENDED_SYMBOLS × {LONG,SHORT} 跑分析并 upsert 单行（symbol+direction 唯一）；
 * 前端 AI 推荐页打开即读 getLatest 展示。未配置 LLM 时整轮跳过（不报错）。
 *
 * 注意：定时器**假定单实例部署**（与现有 setInterval 轮询服务一致）。若将来水平扩展为多实例，
 * 各进程会各自起 timer 并对同一唯一行并发 upsert、重复消耗 LLM 配额，届时需引入 leader 选举
 * 或分布式锁（advisory lock）只让一个实例跑定时分析。
 */
@Injectable()
export class AiRecommendationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AiRecommendationService.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: AiSettingsService,
    private readonly compute: RecommendationComputeService,
  ) {}

  onModuleInit() {
    // 启动时仅在数据陈旧/为空时补一轮（异步，不阻塞启动），避免 dev 频繁热重载每次重跑 LLM；
    // 之后每 6 小时一轮。测试不调用本钩子，故不会起定时器。
    void this.refreshIfStale().catch((e) => this.logger.error(`initial refresh failed: ${(e as Error).message}`));
    this.timer = setInterval(() => {
      void this.refreshAll().catch((e) => this.logger.error(`scheduled refresh failed: ${(e as Error).message}`));
    }, REFRESH_INTERVAL_MS);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** LLM 是否已配置（按当前 provider 判断对应 key）。 */
  private async isConfigured(): Promise<boolean> {
    const masked = await this.settings.getMasked();
    return masked.provider === "openai" ? masked.hasOpenaiKey : masked.hasAnthropicKey;
  }

  /** 全部推荐交易对×双向的组合。 */
  private allCombos(): { symbol: string; direction: string }[] {
    return RECOMMENDED_SYMBOLS.flatMap(({ symbol }) => DIRECTIONS.map((direction) => ({ symbol, direction })));
  }

  /** 对给定组合逐个分析并 upsert。后台预热固定默认语言 zh（其余语种由用户触发即时生成）。
   *  单个失败不影响其余（记 warn 继续）。 */
  private async refreshCombos(combos: { symbol: string; direction: string }[]): Promise<void> {
    const language = "zh";
    for (const { symbol, direction } of combos) {
      try {
        const result = await this.compute.compute(symbol, direction, language);
        await this.prisma.aiRecommendation.upsert({
          where: { symbol_direction_language: { symbol, direction, language } },
          create: { symbol, direction, language, result: result as object },
          update: { result: result as object },
        });
      } catch (e) {
        this.logger.warn(`refresh ${symbol} ${direction} failed: ${(e as Error).message}`);
      }
    }
  }

  /** 定时全量刷新：对全部组合各分析一次；未配置则整轮跳过。 */
  async refreshAll(): Promise<void> {
    if (!(await this.isConfigured())) {
      this.logger.log("AI not configured, skip scheduled recommendation refresh");
      return;
    }
    await this.refreshCombos(this.allCombos());
  }

  /** 启动补偿：只补「缺失或已超过刷新间隔（陈旧）」的组合，已新鲜的跳过。
   *  这样中途重启打断首轮后，重启即补齐剩余组合，而非等下一个 6h 周期；全新鲜则整体跳过。 */
  async refreshIfStale(): Promise<void> {
    if (!(await this.isConfigured())) {
      this.logger.log("AI not configured, skip startup recommendation refresh");
      return;
    }
    const rows = await this.prisma.aiRecommendation.findMany({ where: { language: "zh" }, select: { symbol: true, direction: true, updatedAt: true } });
    const fresh = new Set(
      rows
        .filter((r) => Date.now() - new Date(r.updatedAt).getTime() < REFRESH_INTERVAL_MS)
        .map((r) => `${r.symbol}|${r.direction}`),
    );
    const due = this.allCombos().filter((c) => !fresh.has(`${c.symbol}|${c.direction}`));
    if (due.length === 0) return;
    this.logger.log(`startup refresh: ${due.length} stale/missing recommendation combos`);
    await this.refreshCombos(due);
  }

  /** 读取所有交易对最近一次分析结果（含完整 result，供前端展示）。
   *  按 language 取；缺失的 (symbol,direction) 用 zh **逐组合回退**补齐——避免非 zh 用户
   *  生成过个别组合后，其余未生成语种的交易对从页面消失（仅后台 zh 预热全集）。 */
  async getLatest(language = "zh") {
    const rows = await this.prisma.aiRecommendation.findMany({ where: { language }, orderBy: { symbol: "asc" } });
    let merged = rows;
    if (language !== "zh") {
      const zhRows = await this.prisma.aiRecommendation.findMany({ where: { language: "zh" }, orderBy: { symbol: "asc" } });
      const have = new Set(rows.map((r) => `${r.symbol}|${r.direction}`));
      merged = [...rows, ...zhRows.filter((r) => !have.has(`${r.symbol}|${r.direction}`))]
        .sort((a, b) => a.symbol.localeCompare(b.symbol));
    }
    // 先展开 result，再用权威列覆盖：result 内也带 symbol/direction，必须以 DB 唯一键列为准，
    // 避免 compute 归一化差异导致展示值与唯一键不一致。
    return merged.map((r) => ({
      ...(r.result as Record<string, unknown>),
      symbol: r.symbol,
      direction: r.direction,
      updatedAt: r.updatedAt,
    }));
  }
}
