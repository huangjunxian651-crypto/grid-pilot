import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import React from "react";

vi.mock("@/lib/i18n-context", () => ({
  useLang: () => ({ t: (k: string) => k, lang: "zh", setLang: () => {} }),
}));

// 空的 REST 分页，让 WS 实时成交以 liveRow 形式渲染（不被分页行去重覆盖）。
vi.mock("@/lib/hooks/useBots", async (orig) => ({
  ...(await orig<typeof import("@/lib/hooks/useBots")>()),
  useRobotFillsPaged: () => ({
    data: { pages: [{ data: [], boxes: {}, nextCursor: null }] },
    fetchNextPage: () => {},
    hasNextPage: false,
    isFetchingNextPage: false,
    isLoading: false,
  }),
}));

import { FillStream } from "../_monitor";

describe("FillStream 实时 WS 成交行", () => {
  it("WS 成交携带 avgGridPrice → 实时行直接展示该值（不再短暂显示 —）", () => {
    const wsFills = [
      { id: "WSLIVE1", side: "buy" as const, price: 1750.37, qty: 0.05, gridIndex: 49, route: "POC" as const, fee: 0, ts: 1000, avgGridPrice: 1750 },
    ];
    render(<FillStream robotId="r1" boxes={{}} wsFills={wsFills} t={(k: string) => k} lang="zh" />);
    const row = screen.getByTestId("fill-row-WSLIVE1");
    // 平均网格价格元显示 1750.00（成交价格元是 1750.37，不会混淆）
    expect(within(row).getByText("1750.00")).toBeTruthy();
  });
});
