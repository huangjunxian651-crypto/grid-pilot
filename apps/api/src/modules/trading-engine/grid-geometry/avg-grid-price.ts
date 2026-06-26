import { toPrice } from '@gridpilot/shared-types';
import type { BoxTargetConfig as TargetPositionConfig } from '@gridpilot/shared-types';

export interface FillSavingsInput {
  side: 'BUY' | 'SELL';
  price: number;
  config: TargetPositionConfig;
  preOrderPosition: number;
  prevFilledQty: number;
  thisFillQty: number;
  /** 进入箱体时的市价建仓：传统网格也会同样建仓，非网格往返超额收益，savings 记 0。 */
  isEntry?: boolean;
  /** 订单类型；CLOSE（关闭机器人/止损平仓）非网格往返，savings 记 0。 */
  orderType?: string;
}
export interface FillSavingsResult {
  avgGridPrice: number;
  savings: number;
  savingsRate: number;
}

const ZERO: FillSavingsResult = { avgGridPrice: 0, savings: 0, savingsRate: 0 };
const EPS = 1e-9;

/**
 * 计算单笔成交的「平均网格价」与策略节省（savings）。
 *
 * 口径（与策略设计一致，详见 docs 与团队讨论）：网格价**只由这笔成交实际走过的持仓区间**决定，
 * 与成交价无关。把持仓区间 [起, 止] 按 portion 切成若干「格」(cell)，每跨越一格 m：
 *   - 加仓（LONG 买 / SHORT 卖）→ 取它**到达**的更深一档线 toPrice((m+1)·step)
 *   - 减仓（LONG 卖 / SHORT 买）→ 取它**到达**的更浅一档线 toPrice(m·step)
 * 按跨越量加权平均即平均网格价。`prevFilledQty` 让同一张单的多次部分成交沿持仓顺序结转。
 *
 * 历史 bug：旧实现用 `computeTargetPosition(成交价)` 反推目标来定格，追价成交落在网格线上方一丝时
 * 目标差额塌缩为 0 → 平均网格价 0 → 前端「—」。改为按持仓区间归属后，与成交价边界无关。
 *
 * savings 仍按真实成交价与网格线之差计：买单 (网格价−成交价)×量；卖单 (成交价−网格价)×量。
 * 主网格以外（隔离/止损区，持仓档 ≥ mainGridCount）暂不归属，返回 0（前端显示「—」）。
 */
export function computeFillSavings(input: FillSavingsInput): FillSavingsResult {
  const { side, price, config, preOrderPosition, prevFilledQty, thisFillQty } = input;
  // 进场市价建仓与关闭平仓都不是网格买卖往返：传统网格进出场也会做同样的市价操作，
  // 不存在「相对网格线的额外价差」，故不计超额收益（savings/网格价均归 0，前端显示「—」）。
  if (input.isEntry || input.orderType === 'CLOSE') return ZERO;
  const portion = config.mainGridPortionSize;
  if (!(portion > 0) || !(thisFillQty > EPS)) return ZERO;

  const isAdd =
    (config.direction === 'LONG' && side === 'BUY') ||
    (config.direction === 'SHORT' && side === 'SELL');

  const posMag = Math.abs(preOrderPosition);
  // 这张单在「本笔成交之前」已经到达的持仓幅度（按已成交量沿持仓方向结转）。
  const startMag = isAdd
    ? posMag + prevFilledQty
    : Math.max(0, posMag - prevFilledQty);
  // 本笔成交把持仓推到的幅度。
  const endMag = isAdd ? startMag + thisFillQty : Math.max(0, startMag - thisFillQty);

  // 以 portion 为单位的持仓区间 [lo, hi]（无方向，纯幅度）。
  const lo = Math.min(startMag, endMag) / portion;
  const hi = Math.max(startMag, endMag) / portion;
  if (!(hi - lo > EPS)) return ZERO;

  let weightedSum = 0;
  let takenWeight = 0;
  const firstCell = Math.floor(lo + EPS);
  const lastCell = Math.ceil(hi - EPS) - 1;
  for (let cell = firstCell; cell <= lastCell; cell++) {
    const cellLo = Math.max(lo, cell);
    const cellHi = Math.min(hi, cell + 1);
    const weight = cellHi - cellLo;
    if (weight <= EPS) continue;
    // 仅主网格内的格参与归属（隔离/止损区几何不同，暂不归属）。
    if (cell < 0 || cell >= config.mainGridCount) continue;
    const depth = (isAdd ? cell + 1 : cell) * config.mainGridStep;
    const line = toPrice(depth, config);
    weightedSum += line * weight;
    takenWeight += weight;
  }
  if (takenWeight <= EPS) return ZERO;

  const avgGridPrice = weightedSum / takenWeight;
  const savings =
    side === 'SELL'
      ? (price - avgGridPrice) * thisFillQty
      : (avgGridPrice - price) * thisFillQty;
  const actualValue = price * thisFillQty;
  const savingsRate = actualValue > 0 ? savings / actualValue : 0;
  return { avgGridPrice, savings, savingsRate };
}
