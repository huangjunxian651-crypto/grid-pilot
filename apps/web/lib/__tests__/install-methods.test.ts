import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// 仓库根（apps/web/lib/__tests__ → 上溯 4 级），与 readme-i18n.test.ts 一致。
const ROOT = resolve(__dirname, "../../../..");
const read = (f: string) => readFileSync(resolve(ROOT, f), "utf8");

/**
 * 保护 README 文档中的两种安装方式不被悄悄改坏：
 *   方式一：面向客户/自部署，纯 Docker，./install.sh 或 docker compose up --build -d
 *   方式二：面向开发者，pnpm install + pnpm dev（infra 走 docker-compose.dev.yml）
 * 这是黑盒契约测试——只读编排/脚本/模板文件，断言文档承诺的安装步骤仍然成立。
 */

describe("安装方式一 · Docker 全栈编排（docker-compose.yml，默认即完整产品）", () => {
  const compose = read("docker-compose.yml");

  it("定义 postgres / redis / api / web 四个服务", () => {
    for (const svc of ["postgres:", "redis:", "api:", "web:"]) {
      expect(compose, svc).toContain(svc);
    }
  });

  it("api 与 web 不依赖 profile（客户不需要理解 --profile 概念）", () => {
    expect(compose).not.toMatch(/profiles:\s*\[\s*["']full["']\s*\]/);
  });

  it("提供一键安装脚本 install.sh", () => {
    expect(existsSync(resolve(ROOT, "install.sh"))).toBe(true);
  });

  it("端口经环境变量驱动（与 .env 一致，可避免冲突）", () => {
    expect(compose).toContain("${WEB_PORT:-3300}:3300");
    expect(compose).toContain("${API_PORT:-3301}:3301");
    expect(compose).toContain("${DB_PORT:-25432}:5432");
    expect(compose).toContain("${REDIS_PORT:-26379}:6379");
  });

  it("api / web 通过各自 Dockerfile 构建，且文件存在", () => {
    expect(compose).toContain("dockerfile: apps/api/Dockerfile");
    expect(compose).toContain("dockerfile: apps/web/Dockerfile");
    expect(existsSync(resolve(ROOT, "apps/api/Dockerfile"))).toBe(true);
    expect(existsSync(resolve(ROOT, "apps/web/Dockerfile"))).toBe(true);
  });

  it("web 构建期注入 NEXT_PUBLIC_API_URL（浏览器侧 API 地址）", () => {
    expect(compose).toContain("NEXT_PUBLIC_API_URL");
  });

  it("api / web 读取根 .env（env_file），凭证不写死进镜像", () => {
    const apiWebEnvFile = compose.match(/env_file:\s*\.env/g) ?? [];
    expect(apiWebEnvFile.length).toBeGreaterThanOrEqual(2);
  });

  it("README 记载方式一命令", () => {
    const md = read("README.md");
    expect(md).toContain("./install.sh");
    expect(md).toContain("docker compose up --build -d");
    expect(md).not.toContain("--profile full");
  });

  it("api 入口容错容器注入的环境变量（不硬要求磁盘 .env，防 docker 启动崩溃回归）", () => {
    // 生产镜像不烤入 .env，配置经 env_file/environment 注入 process.env；
    // loadRootEnv 必须在缺 .env 文件但已注入关键变量时放行，否则 docker --profile full 启动即崩。
    const main = read("apps/api/src/main.ts");
    expect(main).toMatch(/process\.env\.DATABASE_URL/);
    expect(main).toMatch(/process\.env\.ENCRYPTION_KEY/);
  });
});

describe("安装方式二 · 本地 pnpm 开发（面向开发者，仍需 Docker 起基础设施）", () => {
  const pkg = JSON.parse(read("package.json")) as { scripts?: Record<string, string> };
  const scripts = pkg.scripts ?? {};

  it("根 package.json 提供 README 引用的全部脚本", () => {
    for (const s of ["dev", "dev:infra", "dev:api", "dev:web", "dev:skip-infra", "build", "test", "lint"]) {
      expect(scripts, s).toHaveProperty(s);
    }
  });

  it("dev:infra 指向仅含基础设施的 docker-compose.dev.yml（不误起 api/web）", () => {
    expect(scripts["dev:infra"]).toContain("docker-compose.dev.yml");
  });

  it("docker-compose.dev.yml 只含 postgres/redis，不含 api/web", () => {
    const devCompose = read("docker-compose.dev.yml");
    expect(devCompose).toContain("postgres:");
    expect(devCompose).toContain("redis:");
    expect(devCompose).not.toMatch(/^\s*api:/m);
    expect(devCompose).not.toMatch(/^\s*web:/m);
  });

  it("README 记载方式二命令", () => {
    const md = read("README.md");
    expect(md).toContain("pnpm install");
    expect(md).toContain("pnpm dev");
  });
});

describe("一键安装脚本 install.sh", () => {
  const script = read("install.sh");

  it("检测 Docker 缺失时打印官方安装文档链接并退出，不静默 sudo 安装", () => {
    expect(script).toContain("docs.docker.com");
    expect(script).not.toMatch(/curl.*get\.docker\.com.*\|\s*sh/);
  });

  it("自动生成 .env 并回填随机 ENCRYPTION_KEY", () => {
    expect(script).toContain(".env.example");
    expect(script).toMatch(/openssl rand -base64 32/);
  });

  it("最终调用 docker compose up --build -d（不依赖 --profile）", () => {
    expect(script).toContain("docker compose up --build -d");
  });
});

describe("环境模板 · .env.example 覆盖两种安装所需键", () => {
  const env = read(".env.example");

  it("含端口、数据库、Redis 与加密密钥键", () => {
    for (const key of [
      "WEB_PORT",
      "API_PORT",
      "DB_PORT",
      "REDIS_PORT",
      "DATABASE_URL",
      "REDIS_URL",
      "ENCRYPTION_KEY",
    ]) {
      expect(env, key).toContain(`${key}=`);
    }
  });

  it("不含真实密钥值（仅占位/说明，避免误提交）", () => {
    // 真实的 32 字节密钥经 base64 后是 44 个纯 base64 字符；占位符应为空或含非 base64 字符。
    const m = env.match(/^ENCRYPTION_KEY=(.*)$/m);
    const val = (m?.[1] ?? "").trim();
    const looksLikeRealKey = /^[A-Za-z0-9+/]{43}=$/.test(val) || /^[A-Za-z0-9+/]{44}$/.test(val);
    expect(looksLikeRealKey, `ENCRYPTION_KEY 看起来像真实密钥：${val}`).toBe(false);
  });
});
