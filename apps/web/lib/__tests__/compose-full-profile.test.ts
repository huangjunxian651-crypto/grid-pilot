import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("docker-compose full profile", () => {
  const yml = readFileSync(resolve(__dirname, "../../../../docker-compose.yml"), "utf8");

  it("api 与 web 服务归入 full profile（默认只起基础设施）", () => {
    expect(yml).toMatch(/api:/);
    expect(yml).toMatch(/web:/);
    expect(yml).toMatch(/profiles:\s*\[\s*["']full["']\s*\]/);
  });

  it("api 通过容器服务名访问 postgres/redis", () => {
    expect(yml).toMatch(/postgresql:\/\/gridpilot:gridpilot@postgres:5432\/gridpilot/);
    expect(yml).toMatch(/redis:\/\/redis:6379/);
  });

  it("web 容器内 SSR 指向 api 服务，浏览器端指向宿主端口", () => {
    expect(yml).toMatch(/API_URL:\s*http:\/\/api:3301/);
    expect(yml).toMatch(/NEXT_PUBLIC_API_URL:\s*http:\/\/localhost:\$\{API_PORT:-3301\}/);
  });
});
