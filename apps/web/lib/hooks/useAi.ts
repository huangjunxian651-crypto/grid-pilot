import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { aiApi, aiSettingsApi, ApiError, type GridRecommendationsResponse, type LatestRecommendation, type AiSettingsMasked, type AiSettingsUpdate } from "@/lib/api";
import { useLang } from "@/lib/i18n-context";

/**
 * 轮询异步生成任务直到完成。每次查询都是很短的请求，避免慢推理模型（可达 1–2 分钟）
 * 把单次长请求挂死被代理/浏览器超时 reset。失败时抛带 code 的 ApiError 供前端 i18n。
 */
async function pollRecommendationJob(jobId: string): Promise<GridRecommendationsResponse> {
  // 最多约 5 分钟（120 × 2.5s），覆盖慢推理模型
  for (let i = 0; i < 120; i++) {
    const s = await aiApi.jobStatus(jobId);
    if (s.status === "done" && s.result) return s.result;
    if (s.status === "error") {
      const code = s.errorCode || "AI_LLM_FAILED";
      throw new ApiError(400, code, code);
    }
    await new Promise((r) => setTimeout(r, 2500));
  }
  throw new ApiError(408, "AI_LLM_FAILED", "AI_LLM_FAILED");
}

/** 按需触发：创建异步任务并轮询结果（慢推理模型也不会被代理/浏览器超时）。按当前 UI 语言生成。 */
export function useGridRecommendations() {
  const { lang } = useLang();
  return useMutation<GridRecommendationsResponse, Error, { symbol: string; direction: string }>({
    mutationFn: async ({ symbol, direction }) => {
      const { jobId } = await aiApi.startJob(symbol, direction, lang);
      return pollRecommendationJob(jobId);
    },
  });
}

/** 读取每个交易对最近一次后台分析结果（打开 AI 推荐页即展示）。按当前 UI 语言取（无缓存回退 zh）。 */
export function useLatestRecommendations() {
  const { lang } = useLang();
  return useQuery<LatestRecommendation[]>({
    queryKey: ["ai-latest-recommendations", lang],
    queryFn: () => aiApi.latestRecommendations(lang),
  });
}

/** 读取脱敏 AI 配置（provider/模型/是否已配密钥）。 */
export function useAiSettings() {
  return useQuery<AiSettingsMasked>({ queryKey: ["ai-settings"], queryFn: aiSettingsApi.get });
}

/** 写 AI 配置（空密钥保留原值）。 */
export function useUpdateAiSettings() {
  const qc = useQueryClient();
  return useMutation<AiSettingsMasked, Error, AiSettingsUpdate>({
    mutationFn: aiSettingsApi.update,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ai-settings"] }),
  });
}
