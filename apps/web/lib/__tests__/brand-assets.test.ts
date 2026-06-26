import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function read(rel: string) {
  return readFileSync(resolve(__dirname, "../.." + rel), "utf8");
}

describe("静态品牌资产 — 上升柱状图方案", () => {
  it("app/icon.svg 含顶部金色 Alpha 方块 (x=35,y=10)", () => {
    const svg = read("/app/icon.svg");
    expect(svg).toMatch(/x="35"[^>]*y="10"/);
  });
  it("app/icon.svg 含上升柱（第三/四列顶部 y=18）", () => {
    const svg = read("/app/icon.svg");
    expect(svg).toMatch(/x="25.5"[^>]*y="18"/);
  });
  it("app/icon.svg 不再含旧紫色 / 节点对角线", () => {
    const svg = read("/app/icon.svg");
    expect(svg).not.toContain("847bff");
    expect(svg).not.toContain("132,123,255");
    expect(svg).not.toContain("M15 33L24 24L33 15");
  });
  it("public/brand mark-dark 含金色顶块柱状几何", () => {
    const svg = read("/public/brand/gridpilot-mark-dark.svg");
    expect(svg).toMatch(/x="35"[^>]*y="10"/);
  });
  it("public/brand 4 个 svg 均不含旧紫色与旧节点对角线", () => {
    for (const f of ["gridpilot-mark-dark.svg", "gridpilot-mark-light.svg", "gridpilot-logo-dark.svg", "gridpilot-logo-light.svg"]) {
      const svg = read("/public/brand/" + f);
      expect(svg).not.toContain("847bff");
      expect(svg).not.toContain("M15 33L24 24L33 15");
    }
  });
});
