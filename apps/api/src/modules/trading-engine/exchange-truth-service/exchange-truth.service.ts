import type { ExchangeAdapter } from '../adapters/exchange-adapter.interface';
import type { Position, OrderResult, AlgoOrder } from '../types/exchange.types';

export interface SyncResult {
  position: Position;
  openOrders: OrderResult[];
  algoOrders: AlgoOrder[];
  timestamp: number;
}

export class ExchangeTruthService {
  private position: Position | null = null;
  private openOrders: OrderResult[] = [];
  private algoOrders: AlgoOrder[] = [];
  private stale = true;
  private lastRefreshTime = 0;

  constructor(private readonly adapter: ExchangeAdapter) {}

  getPosition(symbol: string): Position | null {
    return this.position;
  }

  getOpenOrders(symbol: string): OrderResult[] {
    return this.openOrders;
  }

  getAlgoOrders(symbol: string): AlgoOrder[] {
    return this.algoOrders;
  }

  isStale(): boolean {
    return this.stale;
  }

  markStale(reason: string): void {
    this.stale = true;
  }

  async invalidateAndRefresh(symbol: string): Promise<SyncResult> {
    const [position, openOrders, algoOrders] = await Promise.all([
      this.adapter.getPosition(symbol),
      this.adapter.getOpenOrders(symbol),
      this.adapter.getAlgoOrders(symbol),
    ]);

    this.position = position;
    this.openOrders = openOrders;
    this.algoOrders = algoOrders;
    this.stale = false;
    this.lastRefreshTime = Date.now();

    return { position, openOrders, algoOrders, timestamp: this.lastRefreshTime };
  }
}
