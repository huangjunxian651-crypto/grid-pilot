import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { TestProviders } from "../../test-utils";
import type { MetricsWindow, StrategySeriesResponse } from "@/lib/api";

const strategySeriesMock = vi.fn();
vi.mock("@/lib/api", () => ({
  evaluationApi: {
    strategyMetrics: vi.fn(),
    strategySeries: (...args: unknown[]) => strategySeriesMock(...args),
  },
}));

import { useStrategySeries } from "../useEvaluation";

function seriesOf(window: MetricsWindow): StrategySeriesResponse {
  return { robotId: "r1", window, bucketMs: 60_000, points: [] };
}

describe("useStrategySeries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("切换窗口期间保留上一窗口数据（placeholderData，不闪空）", async () => {
    let resolve7d: (v: StrategySeriesResponse) => void = () => {};
    strategySeriesMock.mockImplementation((_id: string, w: MetricsWindow) =>
      w === "24h"
        ? Promise.resolve(seriesOf("24h"))
        : new Promise<StrategySeriesResponse>((res) => {
            resolve7d = res;
          }),
    );

    const { result, rerender } = renderHook(
      ({ w }: { w: MetricsWindow }) => useStrategySeries("r1", w),
      { wrapper: TestProviders, initialProps: { w: "24h" as MetricsWindow } },
    );

    await waitFor(() => expect(result.current.data?.window).toBe("24h"));

    // 切窗后新查询未完成前，仍展示 24h 数据而不是 undefined
    rerender({ w: "7d" });
    expect(result.current.data?.window).toBe("24h");

    // 新窗口数据到达后正常替换
    resolve7d(seriesOf("7d"));
    await waitFor(() => expect(result.current.data?.window).toBe("7d"));
  });

  it("robotId 为 null 时不发起查询", () => {
    const { result } = renderHook(() => useStrategySeries(null, "24h"), {
      wrapper: TestProviders,
    });
    expect(result.current.data).toBeUndefined();
    expect(strategySeriesMock).not.toHaveBeenCalled();
  });
});
