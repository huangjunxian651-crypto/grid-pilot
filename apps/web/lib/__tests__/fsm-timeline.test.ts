import { describe, it, expect } from "vitest";
import { deriveFsmTimeline, LINEAR_FSM_STATES } from "../../app/robots/[id]/_monitor";
import { translate, SUPPORTED_LANGS, type Lang } from "../i18n";

describe("deriveFsmTimeline", () => {
  it("线性主状态返回 timeline 模式且步进索引正确", () => {
    const model = deriveFsmTimeline("RUNNING");
    expect(model.mode).toBe("timeline");
    if (model.mode !== "timeline") throw new Error("unreachable");
    expect(model.states).toEqual(LINEAR_FSM_STATES);
    expect(model.activeIndex).toBe(LINEAR_FSM_STATES.indexOf("RUNNING"));
  });

  it("TRAILING_ENTRY 为首个线性状态 index=0", () => {
    const model = deriveFsmTimeline("TRAILING_ENTRY");
    expect(model.mode).toBe("timeline");
    if (model.mode !== "timeline") throw new Error("unreachable");
    expect(model.activeIndex).toBe(0);
  });

  it("LIQUIDATED 为末态 index=末尾", () => {
    const model = deriveFsmTimeline("LIQUIDATED");
    expect(model.mode).toBe("timeline");
    if (model.mode !== "timeline") throw new Error("unreachable");
    expect(model.activeIndex).toBe(LINEAR_FSM_STATES.length - 1);
  });

  it.each([
    // 分支态挂靠主生命线的位置（来源：docs/STRATEGY_SPEC.md §9.2 状态转换）
    ["HOLD", 0], // 启动检测到继承持仓待激活，处于建仓阶段
    ["CANCELLED", 0], // TRAILING_ENTRY 追踪窗口关闭，未建仓即退出
    ["PAUSED", 1], // RUNNING/TRAILING_ENTRY 暂停，挂靠 RUNNING
    ["TAKE_PROFIT", 1], // RUNNING 止盈退出（终态）
  ] as const)(
    "分支/终态 %s 返回 branch 模式，挂靠主线 anchorIndex=%i",
    (kind, anchorIndex) => {
      const model = deriveFsmTimeline(kind);
      expect(model.mode).toBe("branch");
      if (model.mode !== "branch") throw new Error("unreachable");
      expect(model.kind).toBe(kind);
      expect(model.anchorIndex).toBe(anchorIndex);
    },
  );

  it("SLEEPING(遗留态) 与未知态回退 branch 且无挂靠点(anchorIndex=null)，不会出现全灰时间线无进度", () => {
    const sleeping = deriveFsmTimeline("SLEEPING");
    expect(sleeping.mode).toBe("branch");
    if (sleeping.mode !== "branch") throw new Error("unreachable");
    expect(sleeping.anchorIndex).toBeNull();
    const unknown = deriveFsmTimeline("WHATEVER" as never);
    expect(unknown.mode).toBe("branch");
    if (unknown.mode !== "branch") throw new Error("unreachable");
    expect(unknown.anchorIndex).toBeNull();
  });
});

describe("FSM 分支态标签 overlay 本地化（P1-1）", () => {
  const branchStateKeys = ["fsm.PAUSED", "fsm.CANCELLED", "fsm.HOLD", "fsm.TAKE_PROFIT"];
  const overlayLangCodes = SUPPORTED_LANGS
    .map((entry) => entry.code)
    .filter((code): code is Lang => code !== "zh" && code !== "en");

  it.each(overlayLangCodes)("overlay 语言 %s 的分支态标签已本地化（非英文兜底）", (lang) => {
    const untranslated = branchStateKeys.filter(
      (key) => translate(key, lang) === translate(key, "en"),
    );
    expect(untranslated, `${lang} 未翻译: ${untranslated.join(", ")}`).toEqual([]);
  });
});
