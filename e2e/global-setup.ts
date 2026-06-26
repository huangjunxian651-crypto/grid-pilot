import { PrismaClient } from "@prisma/client";

/**
 * Playwright Global Setup
 *
 * 在 E2E 测试开始前执行：
 * 1. 连接测试数据库（由 .env.test 指定 DATABASE_URL）
 * 2. 清理所有业务数据（保留表结构）
 * 3. 可选：创建测试用的管理员账号
 */
export default async function globalSetup() {
  // 确保使用测试数据库（双重校验：数据库名 + 端口）。
  // 硬失败（fail-closed）：本 setup 会 deleteMany 全部业务表（含 User），
  // 历史上曾因直连 dev 库导致开发数据被反复清空（用户被迫每天重新注册）。
  // 确需对非标准测试库运行时，显式设置 E2E_ALLOW_CUSTOM_DB=1 豁免。
  const databaseUrl = process.env.DATABASE_URL;
  const isTestDb = databaseUrl?.includes("gridpilot_test") && databaseUrl?.includes(":25433");
  if (!isTestDb && process.env.E2E_ALLOW_CUSTOM_DB !== "1") {
    throw new Error(
      `E2E global-setup 拒绝运行：DATABASE_URL 不是测试数据库（期望含 "gridpilot_test" 和端口 ":25433"，实际: ${databaseUrl}）。` +
      `本 setup 会清空全部业务数据。请用 pnpm test:e2e（自动加载 .env.test），` +
      `或确认目标库无误后设置 E2E_ALLOW_CUSTOM_DB=1 豁免。`,
    );
  }

  const prisma = new PrismaClient();

  try {
    console.log("🧹 Cleaning test database before E2E tests...");

    // 按外键依赖顺序清理（子表 → 父表）
    const result = await prisma.$transaction([
      prisma.fill.deleteMany(),
      prisma.order.deleteMany(),
      prisma.stateSnapshot.deleteMany(),
      prisma.run.deleteMany(),
      prisma.box.deleteMany(),
      prisma.robot.deleteMany(),
      prisma.exchangeAccount.deleteMany(),
      prisma.user.deleteMany(),
    ]);

    const deletedCounts = result.map((r) => r.count);
    const totalDeleted = deletedCounts.reduce((a, b) => a + b, 0);

    if (totalDeleted > 0) {
      console.log(`✅ Cleaned up ${totalDeleted} records from test database`);
    } else {
      console.log("✅ Test database is already clean");
    }
  } catch (error) {
    console.error("❌ Failed to clean test database:", error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}
