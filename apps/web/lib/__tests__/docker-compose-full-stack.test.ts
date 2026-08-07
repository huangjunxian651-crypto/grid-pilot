import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("docker-compose.yml 默认即完整产品栈", () => {
  const yml = readFileSync(resolve(__dirname, "../../../../docker-compose.yml"), "utf8");

  it("api 与 web 服务不依赖 profile（默认 up 即包含全部服务）", () => {
    expect(yml).toMatch(/api:/);
    expect(yml).toMatch(/web:/);
    expect(yml).not.toMatch(/profiles:\s*\[\s*["']full["']\s*\]/);
  });

  it("api 通过容器服务名访问 postgres/redis", () => {
    expect(yml).toMatch(/postgresql:\/\/gridpilot:gridpilot@postgres:5432\/gridpilot/);
    expect(yml).toMatch(/redis:\/\/redis:6379/);
  });

  it("web 容器内 SSR 指向 api 服务，浏览器端指向宿主端口", () => {
    expect(yml).toMatch(/API_URL:\s*http:\/\/api:3301/);
    expect(yml).toMatch(/NEXT_PUBLIC_API_URL:\s*http:\/\/localhost:\$\{API_PORT:-3301\}/);
  });

  it("web 构建期把 API_URL 作为 build arg 传入（rewrites 目标在 build 时烘焙，运行期 environment 对其不生效）", () => {
    expect(yml).toMatch(/args:[\s\S]*?API_URL:\s*http:\/\/api:3301/);
  });
});
