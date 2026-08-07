import type { RunnerCriticalEvent } from './grid-bot-runner';

const CRITICAL_EVENT_META: Record<
  RunnerCriticalEvent['kind'],
  { type: 'alert' | 'warn'; title: string; code: string }
> = {
  ORDER_REJECTED: { type: 'warn', title: 'Order rejected', code: 'RUNNER_ORDER_REJECTED' },
  STOPPED_REJECTIONS: { type: 'alert', title: 'Orders rejected repeatedly, grid cannot operate', code: 'RUNNER_STOPPED_REJECTIONS' },
  PAUSED_PERMANENT_ERROR: { type: 'alert', title: 'Bot paused: permanent configuration error', code: 'RUNNER_PAUSED_PERMANENT_ERROR' },
  RESIDUAL_POSITION: { type: 'alert', title: 'Liquidation incomplete: residual position remains', code: 'RUNNER_RESIDUAL_POSITION' },
};

/**
 * Runner 关键事件 → 通知负载（纯函数，便于黑盒测试）。
 * 通知只按 symbol/runCode 定位，从不带交易所信息——多交易所下用户完全无法
 * 判断是哪个交易所的机器人报的错（2026-08-04 生产实况）。在 symbol 前拼交易所名，
 * 不新增 i18n key（改 11 个 locale 的模板字符串代价远大于收益）。
 */
export function buildCriticalEventNotification(
  runCode: string,
  symbol: string,
  exchange: string,
  event: RunnerCriticalEvent,
): {
  type: 'alert' | 'warn';
  title: string;
  body: string;
  code: string;
  params: { symbol: string; runCode: string; reason: string };
} {
  const { type, title, code } = CRITICAL_EVENT_META[event.kind];
  const symbolWithExchange = `${exchange.toUpperCase()} ${symbol}`;
  return {
    type,
    title,
    body: `${symbolWithExchange} ${runCode}: ${event.message}`,
    code,
    params: { symbol: symbolWithExchange, runCode, reason: event.reason },
  };
}
