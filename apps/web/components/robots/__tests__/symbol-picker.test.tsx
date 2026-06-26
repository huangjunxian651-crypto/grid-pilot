import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";

vi.mock("@/lib/i18n-context", () => ({ useLang: () => ({ t: (k: string) => k, lang: "zh", setLang: () => {} }) }));

import { SymbolPicker } from "../symbol-picker";

function Harness({ initial = "", exchangeId = "binance", onBlockedChange }: { initial?: string; exchangeId?: string; onBlockedChange?: (b: boolean) => void }) {
  const [v, setV] = React.useState(initial);
  return <SymbolPicker value={v} exchangeId={exchangeId} onChange={setV} onBlockedChange={onBlockedChange} />;
}

describe("SymbolPicker", () => {
  it("选 BTC/ETH 无警告、不阻断", () => {
    const onBlockedChange = vi.fn();
    render(<Harness initial="BTC/USDT" exchangeId="binance" onBlockedChange={onBlockedChange} />);
    expect(screen.queryByText("symbol.major_caution")).toBeNull();
    expect(onBlockedChange).toHaveBeenLastCalledWith(false);
  });

  it("选主流 BNB → 出轻提示、不阻断", () => {
    render(<Harness initial="BNB/USDT" exchangeId="binance" />);
    expect(screen.getByText("symbol.major_caution")).toBeTruthy();
  });

  it("自定义输入山寨 → 弹警告且未勾选时阻断；勾选后放行", () => {
    const onBlockedChange = vi.fn();
    render(<Harness initial="" exchangeId="binance" onBlockedChange={onBlockedChange} />);
    fireEvent.click(screen.getByTestId("symbol-tab-custom"));
    fireEvent.change(screen.getByTestId("symbol-custom-input"), { target: { value: "PEPE/USDT" } });
    expect(screen.getByText("symbol.alt_warning_body")).toBeTruthy();
    expect(onBlockedChange).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByTestId("symbol-alt-ack"));
    expect(onBlockedChange).toHaveBeenLastCalledWith(false);
  });

  it("自定义输入过长 token（Gate 限 10）→ 阻断并提示长度", () => {
    const onBlockedChange = vi.fn();
    render(<Harness initial="" exchangeId="gateio" onBlockedChange={onBlockedChange} />);
    fireEvent.click(screen.getByTestId("symbol-tab-custom"));
    fireEvent.change(screen.getByTestId("symbol-custom-input"), { target: { value: "1000PEPE/USDT" } }); // token 12 > 10
    expect(screen.getByText("errors.SYMBOL_TOO_LONG_FOR_EXCHANGE")).toBeTruthy();
    expect(onBlockedChange).toHaveBeenLastCalledWith(true);
  });

  it("以非推荐 value 渲染时自动进入自定义模式并显示该值", () => {
    render(<Harness initial="PEPE/USDT" exchangeId="binance" />);
    // 无需点击「其他」标签，自定义输入框应直接可见并填充该值
    const input = screen.getByTestId("symbol-custom-input") as HTMLInputElement;
    expect(input.value).toBe("PEPE/USDT");
  });
});
