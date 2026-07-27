// 历史 Order 没有持久化 tif（补采集链路上线前下的单），但成交时的手续费费率是确凿的历史事实：
// maker(POC)/taker(GTC)在多数交易所走不同费率档位。与
// apps/web/app/learn/fees/fees-infographic.tsx 的 MAKER_RATE/TAKER_RATE 保持同一组基准值（单一真源
// 写在那边），取中点作为判定分界。
const MAKER_RATE = 0.0002;
const TAKER_RATE = 0.0005;
const MIDPOINT_RATE = (MAKER_RATE + TAKER_RATE) / 2;

/**
 * 用实际费率反推历史订单的 tif。feeQuote/notional 为 0（免手续费/手续费币种无法折算/成交额异常）
 * 时无法可靠判定是否 maker，默认归为 POC——业务判断：宁可低估 GTC 占比，也不臆造一个"确定"的分类。
 */
export function inferHistoricalTif(feeQuote: number, notional: number): 'POC' | 'GTC' {
  if (feeQuote <= 0 || notional <= 0) return 'POC';
  const rate = feeQuote / notional;
  return rate <= MIDPOINT_RATE ? 'POC' : 'GTC';
}
