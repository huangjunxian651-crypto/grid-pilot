import {
  Controller,
  Post,
  Get,
  Delete,
  Patch,
  Body,
  Param,
  Query,
  Res,
  HttpException,
  HttpStatus,
  InternalServerErrorException,
  NotFoundException,
  BadRequestException,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { TradingEngineService } from './trading-engine.service';
import { SessionService } from './session/session.service';
import { PersistenceService } from './persistence/persistence.service';
import { SavingsService } from './savings/savings.service';
import { BotManagerService } from './robot/bot-manager.service';
import { CredentialService } from '../credential/credential.service';
import { ExchangeAdapterFactory } from '../exchange/exchange-adapter.factory';
import { AuthGuard } from '../auth/auth.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { resolveHistoryRange, bucketEquitySeries, buildCumulativeSavingsSeries, type HistoryRange } from './account/equity-history';
import { StrategyMetricsService } from './strategy-metrics/strategy-metrics.service';
import { isMetricsWindow, type MetricsWindow } from './strategy-metrics/strategy-metrics.types';

import { IsString, IsNotEmpty, IsNumber, IsInt, IsIn, IsOptional, IsBoolean } from 'class-validator';

class StartBotDto {
  @IsString()
  @IsNotEmpty()
  configId!: string;

  @IsString()
  @IsNotEmpty()
  runCode!: string;
}

class CreateRobotDto {
  @IsString() @IsNotEmpty() credentialId!: string; // maps to account ID
  @IsString() @IsNotEmpty() symbol!: string;
  @IsString() @IsIn(['LONG', 'SHORT']) direction!: string;
}

class AddBoxDto {
  @IsString() @IsIn(['LONG', 'SHORT']) direction!: string;
  @IsNumber() takeProfitPrice!: number;
  @IsInt() mainGridCount!: number;
  @IsNumber() mainGridStep!: number;
  @IsNumber() mainGridPortionSize!: number;
  @IsInt() leverage!: number;
  @IsInt() stopLossGridCount!: number;
  @IsNumber() stopLossGridStep!: number;
  @IsOptional() @IsNumber() activationPrice?: number;
  @IsOptional() @IsBoolean() trailingEntry?: boolean;
  @IsOptional() @IsNumber() isolationStep?: number;
}

class EditBoxDto {
  @IsNumber() takeProfitPrice!: number;
  @IsInt() mainGridCount!: number;
  @IsNumber() mainGridStep!: number;
  @IsNumber() mainGridPortionSize!: number;
  @IsInt() leverage!: number;
  @IsInt() stopLossGridCount!: number;
  @IsNumber() stopLossGridStep!: number;
  @IsOptional() @IsNumber() activationPrice?: number;
  @IsOptional() @IsBoolean() trailingEntry?: boolean;
  @IsOptional() @IsNumber() isolationStep?: number;
}

type RouteFilter = 'POC' | 'GTC' | 'UNKNOWN';
type FillSortBy = 'time' | 'notional' | 'realizedPnl' | 'fee';

/** listEvents(FILL) 与 events/export 共用的过滤/排序构造——避免两个接口的过滤条件漂移。 */
function buildFillEventsQuery(params: {
  robotId?: string;
  route?: RouteFilter;
  search?: string;
  since?: string;
  until?: string;
  sortBy?: FillSortBy;
  sortDir?: 'asc' | 'desc';
}) {
  const where: Record<string, unknown> = {};

  if (params.robotId) {
    where.run = { box: { robotId: params.robotId } };
  }
  if (params.route) {
    where.order = { tif: params.route === 'UNKNOWN' ? null : params.route };
  }
  if (params.search) {
    const contains = { contains: params.search, mode: 'insensitive' as const };
    where.OR = [
      { run: { box: { symbol: contains } } },
      { order: { exchangeOrderId: contains } },
      { order: { clientOrderId: contains } },
      { run: { box: { account: { label: contains } } } },
    ];
  }
  if (params.since || params.until) {
    where.filledAt = {
      ...(params.since ? { gte: new Date(params.since) } : {}),
      ...(params.until ? { lte: new Date(params.until) } : {}),
    };
  }

  const sortField: Record<FillSortBy, string> = {
    time: 'filledAt',
    notional: 'notional',
    realizedPnl: 'realizedPnlDelta',
    fee: 'fee',
  };
  const orderBy = { [sortField[params.sortBy ?? 'time']]: params.sortDir ?? 'desc' };

  return { where, orderBy };
}

@UseGuards(AuthGuard)
@Controller('trading-engine')
export class TradingEngineController {
  constructor(
    private readonly service: TradingEngineService,
    private readonly sessionService: SessionService,
    private readonly prisma: PrismaService,
    private readonly persistence: PersistenceService,
    private readonly savings: SavingsService,
    private readonly botManager: BotManagerService,
    private readonly credentials: CredentialService,
    private readonly adapterFactory: ExchangeAdapterFactory,
    private readonly strategyMetrics: StrategyMetricsService,
  ) {}

  @Post('start')
  async startBot(@Body() dto: StartBotDto) {
    try {
      const runner = await this.service.startBot(dto.configId, dto.runCode);
      const state = runner.getState();
      return {
        success: true,
        sessionCode: runner.runCode,
        sessionId: runner.runCode, // F4: alias for frontend compatibility
        state: state?.fsm.kind ?? 'UNKNOWN',
      };
    } catch (err) {
      if (err instanceof HttpException) throw err;
      throw new HttpException(
        { success: false, error: (err as Error).message },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('stop/:sessionCode')
  async stopBot(@Param('sessionCode') sessionCode: string) {
    try {
      await this.service.stopBot(sessionCode);
      return { success: true, sessionCode };
    } catch (err) {
      if (err instanceof HttpException) throw err;
      throw new HttpException(
        { success: false, error: (err as Error).message },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('pause/:sessionCode')
  async pauseBot(@Param('sessionCode') sessionCode: string) {
    try {
      await this.service.pauseBot(sessionCode);
      return { success: true, sessionCode };
    } catch (err) {
      if (err instanceof HttpException) throw err;
      throw new HttpException(
        { success: false, error: (err as Error).message },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('resume/:sessionCode')
  async resumeBot(@Param('sessionCode') sessionCode: string) {
    try {
      await this.service.resumeBot(sessionCode);
      return { success: true, sessionCode };
    } catch (err) {
      if (err instanceof HttpException) throw err;
      throw new HttpException(
        { success: false, error: (err as Error).message },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('status/:sessionCode')
  getStatus(@Param('sessionCode') sessionCode: string) {
    const status = this.service.getStatus(sessionCode);
    if (!status) {
      throw new NotFoundException(`Bot ${sessionCode} not found`);
    }
    return status;
  }

  @Get('status')
  getAllStatuses() {
    return this.service.getAllStatuses();
  }

  @Get('robots')
  async listRobots() {
    return this.botManager.listRobots();
  }

  @Get('robots/archived')
  async listArchivedRobots() {
    return this.botManager.listArchivedRobots();
  }

  @Get('robots/:id')
  async getRobot(@Param('id') id: string) {
    const detail = await this.botManager.getRobotDetail(id);
    if (!detail) {
      throw new NotFoundException(`Robot ${id} not found`);
    }
    return detail;
  }

  /** 交易所最小下单量约束，供新增/编辑箱体表单的前端实时预检使用；拉取失败透传 null
   * （前端据此跳过预检，最终由 addBox/editBox 的服务端校验兜底）。 */
  @Get('robots/:id/market-constraints')
  async getMarketConstraints(@Param('id') id: string) {
    const robot = await this.prisma.robot.findUnique({
      where: { id },
      select: { accountId: true, symbol: true },
    });
    if (!robot) {
      throw new NotFoundException(`Robot ${id} not found`);
    }
    return this.service.getMarketConstraints(robot.accountId, robot.symbol);
  }

  @Post('robots')
  async createRobot(@Body() dto: CreateRobotDto) {
    try {
      const cred = await this.credentials.findOneWithSecrets(dto.credentialId);
      if (!cred) {
        throw new NotFoundException('Credential not found');
      }
      const legacy = this.adapterFactory.createAdapter({
        exchangeId: cred.exchangeId, accountId: cred.accountId,
        apiKey: cred.apiKey, apiSecret: cred.apiSecret, passphrase: cred.passphrase ?? undefined,
        environment: cred.environment as "demo" | "live",
      });
      let exchangeAccountId: string;
      try {
        exchangeAccountId = await legacy.getAccountUid();
      } catch {
        // 业务错误走 error-code → 前端 i18n（errors.EXCHANGE_UID_RESOLUTION_FAILED），不在后端硬编码中文。
        throw new BadRequestException({ code: 'EXCHANGE_UID_RESOLUTION_FAILED', message: 'Unable to resolve exchange account identifier; check API key permissions' });
      } finally {
        legacy.destroy();
      }
      const res = await this.botManager.createRobot({
        credentialId: dto.credentialId, symbol: dto.symbol, direction: dto.direction, exchangeAccountId,
        environment: cred.environment as "demo" | "live",
      });
      return { success: true, robotId: res.id };
    } catch (err) {
      // 语义化异常（NotFound/BadRequest/Conflict 等）透传；仅真正未知错误转 500（见 apps/api/AGENTS.md）。
      if (err instanceof HttpException) throw err;
      throw new InternalServerErrorException((err as Error).message);
    }
  }

  @Post('robots/:id/start')
  async startRobot(@Param('id') id: string) {
    try {
      await this.botManager.startRobot(id);
      return { success: true, robotId: id };
    } catch (err) {
      if (err instanceof HttpException) throw err;
      throw new HttpException(
        { success: false, error: (err as Error).message },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('robots/:id/pause')
  async pauseRobot(@Param('id') id: string) {
    try {
      await this.botManager.pauseRobot(id);
      return { success: true, robotId: id };
    } catch (err) {
      if (err instanceof HttpException) throw err;
      throw new HttpException(
        { success: false, error: (err as Error).message },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('robots/:id/reconcile')
  async reconcileRobot(@Param('id') id: string) {
    try {
      const result = await this.service.reconcileRobot(id);
      return { success: true, robotId: id, ...result };
    } catch (err) {
      if (err instanceof HttpException) throw err;
      throw new HttpException(
        { success: false, error: (err as Error).message },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('robots/:id/stop')
  async stopRobot(@Param('id') id: string, @Body() body: { closePosition?: boolean }) {
    try {
      const res = await this.botManager.requestStop(id, { closePosition: body?.closePosition ?? false });
      return { success: true, robotId: res.robotId, status: res.status };
    } catch (err) {
      if (err instanceof HttpException) throw err;
      throw new HttpException(
        { success: false, error: (err as Error).message },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('robots/:id/boxes')
  async addBox(@Param('id') id: string, @Body() dto: AddBoxDto) {
    try {
      const res = await this.botManager.addBox(id, dto);
      return { success: true, boxId: res.id };
    } catch (err) {
      if (err instanceof HttpException) throw err;
      throw new HttpException({ success: false, error: (err as Error).message }, HttpStatus.BAD_REQUEST);
    }
  }

  @Delete('robots/:id/boxes/:configId')
  async removeBox(
    @Param('id') id: string,
    @Param('configId') configId: string,
    @Query('closePosition') closePosition?: string,
  ) {
    try {
      await this.botManager.removeBox(id, configId, { closePosition: closePosition === 'true' });
      return { success: true };
    } catch (err) {
      if (err instanceof HttpException) throw err;
      throw new HttpException({ success: false, error: (err as Error).message }, HttpStatus.BAD_REQUEST);
    }
  }

  @Patch('robots/:id/boxes/:configId')
  async editBox(@Param('id') id: string, @Param('configId') configId: string, @Body() dto: EditBoxDto) {
    try {
      await this.botManager.editBox(id, configId, dto);
      return { success: true };
    } catch (err) {
      if (err instanceof HttpException) throw err;
      throw new HttpException({ success: false, error: (err as Error).message }, HttpStatus.BAD_REQUEST);
    }
  }

  @Get('sessions')
  async listSessions(
    @Query('state') state?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const safeParseInt = (v: string | undefined, fallback?: number): number | undefined => {
      if (!v) return fallback;
      const n = parseInt(v, 10);
      return Number.isNaN(n) ? fallback : n;
    };
    return this.sessionService.findAll({
      state,
      limit: safeParseInt(limit),
      offset: safeParseInt(offset),
    });
  }

  @Get('sessions/:id')
  async getSession(@Param('id') id: string) {
    return this.sessionService.findOne(id);
  }

  @Get('sessions/:id/orders')
  async getSessionOrders(@Param('id') id: string) {
    return this.sessionService.findOrders(id);
  }

  /** 该 Session 的启停账户余额快照（START/STOP）：对账/展示/审计用。 */
  @Get('sessions/:id/balance-snapshots')
  async getSessionBalanceSnapshots(@Param('id') id: string) {
    return this.service.getRunBalanceSnapshots(id);
  }

  private mapFillRow(f: {
    id: string; side: string; qty: number; price: number; gridIndex: number | null;
    savings: number; savingsRate: number; fee: number; feeAsset?: string | null;
    avgGridPrice?: number | null;
    realizedPnlDelta: number; filledAt: Date; boxId?: string; orderPrice?: number | null;
    orderId?: string | null; clientOrderId?: string | null; tif?: string | null;
  }, seq: number) {
    return {
      id: f.id,
      eventType: 'FILL' as const,
      eventData: {
        side: f.side,
        fillQty: f.qty,
        fillPrice: f.price,
        gridIndex: f.gridIndex ?? -1,
        savings: f.savings,
        savingsRate: f.savingsRate,
        avgGridPrice: f.avgGridPrice || undefined,
        fee: f.fee,
        feeAsset: f.feeAsset ?? undefined,
        realizedPnlDelta: f.realizedPnlDelta,
        orderPrice: f.orderPrice ?? undefined,
        orderId: f.orderId ?? undefined,
        clientOrderId: f.clientOrderId ?? undefined,
      },
      seq,
      createdAt: f.filledAt,
      boxId: f.boxId,
      route: f.tif ?? null,
    };
  }

  @Get('fills/:sessionCode')
  async getSessionFills(
    @Param('sessionCode') sessionCode: string,
    @Query('limit') limit?: string,
  ) {
    const runCode = sessionCode; // route param kept as sessionCode for frontend URL contract
    const run = await this.prisma.run.findUnique({
      where: { runCode },
      select: { id: true, boxId: true },
    });

    if (!run) {
      throw new NotFoundException(`Session ${sessionCode} not found`);
    }

    const raw = limit ? parseInt(limit, 10) : 50;
    const take = Number.isNaN(raw) ? 50 : Math.max(1, Math.min(raw, 200));

    const fills = await this.prisma.fill.findMany({
      where: { runId: run.id },
      include: { order: { select: { tif: true } } },
      orderBy: { filledAt: 'desc' },
      take,
    });

    return {
      data: fills.map((f, i) => this.mapFillRow({ ...f, tif: f.order?.tif }, fills.length - i)),
      total: fills.length,
      limit: take,
    };
  }

  @Get('accounts')
  async getAllAccountSnapshots() {
    return this.service.refreshAllSnapshots();
  }

  @Get('account/:credentialId')
  getAccountSnapshot(@Param('credentialId') credentialId: string) {
    const snap = this.service.getAccountSnapshot(credentialId);
    if (!snap) {
      throw new NotFoundException(`Account ${credentialId} not found`);
    }
    return snap;
  }

  @Get('dashboard')
  async getDashboard() {
    const statuses = this.service.getAllStatuses();
    const [snapshots, totalFills, totalOrdersPlaced] = await Promise.all([
      this.service.refreshAllSnapshots(),
      this.prisma.fill.count(),
      this.prisma.order.count(),
    ]);
    return {
      activeBots: statuses.length,
      totalFills,
      totalOrdersPlaced,
      totalReorders: statuses.reduce((sum, s) => sum + (s.totalReorders ?? 0), 0),
      equity: snapshots.reduce((sum, s) => sum + s.totalEquity, 0),
      availableUsdt: snapshots.reduce((sum, s) => sum + s.availableUsdt, 0),
    };
  }

  @Get('events')
  async listEvents(
    @Query('type') type?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('robotId') robotId?: string,
    @Query('route') route?: RouteFilter,
    @Query('search') search?: string,
    @Query('since') since?: string,
    @Query('sortBy') sortBy?: FillSortBy,
    @Query('sortDir') sortDir?: 'asc' | 'desc',
    @Query('until') until?: string,
  ) {
    const take = limit ? (Number.isNaN(parseInt(limit, 10)) ? 50 : parseInt(limit, 10)) : 50;
    const skip = offset ? (Number.isNaN(parseInt(offset, 10)) ? 0 : parseInt(offset, 10)) : 0;

    if (type === 'FILL') {
      const { where, orderBy } = buildFillEventsQuery({ robotId, route, search, since, until, sortBy, sortDir });
      // KPI 聚合按完整 where 算全量匹配结果，不能只汇总当前页（否则翻页/切换过滤条件时数字会变）。
      // maker/gtc/unknown 三个计数各自覆盖 where.order，与用户当前选的 route 无关——这样切到
      // "只看 GTC" 的表格视图时，上方 KPI 仍能看到 POC/GTC 的完整对比分布，而不是让另一侧归零。
      const [fills, total, sums, makerCount, gtcCount, unknownRouteCount] = await Promise.all([
        this.prisma.fill.findMany({
          where,
          include: {
            run: { include: { box: { select: { id: true, symbol: true, direction: true, account: { select: { label: true } } } } } },
            order: { select: { price: true, exchangeOrderId: true, clientOrderId: true, tif: true } },
          },
          orderBy,
          take,
          skip,
        }),
        this.prisma.fill.count({ where }),
        this.prisma.fill.aggregate({ where, _sum: { fee: true, savings: true, realizedPnlDelta: true } }),
        this.prisma.fill.count({ where: { ...where, order: { tif: 'POC' } } }),
        this.prisma.fill.count({ where: { ...where, order: { tif: 'GTC' } } }),
        this.prisma.fill.count({ where: { ...where, order: { tif: null } } }),
      ]);

      return {
        // 复用 mapFillRow 统一 fill→eventData 序列化（避免与 getRobotFills 字段漂移），
        // 再覆写 /events 专有的外层 configId/symbol/direction。
        data: fills.map((f, i) => ({
          ...this.mapFillRow(
            {
              ...f,
              boxId: f.run?.box?.id ?? undefined,
              orderPrice: f.order?.price,
              orderId: f.order?.exchangeOrderId,
              clientOrderId: f.order?.clientOrderId,
              tif: f.order?.tif,
            },
            total - skip - i,
          ),
          configId: f.run?.box?.id ?? null,
          symbol: f.run?.box?.symbol ?? null,
          direction: f.run?.box?.direction ?? null,
          accountLabel: f.run?.box?.account?.label ?? null,
        })),
        total,
        limit: take,
        offset: skip,
        aggregates: {
          totalFee: sums._sum.fee ?? 0,
          totalSavings: sums._sum.savings ?? 0,
          totalRealizedPnl: sums._sum.realizedPnlDelta ?? 0,
          makerCount,
          gtcCount,
          unknownRouteCount,
        },
      };
    }

    const [logs, total] = await Promise.all([
      this.prisma.eventLog.findMany({
        where: { ...(type ? { eventType: type } : {}) },
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
      this.prisma.eventLog.count({
        where: { ...(type ? { eventType: type } : {}) },
      }),
    ]);

    const configIds = [...new Set(logs.map((l) => l.configId))];
    const configs = await this.prisma.box.findMany({
      where: { id: { in: configIds } },
      select: { id: true, symbol: true, direction: true },
    });
    const configMap = new Map(configs.map((c) => [c.id, c]));

    return {
      data: logs.map((log) => ({
        id: log.id,
        configId: log.configId,
        eventType: log.eventType,
        eventData: log.eventData,
        seq: log.seq,
        createdAt: log.createdAt,
        symbol: configMap.get(log.configId)?.symbol ?? null,
        direction: configMap.get(log.configId)?.direction ?? null,
      })),
      total,
      limit: take,
      offset: skip,
    };
  }

  /** 超过此行数拒绝导出（明确报错，让用户缩小过滤范围），而不是静默截断或让单进程扛超大结果集——
   * 这个进程同时托管真实交易 runner，一次性拉几万行 Fill 拼成大字符串会挤占内存/GC。 */
  private static readonly EXPORT_MAX_ROWS = 50000;

  /** 单元格首字符是 =/+/-/@ 时会被 Excel/Sheets 当公式解析；前置一个单引号使其保持纯文本，
   * 防止导出里的自由文本字段（如账户标签）被恶意构造成公式注入。 */
  private static escapeCsvCell(value: string): string {
    return /^[=+\-@]/.test(value) ? `'${value}` : value;
  }

  @Get('events/export')
  async exportEventsCsv(
    @Res() res: Response,
    @Query('robotId') robotId?: string,
    @Query('route') route?: RouteFilter,
    @Query('search') search?: string,
    @Query('since') since?: string,
    @Query('sortBy') sortBy?: FillSortBy,
    @Query('sortDir') sortDir?: 'asc' | 'desc',
    @Query('until') until?: string,
  ) {
    const { where, orderBy } = buildFillEventsQuery({ robotId, route, search, since, until, sortBy, sortDir });

    const total = await this.prisma.fill.count({ where });
    if (total > TradingEngineController.EXPORT_MAX_ROWS) {
      throw new BadRequestException(
        `匹配 ${total} 条记录，超过单次导出上限 ${TradingEngineController.EXPORT_MAX_ROWS} 条，请缩小过滤范围（时间段/机器人/路由）后重试`,
      );
    }

    const fills = await this.prisma.fill.findMany({
      where,
      include: {
        run: { include: { box: { select: { symbol: true, direction: true, account: { select: { label: true } } } } } },
        order: { select: { exchangeOrderId: true, clientOrderId: true, tif: true } },
      },
      orderBy,
    });

    const header = ['时间', '交易对', '账户', '方向', '格号', '价格', '数量', '成交额', '路由', '手续费', '超额收益', '已实现盈亏', '交易所订单号'];
    const rows = fills.map((f) => [
      f.filledAt.toISOString(),
      f.run?.box?.symbol ?? '',
      f.run?.box?.account?.label ?? '',
      f.side,
      f.gridIndex ?? '',
      f.price,
      f.qty,
      f.notional ?? f.qty * f.price,
      f.order?.tif ?? '',
      f.fee,
      f.savings,
      f.realizedPnlDelta,
      f.order?.exchangeOrderId ?? '',
    ]);
    const csvBody = [header, ...rows]
      .map((row) => row.map((cell) => `"${TradingEngineController.escapeCsvCell(String(cell)).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const csv = '﻿' + csvBody; // UTF-8 BOM，Excel 打开中文不乱码

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="history-${Date.now()}.csv"`);
    res.send(csv);
  }

  @Get('configs/:configId/pnl')
  async getConfigPnl(@Param('configId') configId: string) {
    return this.savings.getRealizedPnlByConfig(configId);
  }

  @Get('configs/:configId/fills')
  async getConfigFills(@Param('configId') configId: string, @Query('limit') limit?: string) {
    const raw = limit ? parseInt(limit, 10) : 50;
    const take = Number.isNaN(raw) ? 50 : Math.max(1, Math.min(raw, 200));
    const box = await this.prisma.box.findUnique({ where: { id: configId }, include: { runs: { select: { id: true } } } });
    const runIds = (box?.runs ?? []).map((r) => r.id);
    const fills = runIds.length
      ? await this.prisma.fill.findMany({
          where: { runId: { in: runIds } },
          include: { order: { select: { tif: true } } },
          orderBy: { filledAt: 'desc' },
          take,
        })
      : [];
    return {
      data: fills.map((f, i) => this.mapFillRow({ ...f, tif: f.order?.tif }, fills.length - i)),
      total: fills.length,
      limit: take,
    };
  }

  @Get('robots/:id/fills')
  async getRobotFills(
    @Param('id') robotId: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
    @Query('orderSearch') orderSearch?: string,
  ) {
    const robot = await this.botManager.getRobotDetail(robotId);
    if (!robot) {
      throw new NotFoundException(`Robot ${robotId} not found`);
    }

    const raw = limit ? parseInt(limit, 10) : 50;
    const take = Number.isNaN(raw) ? 50 : Math.max(1, Math.min(raw, 200));

    const boxRows = await this.prisma.box.findMany({
      where: { robotId },
      select: {
        id: true, direction: true, takeProfitPrice: true, mainGridCount: true,
        mainGridStep: true, stopLossGridCount: true, stopLossGridStep: true,
        isolationStep: true, activationPrice: true,
      },
    });
    const boxes: Record<string, unknown> = {};
    for (const b of boxRows) boxes[b.id] = b;

    const fills = await this.prisma.fill.findMany({
      where: {
        run: { box: { robotId } },
        ...(orderSearch
          ? { order: { OR: [{ exchangeOrderId: orderSearch }, { clientOrderId: orderSearch }] } }
          : {}),
      },
      include: {
        run: { select: { boxId: true } },
        order: { select: { price: true, exchangeOrderId: true, clientOrderId: true, tif: true } },
      },
      orderBy: [{ filledAt: 'desc' }, { id: 'desc' }],
      take,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const summary = await this.savings.getRobotSummaryMetrics(robotId);

    return {
      data: fills.map((f, i) => this.mapFillRow({ ...f, boxId: f.run.boxId ?? undefined, orderPrice: f.order?.price, orderId: f.order?.exchangeOrderId, clientOrderId: f.order?.clientOrderId, tif: f.order?.tif }, fills.length - i)),
      boxes,
      summary,
      total: fills.length,
      limit: take,
      nextCursor: fills.length === take ? fills[fills.length - 1].id : null,
    };
  }

  @Get('savings/config/:configId')
  async getConfigSavings(
    @Param('configId') configId: string,
    @Query('limit') limit?: string,
  ) {
    const raw = limit ? parseInt(limit, 10) : 100;
    const take = Number.isNaN(raw) ? 100 : Math.max(1, Math.min(raw, 500));

    try {
      return await this.savings.getSavingsSummary(configId, take);
    } catch (err) {
      if (err instanceof HttpException) throw err;
      throw new InternalServerErrorException({ success: false, error: (err as Error).message });
    }
  }

  @Get('savings/session/:sessionCode')
  async getSessionSavings(
    @Param('sessionCode') sessionCode: string,
    @Query('limit') limit?: string,
  ) {
    const raw = limit ? parseInt(limit, 10) : 100;
    const take = Number.isNaN(raw) ? 100 : Math.max(1, Math.min(raw, 500));

    try {
      return await this.savings.getSavingsSummaryBySession(sessionCode, take);
    } catch (err) {
      if (err instanceof HttpException) throw err;
      throw new InternalServerErrorException({ success: false, error: (err as Error).message });
    }
  }

  /** P2-1 权益曲线：EquitySnapshot 时序按档位预聚合（跨 credential carry-forward 求和）。 */
  @Get('equity/history')
  async getEquityHistory(@Query('range') range?: string) {
    const resolved = (range ?? '7d') as HistoryRange;
    // all 档先取最老点算跨度，自适应桶宽守住响应点数上限（评审 I-1）
    const oldest = resolved === 'all'
      ? await this.prisma.equitySnapshot.findFirst({ orderBy: { capturedAt: 'asc' }, select: { capturedAt: true } })
      : null;
    const { sinceMs, bucketMs } = resolveHistoryRange(resolved, Date.now(), oldest?.capturedAt.getTime());
    const rows = await this.prisma.equitySnapshot.findMany({
      where: { capturedAt: { gte: new Date(sinceMs) } },
      orderBy: { capturedAt: 'asc' },
      select: { credentialId: true, totalEquity: true, capturedAt: true },
    });
    return { series: bucketEquitySeries(rows, bucketMs), bucketMs };
  }

  /** P2-1 Alpha 曲线：由 Fill.savings 派生的窗口内累计序列（不建新表）。 */
  @Get('savings/history')
  async getSavingsHistory(@Query('range') range?: string) {
    const resolved = (range ?? '7d') as HistoryRange;
    const oldest = resolved === 'all'
      ? await this.prisma.fill.findFirst({ orderBy: { filledAt: 'asc' }, select: { filledAt: true } })
      : null;
    const { sinceMs, bucketMs } = resolveHistoryRange(resolved, Date.now(), oldest?.filledAt.getTime());
    const fills = await this.prisma.fill.findMany({
      where: { filledAt: { gte: new Date(sinceMs) } },
      orderBy: { filledAt: 'asc' },
      select: { savings: true, filledAt: true },
    });
    return { series: buildCumulativeSavingsSeries(fills, bucketMs), bucketMs };
  }

  /** 策略评价指标：窗口内全部 RUNNING 机器人 + 汇总行（口径见 spec，逐笔可复算）。 */
  @Get('metrics/strategy')
  async getStrategyMetrics(@Query('window') window?: string) {
    const w = this.parseWindow(window);
    try {
      return await this.strategyMetrics.getStrategyMetrics(w);
    } catch (err) {
      if (err instanceof HttpException) throw err;
      throw new InternalServerErrorException({ success: false, error: (err as Error).message });
    }
  }

  /** 单机器人明细曲线：窗口内累计净盈亏 + 累计 alpha。 */
  @Get('metrics/strategy/series')
  async getStrategySeries(@Query('robotId') robotId?: string, @Query('window') window?: string) {
    if (!robotId) throw new BadRequestException({ success: false, error: 'robotId is required' });
    const w = this.parseWindow(window);
    try {
      return await this.strategyMetrics.getStrategySeries(robotId, w);
    } catch (err) {
      if (err instanceof HttpException) throw err;
      throw new InternalServerErrorException({ success: false, error: (err as Error).message });
    }
  }

  private parseWindow(raw: string | undefined): MetricsWindow {
    const w = raw ?? '24h';
    if (!isMetricsWindow(w)) {
      throw new BadRequestException({ success: false, error: `invalid window: ${w} (expected 24h|7d|30d)` });
    }
    return w;
  }
}
