import { Injectable, Logger, OnApplicationBootstrap, Inject, BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { TradingEngineService } from '../trading-engine.service';
import type { StopOutcome, TerminalReason } from '../trading-engine.service';
import { RobotScheduler } from './robot-scheduler';
import type { BoxCandidate, EntryMode } from './decide-box-activation';
import { decideBoxActivation } from './decide-box-activation';
import { deriveBoxLines } from '@gridpilot/shared-types';
import { validateBoxAddition, type BoxSpec } from './validate-box-addition';
import { throwBoxValidationError } from './box-error-code';
import { SYMBOL_TOKEN_LIMIT_BY_EXCHANGE } from '../../exchange/adapters/utils';
import { formatSessionTimestamp } from '../../exchange/adapters/utils';
import { AccountSnapshotService } from '../account/account-snapshot.service';
import { NotificationService } from '../../notification/notification.service';
import { PnlLedgerService, round8 } from '../savings/pnl-ledger.service';
import { resolveUnrealizedPnl } from '../account/resolve-unrealized-pnl';

/** TradingEngineService 中本服务依赖的子集（便于测试注入 mock）。 */
export interface RunnerLauncher {
  startBot(configId: string, runCode: string, initialState?: EntryMode): Promise<{ runCode: string }>;
  stopBot(runCode: string, terminal?: TerminalReason): Promise<StopOutcome>;
  detachBot(runCode: string, terminal?: TerminalReason): Promise<{ cancelFailed: string[] }>;
  pauseBot(runCode: string): Promise<void>;
  /** 停止收尾：一次性 REST 拉取该账户快照，返回指定 symbol 的持仓（无则 null）。 */
  captureStopSnapshot(
    credentialId: string,
    symbol: string,
  ): Promise<import('../account/account-snapshot.service').PositionInfo | null>;
  /** 注册「box 终止」回调。BotManager 借此让 runner 层在不反向依赖本服务的情况下通知它。 */
  setOnBoxTerminated(cb: (robotId: string, configId: string) => void | Promise<void>): void;
  /** 校验 symbol 在该账户交易所可交易；不可交易抛 SYMBOL_NOT_TRADABLE，网络等不确定错误放行。 */
  assertSymbolTradable(credentialId: string, symbol: string): Promise<void>;
}

/** 公共行情订阅源。subscribe 返回退订函数。 */
export interface TickerSource {
  subscribe(robotId: string, credentialId: string, symbol: string, onPrice: (price: number) => void): () => void;
}

export interface CreateRobotInput {
  credentialId: string;
  symbol: string;
  direction: string;
  exchangeAccountId: string;
}

export interface AddBoxInput {
  direction: string;
  takeProfitPrice: number;
  mainGridCount: number;
  mainGridStep: number;
  mainGridPortionSize: number;
  leverage: number;
  stopLossGridCount: number;
  stopLossGridStep: number;
  activationPrice?: number;
  trailingEntry?: boolean;
  isolationStep?: number;
}

export interface EditBoxInput {
  takeProfitPrice: number;
  mainGridCount: number;
  mainGridStep: number;
  mainGridPortionSize: number;
  leverage: number;
  stopLossGridCount: number;
  stopLossGridStep: number;
  activationPrice?: number;
  trailingEntry?: boolean;
  isolationStep?: number;
}

interface BoxRow {
  id: string;
  direction: string;
  takeProfitPrice: number;
  mainGridCount: number;
  mainGridStep: number;
  stopLossGridCount: number;
  stopLossGridStep: number;
  isolationStep: number | null;
  activationPrice: number;
  trailingEntry: boolean;
}

export interface RobotSummary {
  id: string;
  symbol: string;
  direction: string;
  status: string;
  activeBoxId: string | null;
  activeSessionCode: string | null;
  managed: boolean;
  latestPrice: number | undefined;
  exchangeId: string;
  accountLabel: string;
  credentialId: string;
  boxCount: number;
  realizedPnl: number;
  totalFees: number;
  totalFunding: number;
  netPnl: number;
  totalPnl: number | null;
  activeBoxHighPrice: number | null;
  activeBoxLowPrice: number | null;
  stopStage: string | null;
  stopWarning: string | null;
  lastPositionQty: number | null;
  lastEntryPrice: number | null;
  lastUnrealizedPnl: number | null;
  lastSnapshotAt: Date | null;
  createdAt: string;
  endedAt: string | null;
}

export interface RobotDetail extends RobotSummary {
  /** 活跃 session 的当前 FSM 状态（取自 Run.state 真相源），供前端刷新时播种 FSM 时间线；无活跃 run 时为 null */
  activeFsmState: string | null;
  boxes: Array<{
    id: string;
    direction: string;
    takeProfitPrice: number;
    mainGridCount: number;
    mainGridStep: number;
    mainGridPortionSize: number;
    leverage: number;
    stopLossGridCount: number;
    stopLossGridStep: number;
    isolationStep?: number;
    activationPrice: number;
    trailingEntry: boolean;
    trailingCallbackRate: number;
    excessProfitMultiplier: number;
    reorderThreshold: number;
    enabled: boolean;
    realizedPnl: number;
    totalFees: number;
    totalSavings: number;
    netPnl: number;
  }>;
}

@Injectable()
export class BotManagerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(BotManagerService.name);
  private schedulers = new Map<string, RobotScheduler>();
  private activeSessionCode = new Map<string, string>();
  private boxCache = new Map<string, BoxCandidate[]>();
  /** 箱体缓存最后刷新时间。feedPrice 每个 tick 都会走 refreshBoxes，无 TTL
   * 时高频行情把 box.findMany 打成连接池雪崩（2026-06-12 实测拖垮订单持久化）。 */
  private boxCacheRefreshedAt = new Map<string, number>();
  /** 进行中的刷新共享同一个 promise：TTL 过期瞬间高频 tick 并发涌入会各自
   * 发起 findMany（时间戳在查询完成后才写），把连接池踩踏到上限。 */
  private boxRefreshInFlight = new Map<string, Promise<void>>();
  private static readonly BOX_CACHE_TTL_MS = 3000;
  private unsubscribers = new Map<string, () => void>();
  private latestPrice = new Map<string, number>();
  /** 恢复/重启恢复活跃箱后，待在首个有价 tick 复核"价格是否已离开该箱窗口"（item2）。 */
  private restoredActiveBoxRecheck = new Set<string>();
  /** 正在跑停止 job 的 robotId，防止重复点击/重启并发重入。 */
  private stoppingRobots = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    // launcher 类型是 RunnerLauncher 接口(无运行时 token),用 @Inject 指向具体 TES;依赖单向,无循环。
    @Inject(TradingEngineService) private readonly launcher: RunnerLauncher,
    @Inject('BOT_MANAGER_TICKER_SOURCE') private readonly tickerSource: TickerSource,
    private readonly accountSnapshot: AccountSnapshotService,
    private readonly notificationService: NotificationService,
    private readonly pnlLedger: PnlLedgerService,
  ) {
    // 反向边:runner 自动终止时回调本服务,替代 runner 层对 BotManager 的直接引用(打破循环依赖)。
    this.launcher.setOnBoxTerminated((robotId, configId) => this.onBoxTerminated(robotId, configId));
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.restoreRobots();
  }

  /** 重启恢复：RUNNING 机器人重新接管；STOPPING 机器人补跑完停止 job（防中断卡死）。 */
  async restoreRobots(): Promise<void> {
    try {
      const running = await this.prisma.robot.findMany({ where: { status: 'RUNNING' } });
      for (const r of running) {
        try {
          await this.startRobot(r.id);
        } catch (err) {
          this.logger.error(`[${r.id}] restore failed: ${(err as Error).message}`);
        }
      }
      const stopping = await this.prisma.robot.findMany({ where: { status: 'STOPPING' } });
      for (const r of stopping) {
        try {
          let runCode: string | null = null;
          if (r.activeBoxId) {
            const run = await this.prisma.run.findFirst({ where: { boxId: r.activeBoxId, endedAt: null }, orderBy: { startedAt: 'desc' } });
            runCode = run?.runCode ?? null;
          }
          // 中断前的 closePosition 意图无法可靠还原：保守按"仅收尾不再平仓"恢复（runCode 多半已结束）。
          await this.runStopJob(r.id, { closePosition: false, runCode, credentialId: r.accountId, symbol: r.symbol });
        } catch (err) {
          this.logger.error(`[${r.id}] stop-resume failed: ${(err as Error).message}`);
        }
      }
    } catch (err) {
      this.logger.error(`restoreRobots failed: ${(err as Error).message}`);
    }
  }

  isManaged(robotId: string): boolean {
    return this.schedulers.has(robotId);
  }

  async listRobots(): Promise<RobotSummary[]> {
    const rows = await this.prisma.robot.findMany({
      where: { endedAt: null },
      include: { account: { select: { id: true, exchangeId: true, label: true } } },
    });
    return this.assembleRobotSummaries(rows);
  }

  /** 归档机器人列表：endedAt 非空（已终态），只读供历史查看。 */
  async listArchivedRobots(): Promise<RobotSummary[]> {
    const rows = await this.prisma.robot.findMany({
      where: { endedAt: { not: null } },
      include: { account: { select: { id: true, exchangeId: true, label: true } } },
    });
    return this.assembleRobotSummaries(rows);
  }

  /** 把 Robot 行装配成带运行时态/箱体数/PnL/箱线的 RobotSummary（活跃与归档列表共用）。 */
  private async assembleRobotSummaries(
    rows: Array<{
      id: string; symbol: string; direction: string; status: string;
      activeBoxId: string | null;
      account: { id: string; exchangeId: string; label: string };
      stopStage: string | null; stopWarning: string | null;
      lastPositionQty: number | null; lastEntryPrice: number | null;
      lastUnrealizedPnl: number | null; lastSnapshotAt: Date | null;
      createdAt?: Date; endedAt?: Date | null;
    }>,
  ): Promise<RobotSummary[]> {
    // 批量取所有箱体 + 成交(3 查询,避免 per-robot N+1)
    const robotIds = rows.map((r) => r.id);
    const boxes = robotIds.length
      ? await this.prisma.box.findMany({ where: { robotId: { in: robotIds }, deletedAt: null }, select: { id: true, robotId: true, takeProfitPrice: true, mainGridStep: true, mainGridCount: true, stopLossGridCount: true, stopLossGridStep: true, isolationStep: true } })
      : [];
    const boxesByRobot = new Map<string, string[]>();
    const boxById = new Map<string, { takeProfitPrice: number; mainGridStep: number; mainGridCount: number; stopLossGridCount: number; stopLossGridStep: number; isolationStep: number | null }>();
    for (const b of boxes as Array<{ id: string; robotId: string | null; takeProfitPrice: number; mainGridStep: number; mainGridCount: number; stopLossGridCount: number; stopLossGridStep: number; isolationStep: number | null }>) {
      boxById.set(b.id, { takeProfitPrice: b.takeProfitPrice, mainGridStep: b.mainGridStep, mainGridCount: b.mainGridCount, stopLossGridCount: b.stopLossGridCount, stopLossGridStep: b.stopLossGridStep, isolationStep: b.isolationStep });
      if (!b.robotId) continue;
      const arr = boxesByRobot.get(b.robotId) ?? [];
      arr.push(b.id);
      boxesByRobot.set(b.robotId, arr);
    }
    const allBoxIds = boxes.map((b: { id: string }) => b.id);
    const ledgerByBox = await this.pnlLedger.getBoxesLedger(allBoxIds);

    return rows.map((r) => {
      const cfgIds = boxesByRobot.get(r.id) ?? [];
      let realizedPnl = 0; let totalFees = 0; let totalFunding = 0;
      for (const cid of cfgIds) {
        const ledger = ledgerByBox.get(cid);
        if (ledger) { realizedPnl += ledger.realized; totalFees += ledger.fees; totalFunding += ledger.funding; }
      }
      realizedPnl = round8(realizedPnl);
      totalFees = round8(totalFees);
      totalFunding = round8(totalFunding);
      // funding 本期恒 0（口径单源在 PnlLedgerService.aggregateRunLedger；第2期接 FundingEvent 后此处自动生效）
      const netPnl = round8(realizedPnl - totalFees - totalFunding);
      const activeBox = r.activeBoxId ? boxById.get(r.activeBoxId) : undefined;
      // 实时未实现盈亏（DRY）：走单一来源 resolveUnrealizedPnl，账户在轮询时取内存快照，否则回退持久列。
      const liveSnap = this.accountSnapshot.getSnapshot(r.account.id);
      const lastUnrealizedPnl = resolveUnrealizedPnl(liveSnap, r.symbol, r.lastUnrealizedPnl ?? null);
      const totalPnl = lastUnrealizedPnl == null ? null : round8(netPnl + lastUnrealizedPnl);
      return {
        id: r.id,
        symbol: r.symbol,
        direction: r.direction,
        status: r.status,
        activeBoxId: r.activeBoxId,
        activeSessionCode: this.activeSessionCode.get(r.id) ?? null,
        managed: this.schedulers.has(r.id),
        latestPrice: this.latestPrice.get(r.id),
        exchangeId: r.account.exchangeId,
        accountLabel: r.account.label,
        credentialId: r.account.id,
        boxCount: cfgIds.length,
        realizedPnl,
        totalFees,
        totalFunding,
        netPnl,
        totalPnl,
        activeBoxHighPrice: activeBox
          ? deriveBoxLines({ ...activeBox, direction: r.direction as 'LONG' | 'SHORT', isolationStep: activeBox.isolationStep ?? activeBox.stopLossGridStep }).boxHighPrice
          : null,
        activeBoxLowPrice: activeBox
          ? deriveBoxLines({ ...activeBox, direction: r.direction as 'LONG' | 'SHORT', isolationStep: activeBox.isolationStep ?? activeBox.stopLossGridStep }).boxLowPrice
          : null,
        stopStage: r.status === 'STOPPING' ? (r.stopStage ?? null) : null,
        stopWarning: r.status === 'STOPPED' ? (r.stopWarning ?? null) : null,
        lastPositionQty: r.lastPositionQty ?? null,
        lastEntryPrice: r.lastEntryPrice ?? null,
        lastUnrealizedPnl,
        lastSnapshotAt: r.lastSnapshotAt ?? null,
        createdAt: r.createdAt ? r.createdAt.toISOString() : '',
        endedAt: r.endedAt ? r.endedAt.toISOString() : null,
      };
    });
  }

  async createRobot(input: CreateRobotInput): Promise<{ id: string }> {
    if (input.direction !== 'LONG' && input.direction !== 'SHORT') {
      throw new BadRequestException(`Invalid direction: ${input.direction}`);
    }
    // clientOrderId 长度预算预检：超预算 symbol 运行期才发现就是紧急止损
    // 每 tick 的 CLIENT_ID_TOO_LONG（且止损永远不在位），必须在创建时拒绝。
    const account = await this.prisma.exchangeAccount.findUnique({
      where: { id: input.credentialId },
      select: { exchangeId: true },
    });
    const symbolTokenLimit = SYMBOL_TOKEN_LIMIT_BY_EXCHANGE[account?.exchangeId ?? ''];
    const symbolToken = input.symbol.replace(/[/\\]/g, '');
    if (symbolTokenLimit && symbolToken.length > symbolTokenLimit) {
      throw new BadRequestException({
        code: 'SYMBOL_TOO_LONG_FOR_EXCHANGE',
        message: `Symbol ${input.symbol} exceeds ${account!.exchangeId} clientOrderId budget (${symbolToken.length} > ${symbolTokenLimit})`,
      });
    }
    // 合约可交易性校验：symbol 不存在于交易所时提前拒绝，避免运行期才发现。
    await this.launcher.assertSymbolTradable(input.credentialId, input.symbol);
    // 唯一性不变量：同一 (exchangeUid, symbol) 至多一个未结束机器人。
    const dup = await this.prisma.robot.findFirst({
      where: { exchangeUid: input.exchangeAccountId, symbol: input.symbol, endedAt: null },
    });
    if (dup) {
      throw new ConflictException({ code: 'ROBOT_DUPLICATE', message: `A robot for ${input.symbol} already exists on this account` });
    }
    try {
      const created = await this.prisma.robot.create({
        data: {
          accountId: input.credentialId,
          symbol: input.symbol,
          direction: input.direction,
          exchangeUid: input.exchangeAccountId,
          status: 'PAUSED',
        } as unknown as Parameters<typeof this.prisma.robot.create>[0]['data'],
      });
      return { id: created.id };
    } catch (err) {
      // 守卫与 create 之间存在竞态窗口，由偏唯一索引兜底。把 Prisma P2002 翻成
      // 与守卫一致的友好错误，避免向客户端泄露原始 Prisma 串（含索引名）。
      if ((err as { code?: string }).code === 'P2002') {
        throw new ConflictException({ code: 'ROBOT_DUPLICATE', message: `A robot for ${input.symbol} already exists on this account` });
      }
      throw err;
    }
  }

  async getRobotDetail(robotId: string): Promise<RobotDetail | null> {
    const r = await this.prisma.robot.findUnique({
      where: { id: robotId },
      include: { account: { select: { id: true, exchangeId: true, label: true } } },
    });
    if (!r) return null;
    const account = (r as { account: { id: string; exchangeId: string; label: string } }).account;
    const boxes = await this.prisma.box.findMany({ where: { robotId, deletedAt: null } });
    const boxIds = boxes.map((b: { id: string }) => b.id);
    const ledgerByBox = await this.pnlLedger.getBoxesLedger(boxIds);
    let realizedPnl = 0; let totalFees = 0; let totalFunding = 0;
    for (const b of boxes as Array<{ id: string }>) {
      const ledger = ledgerByBox.get(b.id);
      if (ledger) { realizedPnl += ledger.realized; totalFees += ledger.fees; totalFunding += ledger.funding; }
    }
    realizedPnl = round8(realizedPnl);
    totalFees = round8(totalFees);
    totalFunding = round8(totalFunding);
    // funding 本期恒 0（口径单源在 PnlLedgerService.aggregateRunLedger；第2期接 FundingEvent 后此处自动生效）
    const netPnl = round8(realizedPnl - totalFees - totalFunding);
    const liveSnap = this.accountSnapshot.getSnapshot(account.id);
    const lastUnrealizedPnlDetail = resolveUnrealizedPnl(liveSnap, r.symbol, r.lastUnrealizedPnl ?? null);
    const totalPnl = lastUnrealizedPnlDetail == null ? null : round8(netPnl + lastUnrealizedPnlDetail);
    const activeBoxRow = r.activeBoxId ? (boxes as Array<Record<string, unknown>>).find((b) => b.id === r.activeBoxId) : undefined;
    const activeBoxLines = activeBoxRow
      ? deriveBoxLines({
          takeProfitPrice: activeBoxRow.takeProfitPrice as number,
          direction: r.direction as 'LONG' | 'SHORT',
          mainGridStep: activeBoxRow.mainGridStep as number,
          mainGridCount: activeBoxRow.mainGridCount as number,
          stopLossGridCount: activeBoxRow.stopLossGridCount as number,
          stopLossGridStep: activeBoxRow.stopLossGridStep as number,
          isolationStep: (activeBoxRow.isolationStep as number | null) ?? (activeBoxRow.stopLossGridStep as number),
        })
      : null;
    const activeBoxHighPrice = activeBoxLines?.boxHighPrice ?? null;
    const activeBoxLowPrice = activeBoxLines?.boxLowPrice ?? null;
    let activeSessionCode = this.activeSessionCode.get(robotId) ?? null;
    // 活跃箱存在时取未结束 run：既兜底解析 activeSessionCode，又读取 run.state 作为
    // FSM 播种值（Run.state 是 FSM 非终态真相源），修复刷新已运行机器人时 FSM 显示空脱线徽标。
    let activeFsmState: string | null = null;
    if (r.activeBoxId) {
      const run = await this.prisma.run.findFirst({
        where: { boxId: r.activeBoxId, endedAt: null },
        orderBy: { startedAt: 'desc' },
      });
      activeSessionCode = activeSessionCode ?? run?.runCode ?? null;
      activeFsmState = (run as { state?: string } | null)?.state ?? null;
    }
    return {
      activeFsmState,
      id: r.id,
      symbol: r.symbol,
      direction: r.direction,
      status: r.status,
      activeBoxId: r.activeBoxId,
      activeSessionCode,
      managed: this.schedulers.has(robotId),
      latestPrice: this.latestPrice.get(robotId),
      exchangeId: account.exchangeId,
      accountLabel: account.label,
      credentialId: account.id,
      boxCount: boxes.length,
      realizedPnl,
      totalFees,
      totalFunding,
      netPnl,
      totalPnl,
      activeBoxHighPrice,
      activeBoxLowPrice,
      stopStage: r.status === 'STOPPING' ? (r.stopStage ?? null) : null,
      stopWarning: r.status === 'STOPPED' ? (r.stopWarning ?? null) : null,
      lastPositionQty: r.lastPositionQty ?? null,
      lastEntryPrice: r.lastEntryPrice ?? null,
      lastUnrealizedPnl: lastUnrealizedPnlDetail,
      lastSnapshotAt: r.lastSnapshotAt ?? null,
      createdAt: r.createdAt ? r.createdAt.toISOString() : '',
      endedAt: r.endedAt ? r.endedAt.toISOString() : null,
      boxes: boxes.map((b: Record<string, unknown>) => ({
        id: b.id as string,
        direction: b.direction as string,
        takeProfitPrice: b.takeProfitPrice as number,
        mainGridCount: b.mainGridCount as number,
        mainGridStep: b.mainGridStep as number,
        mainGridPortionSize: b.mainGridPortionSize as number,
        leverage: b.leverage as number,
        stopLossGridCount: b.stopLossGridCount as number,
        stopLossGridStep: b.stopLossGridStep as number,
        isolationStep: (b.isolationStep as number | null) ?? undefined,
        activationPrice: b.activationPrice as number,
        trailingEntry: b.trailingEntry as boolean,
        trailingCallbackRate: b.trailingCallbackRate as number,
        excessProfitMultiplier: b.excessProfitMultiplier as number,
        reorderThreshold: b.reorderThreshold as number,
        enabled: b.enabled as boolean,
        realizedPnl: round8(ledgerByBox.get(b.id as string)?.realized ?? 0),
        totalFees: round8(ledgerByBox.get(b.id as string)?.fees ?? 0),
        totalSavings: round8(ledgerByBox.get(b.id as string)?.savings ?? 0),
        netPnl: round8(ledgerByBox.get(b.id as string)?.net ?? 0),
      })),
    };
  }

  getLatestPrice(robotId: string): number | undefined {
    return this.latestPrice.get(robotId);
  }

  /**
   * 归档（endedAt 非空）为终态、只读：拒绝箱体写操作（新增/编辑/删除），与 startRobot 的
   * ROBOT_ARCHIVED 守卫一致。归档机器人需新建而非在原机器人上改配置。
   */
  private assertNotArchived(robot: { endedAt: Date | null }, robotId: string, message?: string): void {
    if (robot.endedAt != null) {
      throw new BadRequestException({ code: 'ROBOT_ARCHIVED', message: message ?? `Robot ${robotId} is archived and is read-only` });
    }
  }

  async addBox(robotId: string, input: AddBoxInput): Promise<{ id: string }> {
    const robot = await this.prisma.robot.findUnique({ where: { id: robotId } });
    if (!robot) {
      throw new Error(`Robot ${robotId} not found`);
    }
    this.assertNotArchived(robot, robotId);
    const existing = (await this.prisma.box.findMany({ where: { robotId, deletedAt: null } })) as unknown as Array<{
      direction: string; takeProfitPrice: number; mainGridCount: number; mainGridStep: number;
      stopLossGridCount: number; stopLossGridStep: number; activationPrice?: number;
    }>;

    const toSpec = (b: { direction: string; takeProfitPrice: number; mainGridCount: number; mainGridStep: number; stopLossGridCount: number; stopLossGridStep: number; isolationStep?: number; activationPrice?: number }): BoxSpec => ({
      direction: b.direction,
      takeProfitPrice: b.takeProfitPrice,
      mainGridCount: b.mainGridCount,
      mainGridStep: b.mainGridStep,
      stopLossGridCount: b.stopLossGridCount,
      stopLossGridStep: b.stopLossGridStep,
      isolationStep: b.isolationStep ?? b.stopLossGridStep,
      activationPrice: b.activationPrice,
    });

    const newSpec: BoxSpec = toSpec(input);
    const result = validateBoxAddition(newSpec, existing.map(toSpec), robot.direction);
    if (!result.valid) {
      throwBoxValidationError(result.errors);
    }

    const created = await this.prisma.box.create({
      data: {
        robotId,
        accountId: robot.accountId,
        symbol: robot.symbol,
        direction: input.direction,
        takeProfitPrice: input.takeProfitPrice,
        mainGridCount: input.mainGridCount,
        mainGridStep: input.mainGridStep,
        mainGridPortionSize: input.mainGridPortionSize,
        leverage: input.leverage,
        stopLossGridCount: input.stopLossGridCount,
        stopLossGridStep: input.stopLossGridStep,
        isolationStep: input.isolationStep ?? input.stopLossGridStep,
        activationPrice: input.activationPrice ?? 0,
        trailingEntry: input.trailingEntry ?? false,
      } as unknown as Parameters<typeof this.prisma.box.create>[0]['data'],
    });
    this.invalidateBoxCache(robotId);
    return { id: created.id };
  }

  async editBox(robotId: string, configId: string, input: EditBoxInput): Promise<void> {
    const robot = await this.prisma.robot.findUnique({ where: { id: robotId } });
    if (!robot) {
      throw new Error(`Robot ${robotId} not found`);
    }
    this.assertNotArchived(robot, robotId);
    const box = await this.prisma.box.findFirst({ where: { id: configId, robotId, deletedAt: null } });
    if (!box) {
      throw new Error(`Box ${configId} not found or deleted`);
    }

    const others = (await this.prisma.box.findMany({ where: { robotId, deletedAt: null, id: { not: configId } } })) as unknown as Array<{
      direction: string; takeProfitPrice: number; mainGridCount: number; mainGridStep: number;
      stopLossGridCount: number; stopLossGridStep: number; activationPrice?: number;
    }>;
    const toSpec = (b: { direction: string; takeProfitPrice: number; mainGridCount: number; mainGridStep: number; stopLossGridCount: number; stopLossGridStep: number; isolationStep?: number; activationPrice?: number }): BoxSpec => ({
      direction: b.direction,
      takeProfitPrice: b.takeProfitPrice,
      mainGridCount: b.mainGridCount,
      mainGridStep: b.mainGridStep,
      stopLossGridCount: b.stopLossGridCount,
      stopLossGridStep: b.stopLossGridStep,
      isolationStep: b.isolationStep ?? b.stopLossGridStep,
      activationPrice: b.activationPrice,
    });
    const newSpec: BoxSpec = toSpec({ direction: (robot as unknown as { direction: string }).direction, ...input });
    const result = validateBoxAddition(newSpec, others.map(toSpec), (robot as unknown as { direction: string }).direction);
    if (!result.valid) {
      throwBoxValidationError(result.errors);
    }

    if ((robot as unknown as { activeBoxId: string | null }).activeBoxId === configId) {
      const run = await this.prisma.run.findFirst({
        where: { boxId: configId, endedAt: null },
        orderBy: { startedAt: 'desc' },
      });
      if (run) {
        await this.launcher.detachBot((run as unknown as { runCode: string }).runCode);
      }
      this.schedulers.get(robotId)?.onBoxTerminated(configId);
      this.activeSessionCode.delete(robotId);
      await this.prisma.robot.update({ where: { id: robotId }, data: { activeBoxId: null } });
    }

    await this.prisma.box.update({
      where: { id: configId },
      data: {
        takeProfitPrice: input.takeProfitPrice,
        mainGridCount: input.mainGridCount,
        mainGridStep: input.mainGridStep,
        mainGridPortionSize: input.mainGridPortionSize,
        leverage: input.leverage,
        stopLossGridCount: input.stopLossGridCount,
        stopLossGridStep: input.stopLossGridStep,
        isolationStep: input.isolationStep ?? (box as unknown as { isolationStep: number | null }).isolationStep ?? (box as unknown as { stopLossGridStep: number }).stopLossGridStep,
        // 编辑不带这两个字段时保留原值,避免静默重置激活行为(C1)
        activationPrice: input.activationPrice ?? (box as unknown as { activationPrice: number }).activationPrice,
        trailingEntry: input.trailingEntry ?? (box as unknown as { trailingEntry: boolean }).trailingEntry,
      } as unknown as Parameters<typeof this.prisma.box.update>[0]['data'],
    });
    this.invalidateBoxCache(robotId);
    this.logger.log(`[${robotId}] Edited box ${configId} (wasActive=${(robot as unknown as { activeBoxId: string | null }).activeBoxId === configId})`);
  }

  async removeBox(robotId: string, configId: string, opts: { closePosition: boolean }): Promise<void> {
    const robot = await this.prisma.robot.findUnique({ where: { id: robotId } });
    if (!robot) {
      throw new Error(`Robot ${robotId} not found`);
    }
    this.assertNotArchived(robot, robotId);

    if (robot.activeBoxId === configId) {
      // 活跃箱：找其运行 run，按 closePosition 决定平仓或仅分离（总是撤单）
      const run = await this.prisma.run.findFirst({
        where: { boxId: configId, endedAt: null },
        orderBy: { startedAt: 'desc' },
      });
      if (run) {
        if (opts.closePosition) {
          await this.launcher.stopBot(run.runCode);
        } else {
          await this.launcher.detachBot(run.runCode);
        }
      }
      const scheduler = this.schedulers.get(robotId);
      scheduler?.onBoxTerminated(configId);
      this.activeSessionCode.delete(robotId);
      await this.prisma.robot.update({ where: { id: robotId }, data: { activeBoxId: null } });
    }

    await this.prisma.box.update({ where: { id: configId }, data: { deletedAt: new Date(), enabled: false } });
    this.invalidateBoxCache(robotId);
    this.logger.log(`[${robotId}] Removed box ${configId} (closePosition=${opts.closePosition})`);
  }

  async removeInactiveBox(robotId: string, configId: string): Promise<void> {
    const robot = await this.prisma.robot.findUnique({ where: { id: robotId } });
    if (!robot) {
      throw new Error(`Robot ${robotId} not found`);
    }
    if (robot.activeBoxId === configId) {
      throw new Error(`Cannot remove active box ${configId} via removeInactiveBox; use removeBox with cancel/close options (R2)`);
    }
    await this.prisma.box.update({ where: { id: configId }, data: { deletedAt: new Date(), enabled: false } });
    this.invalidateBoxCache(robotId);
  }

  async startRobot(robotId: string): Promise<void> {
    // 幂等守卫：已在管理中则忽略，避免重复订阅泄漏旧 ticker 连接。
    if (this.schedulers.has(robotId)) return;

    const robot = await this.prisma.robot.findUnique({ where: { id: robotId } });
    if (!robot) {
      throw new Error(`Robot ${robotId} not found`);
    }

    // 归档为终态：已归档（endedAt 非空）机器人不可重启，需新建。
    this.assertNotArchived(robot, robotId, `Robot ${robotId} is archived and cannot be restarted`);

    const boxCount = await this.prisma.box.count({ where: { robotId, deletedAt: null } });
    if (boxCount === 0) {
      // 业务错误走 error-code → 前端 i18n（errors.ROBOT_NO_BOX），不在后端硬编码中文。
      throw new BadRequestException({ code: 'ROBOT_NO_BOX', message: 'Cannot start robot: at least one box is required' });
    }

    await this.prisma.robot.update({ where: { id: robotId }, data: { status: 'RUNNING' } });

    const scheduler = new RobotScheduler({
      loadBoxes: () => this.loadBoxesSync(robotId),
      activateBox: (configId, mode) => this.activate(robotId, robot.symbol, configId, mode),
      onActivationGivenUp: (configId, error) => {
        this.logger.error(
          `[${robotId}] Box ${configId} 连续激活失败已达上限，自动暂停机器人。最后一次错误: ${error.message}`,
        );
        void this.pauseRobot(robotId).catch((e) => {
          this.logger.error(`[${robotId}] 激活放弃后自动暂停失败: ${(e as Error).message}`);
        });
        const reason = (error as { code?: string }).code ?? 'UNKNOWN';
        void this.notificationService.createAndBroadcast({
          type: 'alert',
          title: 'Robot auto-paused',
          body: `${robot.symbol}: activation failed repeatedly (${reason})`,
          code: 'ROBOT_AUTO_PAUSED',
          params: { symbol: robot.symbol, reason },
        }).catch((e) => {
          this.logger.error(`[${robotId}] 自动暂停通知发送失败: ${(e as Error).message}`);
        });
      },
    });
    this.schedulers.set(robotId, scheduler);
    this.boxCache.set(robotId, []);
    await this.refreshBoxes(robotId);

    if (robot.activeBoxId) {
      const run = await this.prisma.run.findFirst({
        where: { boxId: robot.activeBoxId, endedAt: null },
        orderBy: { startedAt: 'desc' },
      });
      if (run) {
        await this.launcher.startBot(robot.activeBoxId, run.runCode);
        scheduler.markActive(robot.activeBoxId);
        this.activeSessionCode.set(robotId, run.runCode);
        // 恢复时无当前价；待首个有价 tick 复核该箱是否仍该持有（item2 越界交棒）。
        this.restoredActiveBoxRecheck.add(robotId);
      } else {
        // 活跃箱的 run 已终态（onBoxTerminated 未跑完即重启，留下悬挂 activeBoxId）：
        // 清掉它，让调度器从干净状态按当前价格重新裁决，避免详情页展示已结束的活跃箱。
        await this.prisma.robot.update({ where: { id: robotId }, data: { activeBoxId: null } });
      }
    }

    const unsubscribe = this.tickerSource.subscribe(robotId, robot.accountId, robot.symbol, (price) => {
      this.latestPrice.set(robotId, price);
      // fire-and-forget：单个 tick 处理失败（如箱体激活抛错）只记录，不得逃逸为
      // unhandled rejection（生产会污染进程、测试会非确定性误判失败）。
      void this.feedPrice(robotId, price).catch((err) => {
        this.logger.warn(`[${robotId}] feedPrice tick failed: ${(err as Error).message}`);
      });
    });
    this.unsubscribers.set(robotId, unsubscribe);
  }

  async feedPrice(robotId: string, price: number): Promise<void> {
    const scheduler = this.schedulers.get(robotId);
    if (!scheduler) return;
    await this.refreshBoxes(robotId);
    if (this.restoredActiveBoxRecheck.delete(robotId)) {
      await this.recheckRestoredActiveBox(robotId, price);
    }
    await scheduler.onTick(price);
  }

  /**
   * 恢复越界复核（item2，按箱体止损语义）：恢复活跃箱后第一个有价 tick。
   * - 活跃箱配了止损：不在此处插手，价格跌穿由 runner 的 FSM 按止损语义清算。
   * - 活跃箱无止损、且当前价已落入"其他箱体"的激活窗口：分离旧回合（保留持仓，
   *   落 SUPERSEDED/NEW_SESSION），释放活跃槽，同一 tick 由调度器激活目标箱接管（自愈）。
   * - 否则（仍在自己窗口/无其他箱接管）：维持现状。
   */
  private async recheckRestoredActiveBox(robotId: string, price: number): Promise<void> {
    const scheduler = this.schedulers.get(robotId);
    const activeBoxId = scheduler?.activeBox;
    if (!scheduler || !activeBoxId) return;

    const boxes = this.loadBoxesSync(robotId);
    const activeBox = boxes.find((b) => b.configId === activeBoxId);
    if (!activeBox || activeBox.stopLossGridCount > 0) return;

    const target = decideBoxActivation({
      price,
      lastPrice: null,
      hasActiveBox: false,
      boxes: boxes.filter((b) => b.configId !== activeBoxId),
    });
    if (!target) return;

    const oldSession = this.activeSessionCode.get(robotId);
    if (oldSession) {
      try {
        await this.launcher.detachBot(oldSession, { state: 'SUPERSEDED', exitReason: 'NEW_SESSION' });
      } catch (e) {
        this.logger.warn(`[${robotId}] 恢复越界分离旧回合失败: ${(e as Error).message}`);
      }
    }
    scheduler.onBoxTerminated(activeBoxId);
    this.activeSessionCode.delete(robotId);
    await this.prisma.robot.update({ where: { id: robotId }, data: { activeBoxId: null } });
    this.logger.log(`[${robotId}] 恢复越界：无止损活跃箱 ${activeBoxId} 价已进入 ${target.configId} 窗口，分离交棒`);
  }

  async onBoxTerminated(robotId: string, configId: string): Promise<void> {
    const scheduler = this.schedulers.get(robotId);
    if (!scheduler) return;
    scheduler.onBoxTerminated(configId);
    this.activeSessionCode.delete(robotId);
    await this.prisma.robot.update({ where: { id: robotId }, data: { activeBoxId: null } });
  }

  async pauseRobot(robotId: string): Promise<void> {
    const robot = await this.prisma.robot.findUnique({ where: { id: robotId } });
    if (robot) this.assertNotArchived(robot, robotId);

    this.unsubscribers.get(robotId)?.();
    this.unsubscribers.delete(robotId);
    this.latestPrice.delete(robotId);
    this.schedulers.delete(robotId);

    if (robot?.activeBoxId) {
      const run = await this.prisma.run.findFirst({
        where: { boxId: robot.activeBoxId, endedAt: null },
        orderBy: { startedAt: 'desc' },
      });
      if (run) {
        await this.launcher.pauseBot(run.runCode);
      }
    }
    await this.prisma.robot.update({ where: { id: robotId }, data: { status: 'PAUSED' } });
  }

  /** 即时返回：置 STOPPING 并 fire-and-forget 后台停止 job。幂等：已 STOPPING/STOPPED 不重复起 job。 */
  async requestStop(robotId: string, opts: { closePosition: boolean }): Promise<{ robotId: string; status: string }> {
    const robot = await this.prisma.robot.findUnique({ where: { id: robotId } });
    if (!robot) {
      throw new Error(`Robot ${robotId} not found`);
    }
    if (robot.status === 'STOPPING' || robot.status === 'STOPPED') {
      return { robotId, status: robot.status };
    }

    // 先拆 robot 级行情订阅与调度器，防 BUG-09 幽灵 runner（清算期 onBoxTerminated 清空活动位，
    // 仍在喂价的调度器会把同一箱体再激活成新 run）。
    this.unsubscribers.get(robotId)?.();
    this.unsubscribers.delete(robotId);
    this.latestPrice.delete(robotId);
    this.schedulers.delete(robotId);

    let runCode: string | null = null;
    if (robot.activeBoxId) {
      const run = await this.prisma.run.findFirst({
        where: { boxId: robot.activeBoxId, endedAt: null },
        orderBy: { startedAt: 'desc' },
      });
      runCode = run?.runCode ?? null;
    }

    await this.prisma.robot.update({
      where: { id: robotId },
      data: { status: 'STOPPING', stopStage: 'CANCELLING_ORDERS', stopWarning: null },
    });

    void this.runStopJob(robotId, {
      closePosition: opts.closePosition,
      runCode,
      credentialId: robot.accountId,
      symbol: robot.symbol,
    }).catch((err) => {
      this.logger.error(`[${robotId}] stop job crashed: ${(err as Error).message}`);
    });

    return { robotId, status: 'STOPPING' };
  }

  /** 后台分阶段停止：撤单 →（平仓）→ 复核 + 抓快照 → 终态。绝不滞留 STOPPING。 */
  async runStopJob(
    robotId: string,
    ctx: { closePosition: boolean; runCode: string | null; credentialId: string; symbol: string },
  ): Promise<void> {
    if (this.stoppingRobots.has(robotId)) return;
    this.stoppingRobots.add(robotId);

    let stopWarning: string | null = null;
    let position: import('../account/account-snapshot.service').PositionInfo | null = null;
    let snapshotAt: Date | null = null;

    try {
      if (ctx.runCode) {
        try {
          // 单一入口：stopBot/detachBot 自身写终态 STOPPED/USER_CLOSE|USER_DETACH
          // （item1 按谁触发统一），此处不再重复写以免双写/口径分叉。
          if (ctx.closePosition) {
            await this.prisma.robot.update({ where: { id: robotId }, data: { stopStage: 'CLOSING_POSITION' } });
            const outcome = await this.launcher.stopBot(ctx.runCode);
            if (outcome.liquidationTimedOut) stopWarning = 'LIQUIDATION_TIMEOUT';
            else if (outcome.residualRemains) stopWarning = 'RESIDUAL_POSITION';
          } else {
            await this.launcher.detachBot(ctx.runCode);
          }
        } catch (err) {
          if (err instanceof NotFoundException) {
            // 重启恢复等场景：runner 已不在内存，无可撤之单/可平之仓。
            // 视为已收尾，继续走 VERIFYING 抓快照反映交易所真实残留，不记 STOP_INTERRUPTED。
            this.logger.warn(`[${robotId}] runner ${ctx.runCode} already gone during stop, skipping launcher teardown`);
          } else {
            throw err; // 真实异常仍冒泡到外层兜底 → STOP_INTERRUPTED
          }
        }

        // 兜底收敛：正常路径 stopBot/detachBot 已写终态（此处 endedAt 已非空，跳过）；
        // 仅当 runner 已消失（NotFoundException）或终态未落时补写，绝不滞留非终态。
        const run = await this.prisma.run.findFirst({ where: { runCode: ctx.runCode } });
        if (run && !run.endedAt) {
          await this.prisma.run.update({
            where: { id: run.id },
            data: { endedAt: new Date(), state: 'STOPPED', exitReason: ctx.closePosition ? 'USER_CLOSE' : 'USER_DETACH' },
          }).catch((e) => this.logger.warn(`[${robotId}] run end fallback update failed: ${(e as Error).message}`));
        }
      }

      await this.prisma.robot.update({ where: { id: robotId }, data: { stopStage: 'VERIFYING' } });
      try {
        position = await this.launcher.captureStopSnapshot(ctx.credentialId, ctx.symbol);
        snapshotAt = new Date();
      } catch (err) {
        this.logger.warn(`[${robotId}] stop snapshot capture failed: ${(err as Error).message}`);
        if (!stopWarning) stopWarning = 'SNAPSHOT_UNAVAILABLE';
      }

      this.activeSessionCode.delete(robotId);
      await this.prisma.robot.update({
        where: { id: robotId },
        data: {
          status: 'STOPPED',
          stopStage: null,
          stopWarning,
          endedAt: new Date(),
          activeBoxId: null,
          lastPositionQty: position ? position.qty : null,
          lastEntryPrice: position ? position.entryPrice : null,
          lastUnrealizedPnl: position ? position.unrealizedPnl : null,
          lastSnapshotAt: snapshotAt,
        },
      });
    } catch (err) {
      // 兜底：任何未预期异常都收敛到 STOPPED，绝不卡 STOPPING。
      this.logger.error(`[${robotId}] runStopJob unexpected error: ${(err as Error).message}`);
      await this.prisma.robot.update({
        where: { id: robotId },
        data: { status: 'STOPPED', stopStage: null, stopWarning: stopWarning ?? 'STOP_INTERRUPTED', endedAt: new Date(), activeBoxId: null },
      }).catch(() => undefined);
    } finally {
      this.stoppingRobots.delete(robotId);
    }
  }

  /** 箱体变更（增/改/删）后调用，使下一个 tick 立即看到最新箱体。 */
  invalidateBoxCache(robotId: string): void {
    this.boxCacheRefreshedAt.delete(robotId);
  }

  private refreshBoxes(robotId: string): Promise<void> {
    const refreshedAt = this.boxCacheRefreshedAt.get(robotId);
    if (refreshedAt != null && Date.now() - refreshedAt < BotManagerService.BOX_CACHE_TTL_MS) {
      return Promise.resolve();
    }
    const inFlight = this.boxRefreshInFlight.get(robotId);
    if (inFlight) {
      return inFlight;
    }
    const refresh = (async () => {
      try {
        const rows = (await this.prisma.box.findMany({
          where: { robotId, enabled: true, deletedAt: null },
          // 确定性顺序：decideBoxActivation 命中即返回第一个，激活窗口相邻时
          // 选箱不能依赖 DB 默认返回顺序（非确定）。按创建时间稳定排序。
          orderBy: { createdAt: 'asc' },
        })) as unknown as BoxRow[];
        this.boxCache.set(robotId, rows.map(mapBoxRowToCandidate));
        this.boxCacheRefreshedAt.set(robotId, Date.now());
      } finally {
        this.boxRefreshInFlight.delete(robotId);
      }
    })();
    this.boxRefreshInFlight.set(robotId, refresh);
    return refresh;
  }

  private loadBoxesSync(robotId: string): BoxCandidate[] {
    return this.boxCache.get(robotId) ?? [];
  }

  private async activate(robotId: string, symbol: string, configId: string, mode: EntryMode): Promise<void> {
    const oldSessionCode = this.activeSessionCode.get(robotId);
    if (oldSessionCode) {
      try {
        // 系统切箱：旧回合落 SUPERSEDED/NEW_SESSION（item1 按谁触发统一），区别于
        // 用户分离的 USER_DETACH。
        const { cancelFailed } = await this.launcher.detachBot(oldSessionCode, { state: 'SUPERSEDED', exitReason: 'NEW_SESSION' });
        if (cancelFailed.length > 0) {
          this.logger.warn(
            `[${robotId}] Old session ${oldSessionCode} had ${cancelFailed.length} uncancelled orders, new runner will clean up`,
          );
        }
      } catch {
        this.logger.warn(`[${robotId}] Old session ${oldSessionCode} already stopped`);
      }
    }

    await this.prisma.run.updateMany({
      where: { boxId: configId, endedAt: null },
      data: { endedAt: new Date(), state: 'SUPERSEDED', exitReason: 'NEW_SESSION' },
    });
    const runCode = `${symbol.replace('/', '')}_${formatSessionTimestamp()}`;
    await this.launcher.startBot(configId, runCode, mode);
    this.activeSessionCode.set(robotId, runCode);
    await this.prisma.robot.update({ where: { id: robotId }, data: { activeBoxId: configId } });
    this.logger.log(`[${robotId}] Activated box ${configId} (${mode}) as run ${runCode}`);
  }
}

/** Box 行 → BoxCandidate。isolationStep 读真实列，无值时回退 stopLossGridStep。 */
function mapBoxRowToCandidate(row: BoxRow): BoxCandidate {
  return {
    configId: row.id,
    direction: row.direction as 'LONG' | 'SHORT',
    takeProfitPrice: row.takeProfitPrice,
    mainGridCount: row.mainGridCount,
    mainGridStep: row.mainGridStep,
    stopLossGridCount: row.stopLossGridCount,
    stopLossGridStep: row.stopLossGridStep,
    isolationStep: row.isolationStep ?? row.stopLossGridStep,
    activationPrice: row.activationPrice,
    trailingEntry: row.trailingEntry,
  };
}
