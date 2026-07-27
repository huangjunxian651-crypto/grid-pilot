import { describe, it, expect } from 'vitest';
import { inferHistoricalTif } from './infer-historical-tif';

describe('inferHistoricalTif', () => {
  it('实际费率接近 maker 基准(0.02%)时判定为 POC', () => {
    // notional=1000，手续费 0.21（费率 0.00021，紧贴 0.0002 一侧）
    expect(inferHistoricalTif(0.21, 1000)).toBe('POC');
  });

  it('实际费率接近 taker 基准(0.05%)时判定为 GTC', () => {
    // notional=1000，手续费 0.48（费率 0.00048，紧贴 0.0005 一侧）
    expect(inferHistoricalTif(0.48, 1000)).toBe('GTC');
  });

  it('费率恰好落在 maker/taker 中点(0.035%)时归为 POC(边界含 maker 侧)', () => {
    expect(inferHistoricalTif(0.35, 1000)).toBe('POC');
  });

  it('费率略高于中点时归为 GTC', () => {
    expect(inferHistoricalTif(0.36, 1000)).toBe('GTC');
  });

  it('手续费为 0(免手续费/币种无法换算)时默认归为 POC，不强行判定', () => {
    expect(inferHistoricalTif(0, 1000)).toBe('POC');
  });

  it('成交额为 0(异常数据)时默认归为 POC，避免除零', () => {
    expect(inferHistoricalTif(0.1, 0)).toBe('POC');
  });
});
