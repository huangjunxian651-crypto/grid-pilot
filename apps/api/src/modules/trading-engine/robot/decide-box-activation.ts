import { deriveBoxLines, toDistance, type BoxDirection } from '@gridpilot/shared-types';

export interface BoxCandidate {
  configId: string;
  direction: BoxDirection;
  takeProfitPrice: number;
  mainGridCount: number;
  mainGridStep: number;
  stopLossGridCount: number;
  stopLossGridStep: number;
  isolationStep: number;
  /** 0 表示用默认主网格中点 */
  activationPrice: number;
  trailingEntry: boolean;
}

export interface ActivationInput {
  price: number;
  /** 上一次观测价格；null 表示无历史（视作从止盈侧进入，走追踪建仓） */
  lastPrice: number | null;
  hasActiveBox: boolean;
  boxes: BoxCandidate[];
}

export type EntryMode = 'TRAILING_ENTRY' | 'RUNNING';

export interface ActivationDecision {
  configId: string;
  mode: EntryMode;
}

/**
 * 决定是否激活某个箱体以及用什么建仓模式（STRATEGY_SPEC §4.1 / §4.2 / §5.3）。
 * 纯函数：无副作用，不碰 Runner/DB/WS。d 空间单实现，LONG/SHORT 自动镜像。
 * 激活窗口：activationDepth < d(price) < boxDepth（d 空间，方向无关）。
 * @returns 命中的箱体与模式；无可激活箱体或已有活跃箱时返回 null。
 */
export function decideBoxActivation(input: ActivationInput): ActivationDecision | null {
  if (input.hasActiveBox) return null;

  for (const box of input.boxes) {
    const lines = deriveBoxLines(box);
    const d = toDistance(input.price, box);
    const activationDepth = box.activationPrice > 0
      ? toDistance(box.activationPrice, box)
      : lines.mainGridDepth / 2;

    const inWindow = d > activationDepth && d < lines.boxDepth;
    if (!inWindow) continue;

    let mode: EntryMode;
    if (!box.trailingEntry) {
      mode = 'RUNNING';
    } else if (input.lastPrice === null || toDistance(input.lastPrice, box) < d) {
      mode = 'TRAILING_ENTRY';
    } else {
      mode = 'RUNNING';
    }
    return { configId: box.configId, mode };
  }

  return null;
}
