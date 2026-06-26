import { Injectable, BadRequestException, Logger } from "@nestjs/common";
import axios from "axios";
import type { Kline } from "./market-features";

const BINANCE_FAPI = "https://fapi.binance.com";

@Injectable()
export class BinanceMarketService {
  private readonly logger = new Logger(BinanceMarketService.name);

  /** symbol 形如 ETH/USDT 或 ETHUSDT → 统一为 ETHUSDT。 */
  static normalizeSymbol(symbol: string): string {
    return symbol.replace(/[\/\-_:]/g, "").toUpperCase();
  }

  /** 拉最近 365 根公开日线（无鉴权）。 */
  async fetchDailyKlines(symbol: string): Promise<Kline[]> {
    const sym = BinanceMarketService.normalizeSymbol(symbol);
    try {
      const res = await axios.get(`${BINANCE_FAPI}/fapi/v1/klines`, {
        params: { symbol: sym, interval: "1d", limit: 365 },
        timeout: 15000,
      });
      const rows = res.data as unknown[][];
      return rows.map((r) => ({
        openTime: Number(r[0]),
        open: Number(r[1]),
        high: Number(r[2]),
        low: Number(r[3]),
        close: Number(r[4]),
        volume: Number(r[5]),
      }));
    } catch (err) {
      this.logger.warn(`Binance klines 拉取失败 ${sym}: ${(err as Error).message}`);
      throw new BadRequestException({ code: "AI_MARKET_FETCH_FAILED", message: `Failed to fetch klines for ${sym}` });
    }
  }
}
