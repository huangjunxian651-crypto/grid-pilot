import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

export interface LedgerTotals {
  realized: number; fees: number; funding: number; savings: number; net: number;
}
export const round8 = (v: number): number => Math.round(v * 1e8) / 1e8;

/** 单一聚合口径：savings 单列、绝不并入 net；funding 累加自 Run.totalFunding。 */
export function aggregateRunLedger(
  runs: Array<{ realizedPnl: number; totalFees: number; totalSavings: number; totalFunding: number }>,
): LedgerTotals {
  let realized = 0, fees = 0, savings = 0, funding = 0;
  for (const r of runs) { realized += r.realizedPnl ?? 0; fees += r.totalFees ?? 0; savings += r.totalSavings ?? 0; funding += r.totalFunding ?? 0; }
  return { realized: round8(realized), fees: round8(fees), funding: round8(funding), savings: round8(savings), net: round8(realized - fees - funding) };
}

@Injectable()
export class PnlLedgerService {
  constructor(private readonly prisma: PrismaService) {}

  async getBoxesLedger(boxIds: string[]): Promise<Map<string, LedgerTotals>> {
    const out = new Map<string, LedgerTotals>();
    if (boxIds.length === 0) return out;
    const runs = await this.prisma.run.findMany({ where: { boxId: { in: boxIds } }, select: { boxId: true, realizedPnl: true, totalFees: true, totalSavings: true, totalFunding: true } });
    const byBox = new Map<string, Array<{ realizedPnl: number; totalFees: number; totalSavings: number; totalFunding: number }>>();
    for (const r of runs) { const a = byBox.get(r.boxId) ?? []; a.push(r); byBox.set(r.boxId, a); }
    for (const id of boxIds) out.set(id, aggregateRunLedger(byBox.get(id) ?? []));
    return out;
  }
}
