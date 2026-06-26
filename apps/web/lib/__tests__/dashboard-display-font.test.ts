import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const src = readFileSync(resolve(__dirname, "../../app/dashboard/page.tsx"), "utf8");

describe("仪表盘标题数字用 display 字体", () => {
  it("账户权益大数字使用 var(--font-display)", () => {
    expect(src).toContain('fontFamily: "var(--font-display)"');
  });
});
