// /learn/fees 信息图的通用举例数字（举例用途，非用户真实数据）。
// 口径：以「开平仓」为单位——一次开平仓 = 开仓 1 笔 + 平仓 1 笔 = 2 笔成交。
const principal = 1000;
const leverage = 20;
const notional = principal * leverage; // 20000
const makerRate = 0.0002; // 0.02%
const takerRate = 0.0005; // 0.05%
const feePerFillTaker = notional * takerRate; // 单笔成交手续费(Taker) = 10
const feePerFillMaker = notional * makerRate; // 单笔成交手续费(Maker) = 4
const roundTripsPerDay = 50; // 一天开平仓次数

export const FEE_EXAMPLE = {
  principal,
  leverage,
  notional,
  makerRate,
  takerRate,
  feePerFillTaker, // 10
  feePerFillMaker, // 4
  roundTripsPerDay, // 50
  roundTripFeeTaker: feePerFillTaker * 2, // 一次开平仓手续费(Taker) = 20
  roundTripPctOfPrincipal: (feePerFillTaker * 2) / principal, // 一次开平仓占本金 = 0.02 (2%)
  takerDaily: feePerFillTaker * 2 * roundTripsPerDay, // 单日手续费(Taker) = 1000
  makerDaily: feePerFillMaker * 2 * roundTripsPerDay, // 单日手续费(Maker) = 400
  rebateRate: 0.2, // 返佣返还约 20%
};
