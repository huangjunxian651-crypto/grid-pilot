import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../../../..");
const read = (f: string) => readFileSync(resolve(ROOT, f), "utf8");

// 与代码常量保持一致（referral-cta.tsx / referral.ts）
const INVITE_CODES = ["fanwo20", "fangeiwo"];
const REBATE_TEXT = ["20%", "40%"];

describe("README.md 简体中文主稿契约", () => {
  const md = read("README.md");

  it("包含九大章节锚点", () => {
    for (const heading of [
      "为什么是网格交易",
      "5 大创新",
      "功能概览",
      "手续费",
      "安装",
      "使用说明",
      "注意事项",
      "技术栈",
    ]) {
      expect(md).toContain(heading);
    }
  });

  it("邀请码与代码常量一致", () => {
    for (const code of INVITE_CODES) expect(md).toContain(code);
  });

  it("返佣比例与代码常量一致（20% / Gate 40%）", () => {
    for (const t of REBATE_TEXT) expect(md).toContain(t);
  });

  it("主推赞助商 rebateto.me，且不主推技术接口域名", () => {
    expect(md).toContain("rebateto.me");
    expect(md).not.toContain("fangeiwo.net");
  });

  it("含风险免责与 Docker 一键命令", () => {
    expect(md).toMatch(/风险|免责/);
    expect(md).toContain("docker compose --profile full up");
  });
});
