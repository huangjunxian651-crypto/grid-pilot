// ExchangeAdapterFactory — 根据凭证创建对应交易所的适配器实例
// 支持 Binance / Gate.io / OKX，对接测试开发网

import { Injectable } from "@nestjs/common";
import { IExchangeAdapter } from "./interfaces/exchange-adapter.interface";
import { ExchangeRegistryService } from "./exchange-registry.service";
import { BinanceAdapter } from "./adapters/binance/binance.adapter";
import { GateioAdapter } from "./adapters/gateio/gateio.adapter";
import { OkxAdapter } from "./adapters/okx/okx.adapter";

export interface CredentialInput {
  exchangeId: string;
  accountId: string;
  apiKey: string;
  apiSecret: string;
  passphrase?: string;
}

@Injectable()
export class ExchangeAdapterFactory {
  constructor(private readonly registry: ExchangeRegistryService) {}

  createAdapter(credential: CredentialInput): IExchangeAdapter {
    switch (credential.exchangeId) {
      case "binance":
        return new BinanceAdapter({
          apiKey: credential.apiKey,
          apiSecret: credential.apiSecret,
          accountId: credential.accountId,
        });

      case "gateio":
        return new GateioAdapter({
          apiKey: credential.apiKey,
          apiSecret: credential.apiSecret,
          accountId: credential.accountId,
        });

      case "okx":
        return new OkxAdapter({
          apiKey: credential.apiKey,
          apiSecret: credential.apiSecret,
          passphrase: credential.passphrase ?? "",
          accountId: credential.accountId,
        });

      default:
        throw new Error(`Unsupported exchange: ${credential.exchangeId}`);
    }
  }

  registerAdapter(credential: CredentialInput): IExchangeAdapter {
    const adapter = this.createAdapter(credential);
    this.registry.register(adapter);
    return adapter;
  }

  removeAdapter(exchangeId: string, accountId: string): boolean {
    return this.registry.remove(exchangeId, accountId);
  }
}
