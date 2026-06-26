import { describe, it, expect } from "vitest";
import { TERM_GLOSSARY } from "@/lib/term-glossary";
import { translate } from "@/lib/i18n";

describe("term glossary 完整性", () => {
  it("每个词条的 conceptKey/noteKey 在 base dict 有 zh 与 en（不泄漏原始 key）", () => {
    for (const [term, entry] of Object.entries(TERM_GLOSSARY)) {
      for (const key of [entry.conceptKey, entry.noteKey].filter(Boolean) as string[]) {
        expect(translate(key, "zh"), `${term} → ${key} zh`).not.toBe(key);
        expect(translate(key, "en"), `${term} → ${key} en`).not.toBe(key);
      }
    }
  });

  it("新增 fillPrice / orderPrice 词条存在", () => {
    expect(TERM_GLOSSARY.fillPrice?.conceptKey).toBe("help.fill_price.concept");
    expect(TERM_GLOSSARY.orderPrice?.conceptKey).toBe("help.order_price.concept");
  });

  it("平均网格价文案点明=交易所原生网格挂单价", () => {
    expect(translate("help.avg_grid_price.concept", "zh")).toContain("交易所");
    expect(translate("help.avg_grid_price.concept", "zh")).toContain("网格");
  });
});
