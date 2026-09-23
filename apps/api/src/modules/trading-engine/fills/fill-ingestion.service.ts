import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import type { FillEvent } from '../types/exchange.types';
import { computeFillSavings } from '../grid-geometry/avg-grid-price';
import type { BoxTargetConfig as TargetPositionConfig } from '@gridpilot/shared-types';
import { applyFillToPnlState } from './compute-pnl-delta';
import { feeInQuote } from './fee-conversion';
import { parseAlgoClientOrderId, ownsSessionAlgoClientOrderId, parseClientOrderId, sessionToken } from '../../exchange/adapters/utils';
import { RECONCILE_ROLLBACK_MS } from './reconcile-window';

/**
 * order-before-fill 竞态宽限窗：成交可能在其 Order 行（onOrderPlaced 的 fire-and-forget
 * create）提交前到达。窗口内的孤儿成交一律不补建，留给 reconcile sweep 重拉自愈（行稍后会
 * 出现），避免用 fill 反推的残缺行（无 gridIndex/preOrderPosition）顶掉随后正常落库的完整行。
 * 早于本窗口仍孤儿的，判定为「行永久丢失」（create 抛错或进程在下单后落库前重启），方按 fill
 * 兜底补建以挽回已实现盈亏与持仓。
 * 正确性约束：须 ≥ reconcile 重拉的回滚窗，否则窗口内孤儿会在自愈前被误补建 → 复用同一常量。
 */
const ORDER_BEFORE_FILL_GRACE_MS = RECONCILE_ROLLBACK_MS;

export type IngestableFill = FillEvent & {
  clientOrderId?: string;
  side?: 'BUY' | 'SELL';
};

@Injectable()
export class FillIngestionService {
  private readonly logger = new Logger(FillIngestionService.name);
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 每 run 的已实现盈亏权威缓存（= DB Run.realizedPnl）。WS 泵与 REST 对账两条摄入
   * 路径都经 ingestInner，故此处单点维护即覆盖全部成交。getStatus 同步读它，避免详情页
   * 取 runner 内存 stats.realizedPnl（从不累加，恒 0）而显示 $0（BUG-01）。
   */
  private readonly realizedPnlByRun = new Map<string, number>();

  /** 供 getStatus 同步读取该 run 的已实现盈亏；未知 run 返回 undefined（调用方回退）。 */
  getCachedRealizedPnl(runCode: string): number | undefined {
    return this.realizedPnlByRun.get(runCode);
  }

  /** 冷启动/启动时用 DB Run.realizedPnl 预热缓存，使首笔成交前详情页即正确显示。 */
  seedRealizedPnl(runCode: string, value: number): void {
    this.realizedPnlByRun.set(runCode, value);
  }

  /** runner 停止时清理，避免 Map 无限增长。 */
  clearRealizedPnl(runCode: string): void {
    this.realizedPnlByRun.delete(runCode);
  }

  /**
   * 按 runCode 串行化摄入：同一 run 的多笔成交可能并发到达（WS pump fire-and-forget +
   * REST reconcile sweep），而摄入的聚合与 PnL 运行态是「事务前读基值 → 事务内写回」，
   * 并发会丢失更新（末写者覆盖、PnL 基值陈旧）。用 per-runCode promise 链强制串行，
   * 每笔都读到上一笔提交后的最新状态。单进程单例，进程内串行即正确。
   */
  private readonly chains = new Map<string, Promise<boolean>>();

  async ingest(runCode: string, event: IngestableFill): Promise<boolean> {
    const prev = this.chains.get(runCode) ?? Promise.resolve();
    const next = prev.catch(() => false).then(() => this.ingestInner(runCode, event));
    this.chains.set(runCode, next);
    // 链尾自清理，避免 Map 无限增长（仅当自己仍是链尾时删除）。
    // 末尾 .catch 吞掉「清理链」副本的 rejection（next 本身的错误由调用方 await 处理），
    // 避免 fire-and-forget 的清理链逃逸成 unhandled rejection。
    void next.finally(() => {
      if (this.chains.get(runCode) === next) this.chains.delete(runCode);
    }).catch(() => {});
    return next as Promise<boolean>;
  }

