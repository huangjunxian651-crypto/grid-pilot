import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

vi.mock("@/lib/i18n-context", () => ({
  useLang: () => ({ t: (k: string) => k, lang: "zh", setLang: () => {} }),
}));

import { __FillDetailForTest as FillDetail } from "../_monitor";

const row = {
  id: "f1", ts: 1000, side: "sell" as const, gridIndex: 3, price: 2500, qty: 0.01,
  route: "POC" as const, fee: 0.012, feeAsset: "USDT", savings: 0.5, savingsRate: 0.0075,
  avgGridPrice: 1812, orderPrice: 2499, boxId: undefined, orderId: "o1", clientOrderId: "c1",
};

describe("FillDetail 帮助提示", () => {
  it("对有词条的术语渲染 TermHelp 按钮", () => {
    render(<FillDetail row={row} boxes={undefined} t={(k: string) => k} lang="zh" />);
    for (const term of ["fillPrice", "avgGridPrice", "orderPrice", "makerTaker", "fee", "savings"]) {
      expect(screen.getByTestId(`term-help-${term}`), term).toBeTruthy();
    }
  });
});
