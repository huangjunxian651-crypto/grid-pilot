import { describe, it, expect } from "vitest";
import { deriveGateioAlgoSide, coinToContracts } from "./utils";

// 根因回归：coinToContracts 旧实现 Math.round 强制整张合约，无视 lotSz 允许零头张，
// 导致 OKX 0.05 ETH(0.5张, lotSz=0.01) 被进位成 1张=0.1 ETH=2×，引发单线 churn。
describe("coinToContracts — 尊重 lotSz 零头张", () => {
  it("OKX 0.05 ETH (ctVal=0.1, lotSz=0.01) → 0.5 张，不再进位成 1", () => {
    expect(coinToContracts(0.05, 0.1, 0.01)).toBeCloseTo(0.5, 8);
  });
  it("OKX 0.1 ETH → 1 张", () => {
    expect(coinToContracts(0.1, 0.1, 0.01)).toBeCloseTo(1, 8);
  });
  it("OKX 0.15 ETH → 1.5 张", () => {
    expect(coinToContracts(0.15, 0.1, 0.01)).toBeCloseTo(1.5, 8);
  });
  it("OKX 0.123 ETH → 1.23 张 (对齐到 lotSz=0.01)", () => {
    expect(coinToContracts(0.123, 0.1, 0.01)).toBeCloseTo(1.23, 8);
  });
  it("OKX 浮点噪声清理：0.3 ETH → 3 张整洁值", () => {
    expect(coinToContracts(0.3, 0.1, 0.01)).toBeCloseTo(3, 8);
  });
  it("Gate 整张合约 (lotSz 默认=1)：0.05/0.01 → 5 张", () => {
    expect(coinToContracts(0.05, 0.01)).toBe(5);
  });
  it("Gate lotSz=1 显式：0.05/0.01 → 5", () => {
    expect(coinToContracts(0.05, 0.01, 1)).toBe(5);
  });
  it("默认 lotSz=1 保持旧整张语义（向后兼容）", () => {
    expect(coinToContracts(0.1, 0.1)).toBe(1);
  });
  it("过小数量(对齐后为 0 张)抛错", () => {
    expect(() => coinToContracts(0.0001, 0.1, 0.01)).toThrow();
  });
});

describe("deriveGateioAlgoSide", () => {
  it("平仓型(close,size=0):rule2 跌破=平多=sell", () => {
    expect(deriveGateioAlgoSide(0, true, 2)).toBe("sell");
  });
  it("平仓型(close,size=0):rule1 涨破=平空=buy", () => {
    expect(deriveGateioAlgoSide(0, true, 1)).toBe("buy");
  });
  it("带量单:正 size=buy", () => {
    expect(deriveGateioAlgoSide(5, false, 1)).toBe("buy");
  });
  it("带量单:负 size=sell", () => {
    expect(deriveGateioAlgoSide(-5, false, 2)).toBe("sell");
  });
});

import {
  formatSessionTimestamp,
  sessionToken,
  encodeClientOrderId,
  parseClientOrderId,
  isLegacyClientOrderId,
  encodeAlgoClientOrderId,
  parseAlgoClientOrderId,
  toOkxClientId,
  SYMBOL_TOKEN_LIMIT_BY_EXCHANGE,
  DERIVED_SYMBOL_TOKEN_LIMIT_BY_EXCHANGE,
} from "./utils";

describe("clientOrderId codec", () => {
  it("formatSessionTimestamp 输出 12 位 yymmddHHMMSS (UTC)", () => {
    const d = new Date(Date.UTC(2026, 7, 10, 12, 22, 12));
    expect(formatSessionTimestamp(d)).toBe("260810122212");
  });

  it("formatSessionTimestamp 零填充", () => {
    const d = new Date(Date.UTC(2026, 0, 3, 4, 5, 6));
    expect(formatSessionTimestamp(d)).toBe("260103040506");
  });

  it("sessionToken 去掉下划线", () => {
    expect(sessionToken("ETHUSDT_260810122212")).toBe("ETHUSDT260810122212");
  });

  it("encodeClientOrderId 拼接 symbol+time+side+seq 无分隔符", () => {
    expect(encodeClientOrderId("ETHUSDT_260810122212", "SELL", 16)).toBe("ETHUSDT260810122212S16");
    expect(encodeClientOrderId("ETHUSDT_260810122212", "BUY", 1)).toBe("ETHUSDT260810122212B1");
  });

  it("parseClientOrderId 解出四段 (普通 symbol)", () => {
    expect(parseClientOrderId("ETHUSDT260810122212S16")).toEqual({
      symbol: "ETHUSDT",
      time: "260810122212",
      side: "SELL",
      seq: 16,
    });
  });

  it("parseClientOrderId 处理 symbol 含数字", () => {
    expect(parseClientOrderId("1000PEPEUSDT260810122212B7")).toEqual({
      symbol: "1000PEPEUSDT",
      time: "260810122212",
      side: "BUY",
      seq: 7,
    });
  });

  it("parseClientOrderId 处理 symbol 含字母 S (SUSHIUSDT)", () => {
    expect(parseClientOrderId("SUSHIUSDT260810122212S99")).toEqual({
      symbol: "SUSHIUSDT",
      time: "260810122212",
      side: "SELL",
      seq: 99,
    });
  });

  it("parseClientOrderId 处理 symbol 末尾含数字 (BTC1)", () => {
    expect(parseClientOrderId("BTC1260810122212B5")).toEqual({
      symbol: "BTC1",
      time: "260810122212",
      side: "BUY",
      seq: 5,
    });
  });

  it("encode → parse round-trip", () => {
    const id = encodeClientOrderId("ETHUSDT_260810122212", "BUY", 42);
    expect(parseClientOrderId(id)).toEqual({
      symbol: "ETHUSDT",
      time: "260810122212",
      side: "BUY",
      seq: 42,
    });
  });

  it("parseClientOrderId 不匹配旧格式返回 null", () => {
    expect(parseClientOrderId("test-session_SELL_99")).toBeNull();
  });
});

