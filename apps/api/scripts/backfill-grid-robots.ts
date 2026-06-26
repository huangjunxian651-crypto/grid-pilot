import { PrismaClient } from '@prisma/client';
import { groupConfigsByRobot } from '../src/modules/trading-engine/robot/group-configs-by-robot';

/**
 * 把所有 robotId 为空的存量箱体配置归到新建的 GridRobot 下。
 * 幂等：只处理 robotId IS NULL 的配置，重复运行安全。
 */
export async function backfillGridRobots(
  prisma: PrismaClient,
): Promise<{ robotsCreated: number; configsLinked: number }> {
  const configs = await prisma.botRangeConfig.findMany({
    where: { robotId: null },
    select: { id: true, credentialId: true, symbol: true, direction: true },
  });

  const groups = groupConfigsByRobot(configs);

  let robotsCreated = 0;
  let configsLinked = 0;
  for (const g of groups) {
    const robot = await prisma.gridRobot.create({
      data: {
        credentialId: g.credentialId,
        symbol: g.symbol,
        direction: g.direction,
        status: 'PAUSED',
      },
    });
    robotsCreated += 1;
    await prisma.botRangeConfig.updateMany({
      where: { id: { in: g.configIds } },
      data: { robotId: robot.id },
    });
    configsLinked += g.configIds.length;
  }

  return { robotsCreated, configsLinked };
}

if (require.main === module) {
  const prisma = new PrismaClient();
  backfillGridRobots(prisma)
    .then((r) => {
      console.log(`Backfill done: ${r.robotsCreated} robots created, ${r.configsLinked} configs linked`);
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => void prisma.$disconnect());
}
