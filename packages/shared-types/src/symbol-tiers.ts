// 交易对风险分级与各交易所 symbol 长度上限（前后端共用单一口径）。
export type SymbolTier = 'best' | 'major' | 'alt';

export const TIER_BEST_ASSETS = ['BTC', 'ETH'] as const;
export const TIER_MAJOR_ASSETS = ['BNB', 'SOL', 'XRP'] as const;

/** 取 base 资产：'BTC/USDT'→'BTC'；'BTCUSDT'→'BTC'（去 USDT 后缀）。 */
function baseAsset(symbol: string): string {
  const upper = (symbol ?? '').trim().toUpperCase();
  if (upper.includes('/')) return upper.split('/')[0];
  return upper.endsWith('USDT') ? upper.slice(0, -4) : upper;
}

export function classifySymbol(symbol: string): SymbolTier {
  const base = baseAsset(symbol);
  if (!base) return 'alt';
  if ((TIER_BEST_ASSETS as readonly string[]).includes(base)) return 'best';
  if ((TIER_MAJOR_ASSETS as readonly string[]).includes(base)) return 'major';
  return 'alt';
}

/** 选择器预置对（统一 /USDT 永续）。 */
export const RECOMMENDED_SYMBOLS: { symbol: string; tier: 'best' | 'major' }[] = [
  { symbol: 'BTC/USDT', tier: 'best' },
  { symbol: 'ETH/USDT', tier: 'best' },
  { symbol: 'BNB/USDT', tier: 'major' },
  { symbol: 'SOL/USDT', tier: 'major' },
  { symbol: 'XRP/USDT', tier: 'major' },
];

/**
 * 各交易所 symbol token（去 /）长度上限 —— 权威值。
 * 由 clientOrderId 预算推导（见 apps/api .../adapters/utils.ts 的 codec 开销），
 * 此处硬编码为单一源；api 侧有不变式测试断言其推导值与本表一致，改 codec 时不会静默失配。
 */
export const SYMBOL_TOKEN_LIMIT_BY_EXCHANGE: Record<string, number> = {
  gateio: 10,
  okx: 14,
  binance: 18,
};
