import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import type { BotState, Event } from '../types/bot-state.types';
import { parseClientOrderId } from '../../exchange/adapters/utils';

@Injectable()
export class PersistenceService {
  private readonly logger = new Logger(PersistenceService.name);

  constructor(private readonly prisma: PrismaService) {}

  async writeSnapshot(configId: string, state: BotState, seq: number): Promise<void> {
    try {
      await this.prisma.stateSnapshot.create({
        data: {
          configId,
          fsmState: state.fsm as unknown as Prisma.InputJsonValue,
          position: state.position as unknown as Prisma.InputJsonValue ?? undefined,
          orderManager: state.orderManager as unknown as Prisma.NullableJsonNullValueInput | Prisma.InputJsonValue,
          seq,
        },
      });
    } catch (err) {
      this.logger.error(
        `[${configId}] Failed to write snapshot: ${(err as Error).message}`,
      );
      throw err;
    }
  }

  async writeEventLog(configId: string, event: Event, seq: number, sessionCode?: string): Promise<void> {
    try {
      await this.prisma.eventLog.create({
        data: {
          configId,
          ...(sessionCode ? { sessionCode } : {}),
          eventType: event.type,
          eventData: event as unknown as Prisma.InputJsonValue,
          seq,
        },
      });
    } catch (err) {
      this.logger.error(
        `[${configId}] Failed to write event log: ${(err as Error).message}`,
      );
      throw err;
    }
  }

  async getLatestSnapshot(configId: string): Promise<{
    fsmState: unknown;
    position: unknown;
    orderManager: unknown;
    seq: number;
    createdAt: Date;
  } | null> {
    const snapshot = await this.prisma.stateSnapshot.findFirst({
      where: { configId },
      orderBy: { seq: 'desc' },
    });

    if (!snapshot) return null;

    return {
      fsmState: snapshot.fsmState,
      position: snapshot.position,
      orderManager: snapshot.orderManager ?? {},
      seq: snapshot.seq,
      createdAt: snapshot.createdAt,
    };
  }

  async getEventLogs(options?: {
    configId?: string;
    eventType?: string;
    afterSeq?: number;
    limit?: number;
    offset?: number;
    orderDesc?: boolean;
  }): Promise<{ eventType: string; eventData: unknown; seq: number; createdAt: Date; configId: string }[]> {
    const logs = await this.prisma.eventLog.findMany({
      where: {
        ...(options?.configId ? { configId: options.configId } : {}),
        ...(options?.eventType ? { eventType: options.eventType } : {}),
        ...(options?.afterSeq !== undefined ? { seq: { gt: options.afterSeq } } : {}),
      },
      orderBy: { seq: options?.orderDesc ? 'desc' : 'asc' },
      take: options?.limit ?? 100,
      skip: options?.offset ?? 0,
    });

    return logs.map((log) => ({
      eventType: log.eventType,
      eventData: log.eventData,
      seq: log.seq,
      createdAt: log.createdAt,
      configId: log.configId,
    }));
  }

  async getFillsByConfigId(configId: string, limit: number = 50): Promise<{
    fills: { id: string; eventType: string; eventData: unknown; seq: number; createdAt: Date; configId: string }[];
    total: number;
  }> {
    const where = { configId, eventType: 'FILL' };
    const [fills, total] = await Promise.all([
      this.prisma.eventLog.findMany({
        where,
        orderBy: { seq: 'desc' },
        take: limit,
      }),
      this.prisma.eventLog.count({ where }),
    ]);
    return { fills, total };
  }

  /**
   * 本 run 已落库订单 clientOrderId 的最大网格序号（无可解析订单时为 0）。
   * 冷启动恢复用：nextSeq 必须越过它，否则复用 clientOrderId 触发
   * (runId, clientOrderId) 唯一约束冲突，且成交被错误归属到旧 Order 行。
   */
  async getMaxOrderSeq(runCode: string): Promise<number> {
    const orders = await this.prisma.order.findMany({
      where: { run: { runCode } },
      select: { clientOrderId: true },
    });
    let maxSeq = 0;
    for (const o of orders) {
      const parsed = o.clientOrderId ? parseClientOrderId(o.clientOrderId) : null;
      if (parsed && parsed.seq > maxSeq) maxSeq = parsed.seq;
    }
    return maxSeq;
  }
}
