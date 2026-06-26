import { describe, it, expect } from 'vitest';
import { classifySymbol, RECOMMENDED_SYMBOLS, SYMBOL_TOKEN_LIMIT_BY_EXCHANGE } from './symbol-tiers';

describe('classifySymbol', () => {
  it('BTC/ETH → best', () => {
    expect(classifySymbol('BTC/USDT')).toBe('best');
    expect(classifySymbol('ETH/USDT')).toBe('best');
    expect(classifySymbol('BTCUSDT')).toBe('best');
  });
  it('BNB/SOL/XRP → major', () => {
    expect(classifySymbol('BNB/USDT')).toBe('major');
    expect(classifySymbol('SOL/USDT')).toBe('major');
    expect(classifySymbol('XRP/USDT')).toBe('major');
  });
  it('其余 → alt', () => {
    expect(classifySymbol('PEPE/USDT')).toBe('alt');
    expect(classifySymbol('1000PEPE/USDT')).toBe('alt');
    expect(classifySymbol('')).toBe('alt');
  });
});

describe('RECOMMENDED_SYMBOLS', () => {
  it('含 5 对且分级正确', () => {
    expect(RECOMMENDED_SYMBOLS.map((r) => r.symbol)).toEqual([
      'BTC/USDT', 'ETH/USDT', 'BNB/USDT', 'SOL/USDT', 'XRP/USDT',
    ]);
    expect(RECOMMENDED_SYMBOLS.filter((r) => r.tier === 'best').length).toBe(2);
  });
});

describe('SYMBOL_TOKEN_LIMIT_BY_EXCHANGE', () => {
  it('gateio 10 / okx 14 / binance 18', () => {
    expect(SYMBOL_TOKEN_LIMIT_BY_EXCHANGE).toEqual({ gateio: 10, okx: 14, binance: 18 });
  });
});
