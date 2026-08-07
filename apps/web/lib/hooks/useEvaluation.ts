import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  evaluationApi,
  type MetricsWindow,
  type StrategyMetricsResponse,
  type StrategySeriesResponse,
} from "@/lib/api";

export function useStrategyMetrics(window: MetricsWindow) {
  return useQuery<StrategyMetricsResponse>({
    queryKey: ["strategy-metrics", window],
    queryFn: () => evaluationApi.strategyMetrics(window),
    refetchInterval: 30_000,
    // 切窗期间保留上一批数据，KPI 卡与对比表不闪空（与 useStrategySeries 一致）
    placeholderData: keepPreviousData,
  });
}

export function useStrategySeries(robotId: string | null, window: MetricsWindow) {
  return useQuery<StrategySeriesResponse>({
    queryKey: ["strategy-series", robotId, window],
    queryFn: () => evaluationApi.strategySeries(robotId as string, window),
    enabled: !!robotId,
    refetchInterval: 60_000,
    // 切窗/切机器人期间保留上一批数据，图表不闪空
    placeholderData: keepPreviousData,
  });
}
