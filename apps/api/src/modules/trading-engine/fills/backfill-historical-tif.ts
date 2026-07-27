import { feeInQuote } from './fee-conversion';
import { inferHistoricalTif } from './infer-historical-tif';

export interface FillForTifInference {
  fee: number;
  feeAsset: string | null;
  qty: number;
  price: number;
  notional: number | null;
}

/**
 * 一个 Order 可能对应多笔部分成交；tif 是下单时刻的属性，同一订单不会又是 maker 又是 taker，
 * 所以汇总该订单名下全部成交的手续费/成交额再整体判定一次，比逐笔各自判定更符合语义、也更抗
 * 单笔随机误差。
 */
export function aggregateOrderTif(fills: FillForTifInference[], symbol: string): 'POC' | 'GTC' {
  let feeQuote = 0;
  let notional = 0;
  for (const f of fills) {
    feeQuote += feeInQuote(f.fee, f.feeAsset ?? undefined, symbol, f.price);
    notional += f.notional ?? f.qty * f.price;
  }
  return inferHistoricalTif(feeQuote, notional);
}