describe("isLegacyClientOrderId", () => {
  it("识别旧格式 SYMBOL_<13位ms>_SIDE_seq", () => {
    expect(isLegacyClientOrderId("ETHUSDT_1780729121015_SELL_16")).toBe(true);
    expect(isLegacyClientOrderId("ETHUSDT_1780729121015_BUY_1")).toBe(true);
  });
  it("新格式不算旧格式", () => {
    expect(isLegacyClientOrderId("ETHUSDT260810122212S16")).toBe(false);
  });
  it("算法单（12位时间+_algo_）不算旧格式", () => {
    expect(isLegacyClientOrderId("ETHUSDT_260810122212_algo_emergency_x")).toBe(false);
  });
  it("用户手动单不算旧格式", () => {
    expect(isLegacyClientOrderId("USER_MANUAL_xyz")).toBe(false);
  });
  it("undefined 安全返回 false", () => {
    expect(isLegacyClientOrderId(undefined)).toBe(false);
  });
});

describe("algo clientOrderId codec（OKX 兼容：纯字母数字 ≤32）", () => {
  // 旧格式 `${runCode}_algo_emergency_<rand>` 经 toOkxClientId 去下划线后
  // 截断 32 字符恰好吃掉随机后缀 → 每次重下同一 id 被 OKX 拒重复；
  // 且带下划线前缀匹配不上 OKX 回报的无下划线 id → 所有权检查永远不中。
  it("encodeAlgoClientOrderId 输出 sessionToken+A+kind+suffix，纯字母数字", () => {
    const id = encodeAlgoClientOrderId("ETHUSDT_260611071735", "emergency", "3k");
    expect(id).toBe("ETHUSDT260611071735AE3k");
    expect(/^[a-zA-Z0-9]+$/.test(id)).toBe(true);
    expect(id.length).toBeLessThanOrEqual(32);
    expect(id.startsWith(sessionToken("ETHUSDT_260611071735"))).toBe(true);
  });

  it("12 字符 symbol（1000PEPEUSDT）的 algo id 满足 OKX ≤32 / Binance ≤36", () => {
    const id = encodeAlgoClientOrderId("1000PEPEUSDT_260611071735", "emergency", "3k");
    expect(id.length).toBeLessThanOrEqual(32);
  });

  it("限额表不变式：极限长度 symbol 的 algo id 与网格 id（seq 5 位）经各所净化后均合规", () => {
    // 限额必须同时覆盖两种 id 预算：algo（开销 16）与网格（开销 12+1+5 位 seq=18）。
    // 此前只按 algo 反推，放行了网格 id 在 seq≥1000 时被 OKX/Binance 静默截断
    // 撞 id 的边界 symbol。表值若与 codec 开销失配，此测试失败。
    const maxLen: Record<string, number> = { gateio: 28, okx: 32, binance: 36 };
    for (const [exchange, limit] of Object.entries(SYMBOL_TOKEN_LIMIT_BY_EXCHANGE)) {
      const symbol = "X".repeat(limit);
      const sessionCode = `${symbol}_260611071735`;
      const algoId = encodeAlgoClientOrderId(sessionCode, "emergency", "3k");
      const gridId = encodeClientOrderId(sessionCode, "SELL", 99999);
      expect(algoId.length, `${exchange} algo`).toBeLessThanOrEqual(maxLen[exchange]);
      expect(gridId.length, `${exchange} grid seq=99999`).toBeLessThanOrEqual(maxLen[exchange]);
      if (exchange === "okx") {
        // OKX 净化必须无损（截断即撞 id）
        expect(toOkxClientId(gridId)).toBe(gridId);
        expect(toOkxClientId(algoId)).toBe(algoId);
      }
    }
  });

  it("toOkxClientId 对新格式无损（round-trip）", () => {
    const id = encodeAlgoClientOrderId("ETHUSDT_260611071735", "emergency", "3k");
    expect(toOkxClientId(id)).toBe(id);
  });

  it("parseAlgoClientOrderId 解出 token 与 kind", () => {
    const parsed = parseAlgoClientOrderId("ETHUSDT260611071735AE3k");
    expect(parsed).toEqual({ token: "ETHUSDT260611071735", kind: "emergency", suffix: "3k" });
    expect(parseAlgoClientOrderId("ETHUSDT260611071735AG01")!.kind).toBe("grid");
  });

  it("parseAlgoClientOrderId 不误判网格单/旧格式/手动单", () => {
    expect(parseAlgoClientOrderId("ETHUSDT260611071735B12")).toBeNull();
    expect(parseAlgoClientOrderId("ETHUSDT260611071735S3")).toBeNull();
    expect(parseAlgoClientOrderId("ETHUSDT_260611071735_algo_emergency_x")).toBeNull();
    expect(parseAlgoClientOrderId("USER_MANUAL_xyz")).toBeNull();
    expect(parseAlgoClientOrderId(undefined)).toBeNull();
  });
});

describe("SYMBOL_TOKEN_LIMIT 防漂移", () => {
  it('SYMBOL_TOKEN_LIMIT 权威值 === codec 推导值（防漂移）', () => {
    expect(DERIVED_SYMBOL_TOKEN_LIMIT_BY_EXCHANGE).toEqual(SYMBOL_TOKEN_LIMIT_BY_EXCHANGE);
  });
});
