/**
 * 带自动重连的 ticker 价格泵。
 *
 * 背景/根因：BotManagerService 喂 `latestPrice` Map（/robots 列表标记价的数据源）的订阅
 * 原本只是一次性 `for await (subscribeTicker)`——底层 WS 流"干净结束"（迭代器 done，不抛错）
 * 后循环就退出、永不重订，Map 永久冻结 → 列表标记价不再更新（详情页因 runner 自带重连的
 * tickerPump 仍实时）。本函数复刻 GridBotRunner.tickerPump 的自愈：流结束或抛错都在
 * 退避后重新订阅，只要仍 active。
 */
export interface TickerPumpOptions {
  /** 每次调用返回一条全新的 ticker 流（重连=再调一次）。 */
  subscribe: () => AsyncIterable<{ last: number }>;
  /** 收到一个价。 */
  onPrice: (price: number) => void;
  /** 是否仍应保持订阅（取消时返回 false 让循环优雅退出）。 */
  isActive: () => boolean;
  /** 流抛错时回调（用于日志，不得静默吞）。 */
  onError?: (err: unknown) => void;
  /** 重连退避毫秒，默认 1000。 */
  reconnectDelayMs?: number;
  /** 可注入的 sleep（测试用）。 */
  sleep?: (ms: number) => Promise<void>;
}

export async function pumpTickerWithReconnect(opts: TickerPumpOptions): Promise<void> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const delay = opts.reconnectDelayMs ?? 1000;

  while (opts.isActive()) {
    try {
      for await (const tick of opts.subscribe()) {
        if (!opts.isActive()) break;
        opts.onPrice(tick.last);
      }
    } catch (err) {
      opts.onError?.(err);
    }
    if (!opts.isActive()) break;
    await sleep(delay);
  }
}
