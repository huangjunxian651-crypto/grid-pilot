// critical-event-notification.unit.spec.ts — 黑盒验证 Runner 关键事件 → 通知负载
// 生产实况（2026-08-04）：通知中心只显示 "ETH/USDT 连续下单被拒，网格无法正常运行：1"，
// 用户完全看不出这是哪个交易所的机器人。必须在 params.symbol 里带上交易所前缀。

import { describe, it, expect } from "vitest";
import { buildCriticalEventNotification } from "./critical-event-notification";

describe("buildCriticalEventNotification", () => {
  it("params.symbol 带交易所前缀，用户能一眼看出是哪个交易所报的错", () => {
    const n = buildCriticalEventNotification("ETHUSDT_260804135711", "ETH/USDT", "okx", {
      kind: "STOPPED_REJECTIONS",
      reason: "51008",
      message: "OKX createOrder failed: Order failed. Insufficient margin",
    });

    expect(n.params.symbol).toBe("OKX ETH/USDT");
    expect(n.params.reason).toBe("51008");
    expect(n.params.runCode).toBe("ETHUSDT_260804135711");
  });

  it("body 里同样带交易所前缀（旧数据/未命中 i18n key 时的回退文案也要可读）", () => {
    const n = buildCriticalEventNotification("ETHUSDT_260804135711", "ETH/USDT", "binance", {
      kind: "ORDER_REJECTED",
      reason: "RATE_LIMIT",
      message: "Binance createOrder failed: too many requests",
    });

    expect(n.body).toContain("BINANCE ETH/USDT");
  });

  it("按事件 kind 映射到既有 type/title/code（行为保持不变）", () => {
    const n = buildCriticalEventNotification("R1", "ETH/USDT", "gate", {
      kind: "PAUSED_PERMANENT_ERROR",
      reason: "CLIENT_ID_TOO_LONG",
      message: "client id too long",
    });

    expect(n.type).toBe("alert");
    expect(n.title).toBe("Bot paused: permanent configuration error");
    expect(n.code).toBe("RUNNER_PAUSED_PERMANENT_ERROR");
  });
});
