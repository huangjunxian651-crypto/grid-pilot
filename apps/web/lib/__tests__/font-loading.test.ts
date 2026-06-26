import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const layout = readFileSync(resolve(__dirname, "../../app/layout.tsx"), "utf8");
const css = readFileSync(resolve(__dirname, "../../app/globals.css"), "utf8");

describe("字体加载", () => {
  it("layout 注册 Space Grotesk (display)", () => {
    expect(layout).toContain("Space_Grotesk");
    expect(layout).toMatch(/variable:\s*["']--font-display["']/);
  });
  it("layout 注册 IBM Plex Sans (body)", () => {
    expect(layout).toContain("IBM_Plex_Sans");
    expect(layout).toMatch(/variable:\s*["']--font-sans["']/);
  });
  it("layout 注册 IBM Plex Mono", () => {
    expect(layout).toContain("IBM_Plex_Mono");
    expect(layout).toMatch(/variable:\s*["']--font-mono["']/);
  });
  it("globals --font-sans 指向 IBM Plex Sans", () => {
    expect(css).toMatch(/--font-sans:\s*"IBM Plex Sans"/);
  });
  it("globals --font-mono 指向 IBM Plex Mono", () => {
    expect(css).toMatch(/--font-mono:\s*"IBM Plex Mono"/);
  });
  it("不再使用 Geist 字体", () => {
    expect(layout).not.toContain("Geist");
    expect(layout).not.toContain("geist-sans");
  });
});
