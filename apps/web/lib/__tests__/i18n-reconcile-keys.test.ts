import { describe, it, expect } from "vitest";
import { translate } from "@/lib/i18n";

describe("成交同步韧性相关 i18n key（zh/en 均需存在）", () => {
  const keys = [
    "notifications.POSITION_DRIFT_DETECTED",
    "notifications.RECONCILE_REPEATED_FAILURE",
    "robot.action_reconcile",
    "robot.toast_reconciled",
    "robot.reconcile_position_ok",
    "robot.reconcile_position_diff",
  ];

  it.each(keys)("%s 在 zh 和 en 都有翻译（不回退成 key 本身）", (key) => {
    expect(translate(key, "zh")).not.toBe(key);
    expect(translate(key, "en")).not.toBe(key);
  });
});
