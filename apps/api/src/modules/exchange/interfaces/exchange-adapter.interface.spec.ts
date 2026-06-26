import { describe, it, expect } from 'vitest';
import { ExchangeError, ErrorCategory } from './exchange-adapter.interface';

describe('ExchangeError', () => {
  it('carries category when provided', () => {
    const err = new ExchangeError(
      'Binance API error [-5022]: Post Only rejected',
      '-5022',
      'binance',
      false,
      ErrorCategory.POST_ONLY_REJECT,
    );
    expect(err.message).toContain('-5022');
    expect(err.code).toBe('-5022');
    expect(err.category).toBe(ErrorCategory.POST_ONLY_REJECT);
    expect(err.isRetryable).toBe(false);
  });

  it('defaults category to undefined when not provided', () => {
    const err = new ExchangeError('some error', 'X', 'binance', false);
    expect(err.category).toBeUndefined();
  });
});
