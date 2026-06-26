import type { ExchangeAdapter } from '../adapters/exchange-adapter.interface';
import { ExchangeError, ErrorCategory } from '../../exchange/interfaces/exchange-adapter.interface';
import type { OrderRequest, OrderResult } from '../types/exchange.types';

interface ExecutionOptions {
  currentPrice: number;
  signal?: AbortSignal;
  getTicker?: () => Promise<{ bid: number; ask: number }>;
  gridPrice?: number;
  gtcThreshold?: number;
  pocRetryIntervalMs?: number;
  log?: (msg: string) => void;
}

export interface ExecutionResult {
  outcome: 'FILLED' | 'PLACED' | 'REJECTED';
  orderId?: string;
  clientOrderId?: string;
  filledQty?: number;
  avgFillPrice?: number;
  qty?: number;
  price?: number;
  error?: string;
  /** 稳定错误码（ExchangeError.code），供上层判断拒单原因是否可操作 */
  errorCode?: string;
}

export class ExecutionEngine {
  constructor(private readonly adapter: ExchangeAdapter) {}

  async execute(request: OrderRequest, options: ExecutionOptions): Promise<ExecutionResult> {
    if (request.tif === 'POC') {
      return this.executePoc(request, options);
    }

    if (request.tif === 'GTC') {
      return this.executeGtc(request, options);
    }

    return { outcome: 'REJECTED', error: 'Unsupported TIF' };
  }

  private async executePoc(request: OrderRequest, options: ExecutionOptions): Promise<ExecutionResult> {
    try {
      const result = await this.tryCreateOrder(request, options.signal);
      return this.mapResult(result);
    } catch (error: any) {
      if (!this.isPostOnlyReject(error)) {
        return this.handleNonPocError(request, options, error);
      }

      if (!options.getTicker || options.gridPrice === undefined) {
        return this.executeGtc(request, options);
      }

      return this.pocRetryLoop(request, options);
    }
  }

  private async pocRetryLoop(request: OrderRequest, options: ExecutionOptions): Promise<ExecutionResult> {
    const interval = options.pocRetryIntervalMs ?? 3000;
    const log = options.log ?? (() => {});
    let attempt = 0;

    while (true) {
      if (options.signal?.aborted) {
        return { outcome: 'REJECTED', error: 'Aborted' };
      }

      await new Promise(r => setTimeout(r, interval));

      if (options.signal?.aborted) {
        return { outcome: 'REJECTED', error: 'Aborted' };
      }

      attempt++;
      const ticker = await options.getTicker!();
      const directionalPrice = request.side === 'BUY' ? ticker.bid : ticker.ask;

      const gridPrice = options.gridPrice!;
      if (request.side === 'BUY' && directionalPrice >= gridPrice) {
        log(`POC retry #${attempt}: bid=${directionalPrice} >= gridPrice=${gridPrice}, abandoning`);
        return { outcome: 'REJECTED', error: `Price ${directionalPrice} crossed gridPrice ${gridPrice}` };
      }
      if (request.side === 'SELL' && directionalPrice <= gridPrice) {
        log(`POC retry #${attempt}: ask=${directionalPrice} <= gridPrice=${gridPrice}, abandoning`);
        return { outcome: 'REJECTED', error: `Price ${directionalPrice} crossed gridPrice ${gridPrice}` };
      }

      const retryRequest = { ...request, price: directionalPrice };

      try {
        const result = await this.tryCreateOrder(retryRequest, options.signal);
        log(`POC retry #${attempt}: placed at ${directionalPrice}`);
        return this.mapResult(result);
      } catch (error: any) {
        if (!this.isPostOnlyReject(error)) {
          return this.handleNonPocError(retryRequest, options, error);
        }
      }

      const margin = request.side === 'BUY'
        ? (gridPrice - ticker.ask) / gridPrice
        : (ticker.bid - gridPrice) / gridPrice;

      if (margin > (options.gtcThreshold ?? 0)) {
        const gtcPrice = request.side === 'BUY' ? ticker.ask : ticker.bid;
        log(`POC retry #${attempt}: margin=${margin.toFixed(6)} > gtcThreshold=${options.gtcThreshold ?? 0}, degrading to GTC at ${gtcPrice}`);
        return this.executeGtc({ ...request, price: gtcPrice }, options);
      }

      if (margin <= 0) {
        log(`POC retry #${attempt}: margin=${margin.toFixed(6)} <= 0, abandoning`);
        return { outcome: 'REJECTED', error: `Margin ${margin} <= 0, price no longer viable` };
      }

      log(`POC retry #${attempt}: margin=${margin.toFixed(6)} <= gtcThreshold=${options.gtcThreshold ?? 0}, continuing loop`);
    }
  }

