import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const css = readFileSync(resolve(__dirname, "../../app/globals.css"), "utf8");

function rootBlock() {
  const m = css.match(/:root\s*\{([\s\S]*?)\}/);
  return m ? m[1] : "";
}
function lightBlock() {
  const m = css.match(/\[data-theme="light"\]\s*\{([\s\S]*?)\}/);
  return m ? m[1] : "";
}
function val(block: string, name: string) {
  const m = block.match(new RegExp(`--${name}\\s*:\\s*([^;]+);`));
  return m ? m[1].trim() : null;
}

describe("design tokens — 青色品牌迁移", () => {
  it("深色 accent 为青色 #38bdd1", () => {
    expect(val(rootBlock(), "accent")).toBe("#38bdd1");
  });
  it("浅色 accent 为 #0e8fa6", () => {
    expect(val(lightBlock(), "accent")).toBe("#0e8fa6");
  });
  it("存在 --btn-fg token（主按钮文字色）", () => {
    expect(val(rootBlock(), "btn-fg")).toBeTruthy();
    expect(val(lightBlock(), "btn-fg")).toBeTruthy();
  });
  it("存在 --font-display token", () => {
    expect(val(rootBlock(), "font-display")).toBeTruthy();
  });
  it("深色 accent-tint 基于青色而非紫色", () => {
    expect(val(rootBlock(), "accent-tint")).toContain("56,189,209");
    expect(val(rootBlock(), "accent-tint")).not.toContain("132,123,255");
  });
  it("border-focus 基于青色", () => {
    expect(val(rootBlock(), "border-focus")).toContain("56,189,209");
  });
});

describe("Button primary 文字色走 token", () => {
  const src = readFileSync(resolve(__dirname, "../../components/ui/primitives.tsx"), "utf8");
  it("primary 不再硬编码 #fff 文字色", () => {
    const m = src.match(/primary:\s*\{[^}]*fg:\s*([^,]+)/);
    expect(m?.[1].trim()).toBe('"var(--btn-fg)"');
  });
});
