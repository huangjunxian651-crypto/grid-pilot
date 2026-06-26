import { decideBoxActivation, type BoxCandidate, type EntryMode } from './decide-box-activation';

/** 激活失败首次退避时长，之后逐次翻倍。 */
const ACTIVATION_BACKOFF_BASE_MS = 5_000;
/** 连续失败达到该次数后放弃激活（通过 onActivationGivenUp 上报，由外部决定善后）。 */
const ACTIVATION_GIVE_UP_THRESHOLD = 5;

export interface RobotSchedulerDeps {
  /** 返回该机器人当前的箱体候选（可随用户增删动态变化）。 */
  loadBoxes: () => BoxCandidate[];
  /** 激活某箱体（实现负责创建 session + 启动 Runner）。抛错表示激活失败。 */
  activateBox: (configId: string, mode: EntryMode) => Promise<void>;
  /** 时钟注入，默认 Date.now。 */
  now?: () => number;
  /** 连续激活失败达到阈值后回调一次；此后调度器不再尝试激活。 */
  onActivationGivenUp?: (configId: string, error: Error) => void;
}

/**
 * 单个 GridRobot 的调度状态机。接收价格 tick，决定何时激活哪个箱体，
 * 强制「同时最多一个活跃箱」。纯编排：通过注入回调与运行时交互。
 * 对应 GridRobot.activeBoxId（activeBox）。
 *
 * 激活失败退避：失败后按 5s 起步指数退避（5s/10s/20s/40s），连续失败
 * ACTIVATION_GIVE_UP_THRESHOLD 次后放弃并回调 onActivationGivenUp，
 * 防止对交易所每 tick 重试并刷出大量废弃 run 记录。
 */
export class RobotScheduler {
  private activeBoxConfigId: string | null = null;
  private lastPrice: number | null = null;
  private activating = false;
  private consecutiveFailures = 0;
  private nextAttemptAt = 0;
  private gaveUp = false;

  constructor(private readonly deps: RobotSchedulerDeps) {}

  get activeBox(): string | null {
    return this.activeBoxConfigId;
  }

  async onTick(price: number): Promise<void> {
    if (this.activeBoxConfigId !== null) {
      this.lastPrice = price;
      return;
    }
    if (this.activating) {
      return;
    }
    const nowMs = this.deps.now?.() ?? Date.now();
    if (this.gaveUp || nowMs < this.nextAttemptAt) {
      this.lastPrice = price;
      return;
    }

    const decision = decideBoxActivation({
      price,
      lastPrice: this.lastPrice,
      hasActiveBox: false,
      boxes: this.deps.loadBoxes(),
    });

    if (!decision) {
      this.lastPrice = price;
      return;
    }

    this.activating = true;
    try {
      await this.deps.activateBox(decision.configId, decision.mode);
      this.activeBoxConfigId = decision.configId;
      this.consecutiveFailures = 0;
      this.nextAttemptAt = 0;
    } catch (err) {
      this.consecutiveFailures += 1;
      if (this.consecutiveFailures >= ACTIVATION_GIVE_UP_THRESHOLD) {
        this.gaveUp = true;
        this.deps.onActivationGivenUp?.(decision.configId, err as Error);
      } else {
        this.nextAttemptAt = nowMs + ACTIVATION_BACKOFF_BASE_MS * 2 ** (this.consecutiveFailures - 1);
      }
      throw err;
    } finally {
      this.activating = false;
      this.lastPrice = price;
    }
  }

  /** 恢复时预置活跃箱：标记某箱已活跃，避免重复激活（持仓已由外部接管）。 */
  markActive(configId: string): void {
    this.activeBoxConfigId = configId;
  }

  /** 箱体终止（LIQUIDATED/TAKE_PROFIT）回报：释放活跃槽，下个 tick 接力评估。 */
  onBoxTerminated(configId: string): void {
    if (this.activeBoxConfigId === configId) {
      this.activeBoxConfigId = null;
    }
  }
}