  private isPostOnlyReject(error: unknown): boolean {
    if (error instanceof ExchangeError && error.category === ErrorCategory.POST_ONLY_REJECT) {
      return true;
    }
    if (error instanceof Error && (error.message === 'POST_ONLY_REJECT' || error.message?.toUpperCase().includes('POST_ONLY'))) {
      return true;
    }
    return false;
  }

  private toRejection(error: unknown): ExecutionResult {
    return {
      outcome: 'REJECTED',
      error: error instanceof Error ? error.message : String(error ?? 'Unknown error'),
      errorCode: error instanceof ExchangeError ? error.code : undefined,
    };
  }

  private async handleNonPocError(request: OrderRequest, options: ExecutionOptions, error: any): Promise<ExecutionResult> {
    try {
      const retryResult = await this.retryWithBackoff(() =>
        this.tryCreateOrder(request, options.signal),
      );
      return this.mapResult(retryResult);
    } catch (retryError: any) {
      return this.toRejection(retryError);
    }
  }

  private mapResult(result: OrderResult): ExecutionResult {
    const base = {
      orderId: result.orderId,
      clientOrderId: result.clientOrderId,
      filledQty: result.filledQty,
      avgFillPrice: result.avgFillPrice,
      qty: result.qty,
      price: result.price,
    };
    if (result.status === ('filled' as string)) return { outcome: 'FILLED', ...base };
    return { outcome: 'PLACED', ...base };
  }

  private async executeGtc(request: OrderRequest, options: ExecutionOptions): Promise<ExecutionResult> {
    // N1: pricing layer already applies 2% protection band (calculateOptimalPrice).
    // Use request.price directly — it is already the final, protection-clamped price.
    // Only fall back to a rough protection band if price is missing (defensive).
    const gtcPrice = request.price ?? (request.side === 'BUY'
      ? options.currentPrice * 0.98
      : options.currentPrice * 1.02);
    const gtcRequest = { ...request, tif: 'GTC' as const, price: gtcPrice };

    try {
      const retryResult = await this.retryWithBackoff(() =>
        this.tryCreateOrder(gtcRequest, options.signal),
      );
      return this.mapResult(retryResult);
    } catch (error: any) {
      return this.toRejection(error);
    }
  }

  private async tryCreateOrder(request: OrderRequest, signal?: AbortSignal): Promise<OrderResult> {
    return this.adapter.createOrder(request, signal);
  }

  private async retryWithBackoff<T>(fn: () => Promise<T>, maxRetries: number = 5): Promise<T> {
    let lastError: any;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error: any) {
        lastError = error;

        if (this.isBusinessError(error)) {
          throw error;
        }

        if (this.isNetworkError(error) && attempt < 2) {
          continue;
        }

        if (this.isRateLimitError(error) && attempt < 4) {
          const delayMs = Math.min(1000 * Math.pow(2, attempt), 30000);
          await new Promise(r => setTimeout(r, delayMs));
          continue;
        }

        break;
      }
    }

    throw lastError;
  }

  private isNetworkError(error: any): boolean {
    const networkCodes = ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNREFUSED'];
    return networkCodes.includes(error.code) || error.message?.includes('timeout');
  }

  private isRateLimitError(error: any): boolean {
    return error.code === 'RATE_LIMIT' ||
      error.message?.includes('Too Many Requests') ||
      error.message?.includes('429');
  }

  private isBusinessError(error: any): boolean {
    const businessMessages = ['insufficient balance', 'invalid price', 'invalid quantity'];
    return businessMessages.some(msg => error.message?.toLowerCase().includes(msg));
  }
}
