import { describe, it, expect } from "vitest";
import { resolveNotificationBody, resolveNotificationTitle } from "@/lib/notification-body";
import { translate } from "@/lib/i18n";
import type { Notification } from "@/lib/api";

const t = (key: string, params?: Record<string, string | number>) => translate(key, "zh", params);

const base: Notification = {
  id: "n1", type: "alert", title: "T", body: "raw body",
  read: false, rangeId: null, createdAt: "2026-06-11T00:00:00Z",
};

describe("resolveNotificationBody", () => {
  it("有 code 时按 notifications.<code> 插值渲染，reason 嵌套翻译", () => {
    const n: Notification = {
      ...base,
      code: "ROBOT_AUTO_PAUSED",
      params: { symbol: "ETH/USDT", reason: "ACCOUNT_MODE_RESTRICTED" },
    };
    const text = resolveNotificationBody(n, t);
    expect(text).toContain("ETH/USDT");
    expect(text).toContain("简单模式"); // reason 已翻译，而非显示原始码
    expect(text).not.toContain("ACCOUNT_MODE_RESTRICTED");
  });

  it("reason 无对应 errors 词条时回退显示原始 reason", () => {
    const n: Notification = {
      ...base,
      code: "RUNNER_ORDER_REJECTED",
      params: { symbol: "ETH/USDT", runCode: "X", reason: "UNMAPPED_CODE" },
    };
    expect(resolveNotificationBody(n, t)).toContain("UNMAPPED_CODE");
  });

  it("无 code 的旧数据直接显示 body", () => {
    expect(resolveNotificationBody(base, t)).toBe("raw body");
  });

  it("未知 code 回退显示 body", () => {
    const n: Notification = { ...base, code: "FUTURE_CODE", params: {} };
    expect(resolveNotificationBody(n, t)).toBe("raw body");
  });
});

describe("resolveNotificationTitle", () => {
  it("有 code 且存在 notifications.title.<code> 词条时显示中文短标题，而非后端原始英文 title", () => {
    const n: Notification = { ...base, title: "Orders rejected repeatedly, grid cannot operate", code: "RUNNER_STOPPED_REJECTIONS" };
    const text = resolveNotificationTitle(n, t);
    expect(text).not.toBe("Orders rejected repeatedly, grid cannot operate");
    expect(text).toContain("网格");
  });

  it("无 code 的旧数据直接显示原始 title", () => {
    expect(resolveNotificationTitle(base, t)).toBe("T");
  });

  it("未知 code（无对应标题词条）回退显示原始 title", () => {
    const n: Notification = { ...base, title: "Some future event", code: "FUTURE_CODE" };
    expect(resolveNotificationTitle(n, t)).toBe("Some future event");
  });
});
