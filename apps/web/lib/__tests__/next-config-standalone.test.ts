import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("next.config standalone output", () => {
  const src = readFileSync(resolve(__dirname, "../../next.config.ts"), "utf8");

  it("声明 standalone 输出，供 Docker 精简运行镜像使用", () => {
    expect(src).toMatch(/output:\s*["']standalone["']/);
  });

  it("将 outputFileTracingRoot 指向 monorepo 根，确保 standalone 收集 workspace 依赖", () => {
    expect(src).toMatch(/outputFileTracingRoot:\s*path\.resolve\(__dirname,\s*["']\.\.\/\.\.["']\)/);
  });
});
