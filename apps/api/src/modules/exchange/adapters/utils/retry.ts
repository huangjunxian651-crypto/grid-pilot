// Retry utilities for exchange adapter operations

import { ExchangeError } from "../../interfaces/exchange-adapter.interface";

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitter?: boolean;
}

const DEFAULT_RETRY_OPTIONS: Required<RetryOptions> = {
  maxAttempts: 3,
  baseDelayMs: 500,
  maxDelayMs: 10000,
  jitter: true,
};

/** Sleep for a given duration */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Calculate delay with exponential backoff and optional jitter */
export function calculateDelay(
  attempt: number,
  options: RetryOptions = {},
): number {
  const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };
  const exponential = opts.baseDelayMs * Math.pow(2, attempt);
  const capped = Math.min(exponential, opts.maxDelayMs);
  if (!opts.jitter) return capped;
  // Add up to 25% jitter
  return capped * (0.75 + Math.random() * 0.25);
}

/** Execute an async function with retry logic for retryable ExchangeErrors */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
  operation: string = "operation",
): Promise<T> {
  const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < opts.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      // Only retry ExchangeErrors marked as retryable
      if (err instanceof ExchangeError && err.isRetryable && attempt < opts.maxAttempts - 1) {
        const delay = calculateDelay(attempt, opts);
        await sleep(delay);
        continue;
      }

      // Non-retryable error — throw immediately
      throw err;
    }
  }

  throw lastError ?? new Error(`${operation} failed after ${opts.maxAttempts} attempts`);
}
