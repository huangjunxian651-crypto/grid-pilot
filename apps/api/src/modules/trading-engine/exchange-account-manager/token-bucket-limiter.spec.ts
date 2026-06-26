import { describe, it, expect, beforeEach } from 'vitest';
import { TokenBucketRateLimiter } from './token-bucket-limiter';

describe('TokenBucketRateLimiter', () => {
  it('should allow requests when tokens are available', async () => {
    const limiter = new TokenBucketRateLimiter({ capacity: 5, refillRate: 1 });
    await limiter.acquire();
    expect(limiter.getTokens()).toBe(4);
  });

  it('should block when tokens are exhausted and wait for refill', async () => {
    const limiter = new TokenBucketRateLimiter({ capacity: 1, refillRate: 10 });
    await limiter.acquire();
    expect(limiter.getTokens()).toBe(0);

    const start = Date.now();
    await limiter.acquire();
    const elapsed = Date.now() - start;

    expect(elapsed).toBeGreaterThanOrEqual(80);
    expect(elapsed).toBeLessThan(300);
  });

  it('should refill tokens over time', async () => {
    const limiter = new TokenBucketRateLimiter({ capacity: 2, refillRate: 10 });
    await limiter.acquire();
    await limiter.acquire();
    expect(limiter.getTokens()).toBe(0);

    const start = Date.now();
    await limiter.acquire();
    const elapsed = Date.now() - start;

    expect(elapsed).toBeGreaterThanOrEqual(80);
    expect(elapsed).toBeLessThan(300);
    expect(limiter.getTokens()).toBeLessThan(0.1);
  });

  it('should handle multiple acquire counts', async () => {
    const limiter = new TokenBucketRateLimiter({ capacity: 5, refillRate: 100 });
    await limiter.acquire(3);
    expect(limiter.getTokens()).toBe(2);
  });

  it('should never exceed capacity', async () => {
    const limiter = new TokenBucketRateLimiter({ capacity: 2, refillRate: 100 });
    await limiter.acquire();
    await new Promise(r => setTimeout(r, 50));
    expect(limiter.getTokens()).toBeLessThanOrEqual(2);
  });

  it('should handle concurrent acquires safely without exceeding capacity', async () => {
    const limiter = new TokenBucketRateLimiter({ capacity: 3, refillRate: 100 });
    await Promise.all([limiter.acquire(), limiter.acquire(), limiter.acquire()]);
    expect(limiter.getTokens()).toBeLessThanOrEqual(0.2);
  });

  it('should serialize concurrent acquires to prevent over-consumption', async () => {
    const limiter = new TokenBucketRateLimiter({ capacity: 3, refillRate: 100 });
    const order: number[] = [];

    const p1 = limiter.acquire().then(() => order.push(1));
    const p2 = limiter.acquire().then(() => order.push(2));
    const p3 = limiter.acquire().then(() => order.push(3));

    await Promise.all([p1, p2, p3]);

    // All 3 should complete immediately (capacity = 3)
    expect(order).toHaveLength(3);
    expect(limiter.getTokens()).toBeLessThanOrEqual(0.2);
  });

  it('should report initial tokens equal to capacity', () => {
    const limiter = new TokenBucketRateLimiter({ capacity: 10, refillRate: 5 });
    expect(limiter.getTokens()).toBe(10);
  });

  it('should allow burst up to capacity', async () => {
    const limiter = new TokenBucketRateLimiter({ capacity: 5, refillRate: 1 });
    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire();
    expect(limiter.getTokens()).toBeLessThan(0.1);
  });
});
