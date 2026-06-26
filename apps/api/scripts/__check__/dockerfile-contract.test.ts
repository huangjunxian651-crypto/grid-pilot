import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("api docker entrypoint 契约", () => {
  it("entrypoint 必须先执行 prisma migrate deploy 再启动服务", () => {
    const sh = readFileSync(resolve(__dirname, "../../docker-entrypoint.sh"), "utf8");
    const migrateIdx = sh.indexOf("prisma migrate deploy");
    const startIdx = sh.indexOf("node dist/main");
    expect(migrateIdx).toBeGreaterThanOrEqual(0);
    expect(startIdx).toBeGreaterThan(migrateIdx);
  });
});
