/**
 * 把本笔手续费折算为计价货币(quote)金额。
 * symbol 形如 'ETH/USDT' → base='ETH', quote='USDT'。
 * - feeAsset === quote：原样
 * - feeAsset === base：× 成交价
 * - 其它（如 BNB 抵扣）：通过可选的 quotePriceOf 注入折算；取不到价时返回 0
 * fee 入参为"已付为正"。
 *
 * @param quotePriceOf 可选的资产→计价货币单价查询函数（如 BNB→USDT 现价）。
 *                     返回 undefined 表示查不到，此时退回 0。
 */
export function feeInQuote(
  fee: number,
  feeAsset: string | undefined,
  symbol: string,
  fillPrice: number,
  quotePriceOf?: (asset: string) => number | undefined,
): number {
  if (!feeAsset || !fee) return 0;
  const [base, quote] = symbol.split('/');
  if (feeAsset === quote) return fee;
  if (feeAsset === base) return fee * fillPrice;
  if (quotePriceOf) {
    const price = quotePriceOf(feeAsset);
    if (price !== undefined) return fee * price;
  }
  return 0;
}
