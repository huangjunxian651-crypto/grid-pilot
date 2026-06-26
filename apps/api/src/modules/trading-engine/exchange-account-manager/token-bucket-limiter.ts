interface TokenBucketOptions {
  capacity: number;
  refillRate: number; // tokens per second
}

export class TokenBucketRateLimiter {
  private tokens: number;
  private lastRefill: number;
  private acquireQueue: Promise<void> = Promise.resolve();

  constructor(private readonly options: TokenBucketOptions) {
    this.tokens = options.capacity;
    this.lastRefill = Date.now();
  }

  getTokens(): number {
    this.refill();
    return this.tokens;
  }

  async acquire(count: number = 1): Promise<void> {
    // Serialize all acquires through a promise chain to prevent race conditions
    const acquirePromise = this.acquireQueue.then(async () => {
      while (true) {
        this.refill();
        if (this.tokens >= count) {
          this.tokens -= count;
          this.lastRefill = Date.now();
          return;
        }
        const needed = count - this.tokens;
        const waitMs = (needed / this.options.refillRate) * 1000;
        await new Promise(r => setTimeout(r, Math.min(waitMs, 100)));
      }
    });

    // Update the queue to include this acquire (but don't await it in the chain setup)
    this.acquireQueue = acquirePromise.catch(() => {
      // Swallow errors to prevent queue from getting stuck
    });

    await acquirePromise;
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    const refillAmount = elapsed * this.options.refillRate;
    this.tokens = Math.min(this.options.capacity, this.tokens + refillAmount);
    this.lastRefill = now;
  }
}
