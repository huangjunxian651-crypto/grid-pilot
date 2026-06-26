import {
  Controller,
  Post,
  Get,
  Delete,
  Patch,
  Body,
  Param,
  Query,
  HttpException,
  HttpStatus,
  InternalServerErrorException,
  NotFoundException,
  BadRequestException,
  UseGuards,
} from '@nestjs/common';
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
    orderId?: string | null; clientOrderId?: string | null;
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
      orderBy: { filledAt: 'desc' },
      take,
    });

    return {
      data: fills.map((f, i) => this.mapFillRow(f, fills.length - i)),
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
  ) {
    const take = limit ? (Number.isNaN(parseInt(limit, 10)) ? 50 : parseInt(limit, 10)) : 50;
    const skip = offset ? (Number.isNaN(parseInt(offset, 10)) ? 0 : parseInt(offset, 10)) : 0;

    if (type === 'FILL') {
      const [fills, total] = await Promise.all([
        this.prisma.fill.findMany({
          include: {
            run: { include: { box: { select: { id: true, symbol: true, direction: true } } } },
            order: { select: { price: true, exchangeOrderId: true, clientOrderId: true } },
          },
          orderBy: { filledAt: 'desc' },
          take,
          skip,
        }),
        this.prisma.fill.count(),
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
            },
            total - skip - i,
          ),
          configId: f.run?.box?.id ?? null,
          symbol: f.run?.box?.symbol ?? null,
          direction: f.run?.box?.direction ?? null,
        })),
        total,
        limit: take,
        offset: skip,
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
      ? await this.prisma.fill.findMany({ where: { runId: { in: runIds } }, orderBy: { filledAt: 'desc' }, take })
      : [];
    return {
      data: fills.map((f, i) => this.mapFillRow(f, fills.length - i)),
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
        order: { select: { price: true, exchangeOrderId: true, clientOrderId: true } },
      },
      orderBy: [{ filledAt: 'desc' }, { id: 'desc' }],
      take,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const summary = await this.savings.getRobotSummaryMetrics(robotId);

    return {
      data: fills.map((f, i) => this.mapFillRow({ ...f, boxId: f.run.boxId ?? undefined, orderPrice: f.order?.price, orderId: f.order?.exchangeOrderId, clientOrderId: f.order?.clientOrderId }, fills.length - i)),
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
}
