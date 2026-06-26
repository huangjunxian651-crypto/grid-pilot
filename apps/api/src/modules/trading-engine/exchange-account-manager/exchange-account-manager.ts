import type { ExchangeAdapter } from '../adapters/exchange-adapter.interface';
import { TokenBucketRateLimiter } from './token-bucket-limiter';

interface RateLimitConfig {
  readLimit: { capacity: number; refillRate: number };
  writeLimit: { capacity: number; refillRate: number };
}

export class ExchangeAccountManager {
  private refCount = 0;
  private connected = false;
  private readLimiter: TokenBucketRateLimiter;
  private writeLimiter: TokenBucketRateLimiter;

  constructor(
    public readonly accountId: string,
    private readonly adapter: ExchangeAdapter,
    private readonly rateLimits: RateLimitConfig,
  ) {
    this.readLimiter = new TokenBucketRateLimiter(rateLimits.readLimit);
    this.writeLimiter = new TokenBucketRateLimiter(rateLimits.writeLimit);
  }

  getRefCount(): number {
    return this.refCount;
  }

  async acquire(): Promise<void> {
    this.refCount++;
    if (this.refCount === 1 && !this.connected) {
      try {
        await this.adapter.connect();
        this.connected = true;
      } catch (error) {
        // Rollback refCount on connection failure
        this.refCount--;
        throw error;
      }
    }
  }

  async release(): Promise<void> {
    if (this.refCount <= 0) return;
    this.refCount--;
    if (this.refCount === 0 && this.connected) {
      await this.adapter.disconnect();
      this.connected = false;
    }
  }

  getAdapter(): ExchangeAdapter {
    return this.adapter;
  }

  async acquireRead(): Promise<void> {
    await this.readLimiter.acquire();
  }

  async acquireWrite(): Promise<void> {
    await this.writeLimiter.acquire();
  }
}
