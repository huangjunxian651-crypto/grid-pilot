/** 一根日线（数值已转 number）。 */
export interface Kline {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface WindowFeatures {
  days: number;
  currentPrice: number;
  high: number;
  low: number;
  rangePct: number;
  realizedVol: number;
  atr: number;
  maxDrawdownPct: number;
  trendPct: number;
}

export interface Vpvr {
  priceLow: number;
  priceHigh: number;
  bins: number[];
}

/** 由一段日线算窗口特征；空数组返回零值。 */
export function computeWindowFeatures(klines: Kline[]): WindowFeatures {
  const n = klines.length;
  if (n === 0) {
    return { days: 0, currentPrice: 0, high: 0, low: 0, rangePct: 0, realizedVol: 0, atr: 0, maxDrawdownPct: 0, trendPct: 0 };
  }
  const high = Math.max(...klines.map((k) => k.high));
  const low = Math.min(...klines.map((k) => k.low));
  const currentPrice = klines[n - 1].close;
  const first = klines[0].close;
  const rangePct = low > 0 ? ((high - low) / low) * 100 : 0;
  const trendPct = first > 0 ? ((currentPrice - first) / first) * 100 : 0;

  const rets: number[] = [];
  for (let i = 1; i < n; i++) {
    const prev = klines[i - 1].close, cur = klines[i].close;
    if (prev > 0 && cur > 0) rets.push(Math.log(cur / prev));
  }
  let realizedVol = 0;
  if (rets.length > 1) {
    const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
    const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / rets.length;
    realizedVol = Math.sqrt(variance) * Math.sqrt(365) * 100;
  }

  let trSum = 0;
  for (let i = 0; i < n; i++) {
    const prevClose = i > 0 ? klines[i - 1].close : klines[i].open;
    const tr = Math.max(klines[i].high - klines[i].low, Math.abs(klines[i].high - prevClose), Math.abs(klines[i].low - prevClose));
    trSum += tr;
  }
  const atr = trSum / n;

  let peak = klines[0].close, maxDd = 0;
  for (const k of klines) {
    if (k.close > peak) peak = k.close;
    if (peak > 0) maxDd = Math.max(maxDd, (peak - k.close) / peak);
  }
  const maxDrawdownPct = maxDd * 100;

  return { days: n, currentPrice, high, low, rangePct, realizedVol, atr, maxDrawdownPct, trendPct };
}

/** 成交量按价分桶（用收盘价归桶）。空数组返回全 0 桶。 */
export function computeVpvr(klines: Kline[], binCount: number): Vpvr {
  if (klines.length === 0) return { priceLow: 0, priceHigh: 0, bins: new Array(binCount).fill(0) };
  const priceLow = Math.min(...klines.map((k) => k.low));
  const priceHigh = Math.max(...klines.map((k) => k.high));
  const bins = new Array(binCount).fill(0);
  const span = priceHigh - priceLow;
  for (const k of klines) {
    const idx = span > 0 ? Math.min(binCount - 1, Math.floor(((k.close - priceLow) / span) * binCount)) : 0;
    bins[idx] += k.volume;
  }
  return { priceLow, priceHigh, bins };
}
