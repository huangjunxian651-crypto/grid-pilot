import { Injectable } from "@nestjs/common";
import { IExchangeAdapter } from "./interfaces/exchange-adapter.interface";

@Injectable()
export class ExchangeRegistryService {
  private adapters = new Map<string, IExchangeAdapter>();

  register(adapter: IExchangeAdapter): void {
    const key = `${adapter.exchangeId}:${adapter.accountId}`;
    this.adapters.set(key, adapter);
  }

  get(exchangeId: string, accountId: string): IExchangeAdapter | undefined {
    return this.adapters.get(`${exchangeId}:${accountId}`);
  }

  getAll(): IExchangeAdapter[] {
    return Array.from(this.adapters.values());
  }

  remove(exchangeId: string, accountId: string): boolean {
    return this.adapters.delete(`${exchangeId}:${accountId}`);
  }
}