  private async ingestInner(runCode: string, event: IngestableFill): Promise<boolean> {
    const run = await this.prisma.run.findUnique({
      where: { runCode },
      include: { box: { select: { symbol: true, accountId: true } } },
    });
    if (!run) { this.logger.warn(`[${runCode}] ingest: run not found`); return false; }

    let order = await this.resolveOrder(run.id, event);
    if (!order) {
      // 本 run 算法单（紧急止损）触发的平仓成交：algo 单不经 onOrderPlaced
      // 落库，首笔成交到达时按 clientOrderId 兜底补建 CLOSE 行，否则止损
      // 平仓盈亏丢失（与 closePosition 不落库同类缺口）。
      order = await this.createOrderForOwnAlgoFill(run.id, runCode, event);
    }
    if (!order) {
      // 本 run 网格单的 Order 行永久丢失（onOrderPlaced 的 fire-and-forget create 失败/
      // 下单后落库前进程重启）时，按成交兜底补建最小网格行，否则该成交被丢弃 → 已实现
      // 盈亏漏算 + 持仓漂移。仅对早于竞态窗口的孤儿生效（详见 createOrderForOwnGridFill）。
      order = await this.createOrderForOwnGridFill(run.id, runCode, event);
    }
    if (!order) {
      // 账户级成交流会带回相邻 run（如上一个 run 的平仓单）的成交：有归属、
      // 只是不属于本 run，降为 debug；真无主的才 WARN（每个 sweep 都会重拉）。
      if (event.orderId) {
        // exchangeOrderId 仅在单交易所内唯一，限定同账户避免跨所撞号误吞告警
        const foreign = await this.prisma.order.findFirst({
          where: {
            exchangeOrderId: event.orderId,
            NOT: { runId: run.id },
            run: { box: { accountId: run.box?.accountId } },
          },
          select: { runId: true },
        });
        if (foreign) {
          this.logger.debug(`[${runCode}] ingest: fill ex=${event.orderId} belongs to another run, skipped`);
          return false;
        }
      }
      this.logger.warn(`[${runCode}] ingest: no order for clientOrderId=${event.clientOrderId} ex=${event.orderId}`);
      return false;
    }

    const exchangeFillId = event.fillId || `${event.orderId}_${event.timestamp}_${event.qty}_${event.clientOrderId ?? ''}`;

    const existing = await this.prisma.fill.findUnique({
      where: { exchangeFillId_orderId: { exchangeFillId, orderId: order.id } },
    });
    if (existing) return false;

    const side = (event.side ?? order.side) as 'BUY' | 'SELL';
    const targetConfig = this.buildConfig(run.configSnapshot as Record<string, unknown>);

    const gridIndex = order.gridIndex ?? -1;
    const r = computeFillSavings({
      side,
      price: event.price,
      config: targetConfig,
      preOrderPosition: order.preOrderPosition ?? 0,
      prevFilledQty: order.filledQty ?? 0,
      thisFillQty: event.qty,
      // 进场建仓与关闭平仓非网格往返，不计超额收益（savings 记 0，前端显示「—」）。
      isEntry: order.isEntry ?? false,
      orderType: order.orderType,
    });
    const savings = r.savings;
    const savingsRate = r.savingsRate;
    const avgGridPrice = r.avgGridPrice;

    const { state, delta } = applyFillToPnlState(
      { signedPosition: run.pnlSignedPosition, avgCost: run.pnlAvgCost },
      { side, qty: event.qty, price: event.price },
    );

    const feeRaw = event.commission ?? 0;
    const feeQuote = feeInQuote(feeRaw, event.commissionAsset, run.box?.symbol ?? '', event.price);

    const prevFilled = order.filledQty ?? 0;
    const newFilledQty = prevFilled + event.qty;
    const newAvg = order.avgFillPrice && prevFilled
      ? (order.avgFillPrice * prevFilled + event.price * event.qty) / newFilledQty
      : event.price;
    const status = newFilledQty + 1e-12 >= (order.qty ?? newFilledQty) ? 'FILLED' : 'PARTIALLY_FILLED';

    try {
      await this.prisma.$transaction([
        this.prisma.fill.create({
          data: {
            orderId: order.id,
            runId: run.id,
            exchangeFillId,
            side,
            qty: event.qty,
            price: event.price,
            notional: event.qty * event.price,
            fee: feeRaw,
            feeAsset: event.commissionAsset ?? null,
            gridIndex: gridIndex >= 0 ? gridIndex : null,
            savings,
            savingsRate,
            avgGridPrice,
            realizedPnlDelta: delta,
            filledAt: new Date(event.timestamp),
          },
        }),
        this.prisma.order.update({
          where: { id: order.id },
          data: {
            filledQty: newFilledQty,
            avgFillPrice: newAvg,
            status,
            exchangeOrderId: order.exchangeOrderId ?? event.orderId,
            filledAt: status === 'FILLED' ? new Date(event.timestamp) : order.filledAt,
          },
        }),
        this.prisma.run.update({
          where: { id: run.id },
          data: {
            realizedPnl: run.realizedPnl + delta,
            totalFees: run.totalFees + feeQuote,
            totalSavings: run.totalSavings + savings,
            fillCount: run.fillCount + 1,
            pnlSignedPosition: state.signedPosition,
            pnlAvgCost: state.avgCost,
          },
        }),
      ]);
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') {
        this.logger.warn(`[${runCode}] ingest: duplicate fill ${exchangeFillId} (P2002), treated as already ingested`);
        return false;
      }
      throw err;
    }
    // 事务提交成功后刷新权威缓存（= DB 新的 realizedPnl），供 getStatus 同步读取。
    this.realizedPnlByRun.set(runCode, run.realizedPnl + delta);
    return true;
  }

  /**
   * 成交的 clientOrderId 可解析为本 run 的 algo id 时补建 CLOSE Order 行。
   * 并发安全：同 runCode 摄入已串行化；跨进程兜底靠 (runId, clientOrderId)
   * 唯一约束，P2002 时改查既有行。side 缺失（个别 WS 推送）时不补建，
   * 留给 REST 对账（带 side）兜底。
   */
  private async createOrderForOwnAlgoFill(runId: string, runCode: string, event: IngestableFill) {
    // 所有权判定用 ownsSessionAlgoClientOrderId，识别紧凑 `<token>A…` / 旧 verbose
    // `${runCode}_algo_…` / OKX 截断 `<token>algo…` 三态。真实 Binance/Gate 回报旧格式，
    // 旧逻辑只用严格 parseAlgoClientOrderId 识别紧凑格式 → 止损平仓成交被丢弃（BUG-A）。
    if (!event.side || !ownsSessionAlgoClientOrderId(event.clientOrderId, runCode)) return null;
    // 仅紧急止损按 CLOSE 兜底；明确为 grid 类（新格式可解析且 kind!=emergency，暂未使用）
    // 若将来用于开仓，错标 CLOSE 会污染订单语义，故跳过。
    const parsed = parseAlgoClientOrderId(event.clientOrderId);
    if (parsed && parsed.kind !== 'emergency') return null;
    try {
      return await this.prisma.order.create({
        data: {
          runId,
          clientOrderId: event.clientOrderId,
          exchangeOrderId: event.orderId || null,
          orderType: 'CLOSE',
          side: event.side,
          // 取首笔成交量：市价平仓常拆多笔，后续成交仍正常摄入（PnL 不受影响），
          // 仅 Order 行 qty/status/filledAt 以首笔口径展示
          qty: event.qty,
          price: event.price,
          gridIndex: null,
          isAlgo: true,
          status: 'PENDING',
        },
      });
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') {
        return this.prisma.order.findFirst({ where: { runId, clientOrderId: event.clientOrderId } });
      }
      throw err;
    }
  }

  /**
   * 网格单 Order 行永久丢失时，按成交兜底补建最小行。仅在以下条件全满足时补建：
   * 1) 成交早于 ORDER_BEFORE_FILL_GRACE_MS —— 排除 order-before-fill 瞬时竞态（窗口内的
   *    孤儿留给 reconcile 重拉自愈，避免残缺行顶掉随后正常落库的完整行）；
   * 2) clientOrderId 是可解析的网格单 id 且 token 属本 run —— 排除算法单/平仓单/手动单/他 run；
   * 3) 解析出的方向与成交方向自洽。
   * 补建行缺 gridIndex/preOrderPosition（无法从成交恢复），故该单超额收益(savings)无法归属、
   * 强制记 0（见下方 isEntry 注释）；但已实现盈亏只取 side/qty/price，完全正确——挽回 PnL 与持仓远胜丢弃。
   * 并发/跨进程安全：同 runCode 摄入已串行化，跨进程靠 (runId, clientOrderId) 唯一约束，P2002 改查既有行。
   */
  private async createOrderForOwnGridFill(runId: string, runCode: string, event: IngestableFill) {
    if (!event.side || !event.clientOrderId) return null;
    if (Date.now() - event.timestamp < ORDER_BEFORE_FILL_GRACE_MS) return null;
    const parsed = parseClientOrderId(event.clientOrderId);
    if (!parsed) return null;
    if (`${parsed.symbol}${parsed.time}` !== sessionToken(runCode)) return null;
    if (parsed.side !== event.side) return null;
    try {
      const order = await this.prisma.order.create({
        data: {
          runId,
          clientOrderId: event.clientOrderId,
          exchangeOrderId: event.orderId || null,
          orderType: parsed.side === 'BUY' ? 'GRID_BUY' : 'GRID_SELL',
          side: event.side,
          qty: event.qty,
          price: event.price,
          gridIndex: null,
          isAlgo: false,
          preOrderPosition: 0,
          // 真实 preOrderPosition 已永久丢失 → 超额收益无法归属。置 isEntry=true 借用
          // computeFillSavings 的短路（isEntry||CLOSE→savings 0），使该单 savings 记 0、
          // 前端显示「—」，而非凭空把成交归到最浅档算出虚高 savings 污染 Run.totalSavings。
          // isEntry 全仓仅被 computeFillSavings 消费，无其它展示/逻辑副作用。
          isEntry: true,
          status: 'PENDING',
        },
      });
      this.logger.log(
        `[${runCode}] ingest: backfilled missing grid order ${event.clientOrderId} (Order 行永久丢失，按成交补建挽回 PnL)`,
      );
      return order;
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') {
        return this.prisma.order.findFirst({ where: { runId, clientOrderId: event.clientOrderId } });
      }
      throw err;
    }
  }

  private async resolveOrder(runId: string, event: IngestableFill) {
    if (event.clientOrderId) {
      const byClient = await this.prisma.order.findFirst({
        where: { runId, clientOrderId: event.clientOrderId },
      });
      if (byClient) return byClient;
    }
    return this.prisma.order.findFirst({
      where: { runId, exchangeOrderId: event.orderId },
    });
  }

  private buildConfig(snap: Record<string, unknown>): TargetPositionConfig {
    const sls = (snap?.stopLossGridStep as number) ?? 5;
    return {
      // boxTop 是 box_top→takeProfitPrice 改名前的旧字段名；旧 run 快照只有 boxTop，
      // 不回退则 takeProfitPrice=0 → 网格价全负 → savings 爆算。
      takeProfitPrice: (snap?.takeProfitPrice as number) ?? (snap?.boxTop as number) ?? 0,
      mainGridCount: (snap?.mainGridCount as number) ?? 0,
      mainGridStep: (snap?.mainGridStep as number) ?? 0,
      mainGridPortionSize: (snap?.mainGridPortionSize as number) ?? 1,
      ...(typeof snap?.mainGridPortionValue === 'number'
        ? { mainGridPortionValue: snap.mainGridPortionValue }
        : {}),
      stopLossGridCount: (snap?.stopLossGridCount as number) ?? 0,
      stopLossGridStep: sls,
      isolationStep: (snap?.isolationStep as number | null) ?? sls,
      direction: ((snap?.direction as string) ?? 'LONG') as 'LONG' | 'SHORT',
    };
  }
}
