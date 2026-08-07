// OkxRestClient — OKX v5 API REST 客户端封装
// 使用 axios 直接对接官方 API，无官方 Node.js SDK
// 对接 OKX Demo 环境

import axios, { AxiosInstance, AxiosError } from "axios";
import { createHmac } from "crypto";
import { ExchangeError } from "../../interfaces/exchange-adapter.interface";
import { OKX_REST_DEMO, OKX_SIMULATED_TRADING_HEADER, OkxCredentials } from "./okx.types";
import { ExchangeEnvironment } from "@gridpilot/shared-types";

export class OkxRestClient {
  private client: AxiosInstance;
  private credentials: OkxCredentials;

  constructor(credentials: OkxCredentials, baseUrl?: string, environment: ExchangeEnvironment = "demo") {
    this.credentials = credentials;
    this.client = axios.create({
      baseURL: baseUrl ?? OKX_REST_DEMO,
      timeout: 30000,
      headers: {
        "Content-Type": "application/json",
        "OK-ACCESS-KEY": credentials.apiKey,
        ...(environment === "demo" ? { "x-simulated-trading": OKX_SIMULATED_TRADING_HEADER } : {}),
      },
    });

    // Response interceptor: classify HTTP-level and network errors as ExchangeError
    // OKX business errors (code != "0" in response body) are left for the adapter to handle
    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        if (axios.isAxiosError(error)) {
          const axiosErr = error as AxiosError;
          const status = axiosErr.response?.status;

          // HTTP-level rate limits
          if (status === 429) {
            return Promise.reject(
              new ExchangeError(
                `OKX rate limit (HTTP 429): ${axiosErr.message}`,
                "RATE_LIMIT",
                "okx",
                true,
              ),
            );
          }
          // HTTP-level server errors
          if (status && status >= 500) {
            return Promise.reject(
              new ExchangeError(
                `OKX server error (HTTP ${status}): ${axiosErr.message}`,
                "SERVER_ERROR",
                "okx",
                true,
              ),
            );
          }
          // HTTP-level client errors (4xx)：OKX 把参数/鉴权错误以 HTTP 4xx 返回，
          // code/msg 在响应体里，必须透传，否则只剩裸 axios message 无法排障
          if (status && status >= 400 && status < 500) {
            const body = axiosErr.response?.data as { code?: string; msg?: string } | undefined;
            const detail = body?.msg ? `${body.msg} (code=${body.code})` : axiosErr.message;
            return Promise.reject(
              new ExchangeError(
                `OKX client error (HTTP ${status}): ${detail}`,
                body?.code ?? `HTTP_${status}`,
                "okx",
                false,
              ),
            );
          }
          // Network errors (no response)
          if (!axiosErr.response) {
            const isNetworkError =
              axiosErr.message.includes("ECONNREFUSED") ||
              axiosErr.message.includes("ETIMEDOUT") ||
              axiosErr.message.includes("ENOTFOUND") ||
              axiosErr.message.includes("ECONNRESET") ||
              axiosErr.message.includes("ECONNABORTED") ||
              axiosErr.message.includes("EPIPE") ||
              axiosErr.message.includes("EAI_AGAIN") ||
              axiosErr.message.includes("socket hang up") ||
              axiosErr.message.includes("Network Error") ||
              axiosErr.message.includes("timeout") ||
              axiosErr.message.includes("Timeout");
            return Promise.reject(
              new ExchangeError(
                `OKX network error: ${axiosErr.message}`,
                isNetworkError ? "NETWORK_ERROR" : "UNKNOWN_ERROR",
                "okx",
                true,
              ),
            );
          }
        }
        return Promise.reject(error);
      },
    );

    // Request interceptor to sign every request
    this.client.interceptors.request.use((config) => {
      const timestamp = new Date().toISOString();
      const method = config.method?.toUpperCase() ?? "GET";
      const path = config.url ?? "";
      const query = config.params ? new URLSearchParams(config.params).toString() : "";
      const fullPath = query ? `${path}?${query}` : path;
      const body = config.data ? JSON.stringify(config.data) : "";
      const message = timestamp + method + fullPath + body;

      const sign = createHmac("sha256", this.credentials.apiSecret)
        .update(message)
        .digest("base64");

      config.headers["OK-ACCESS-TIMESTAMP"] = timestamp;
      config.headers["OK-ACCESS-SIGN"] = sign;
      config.headers["OK-ACCESS-PASSPHRASE"] = this.credentials.passphrase;

      return config;
    });
  }

  // ── Market Data ───────────────────────────────────────────────

  async getTicker(instId: string): Promise<unknown> {
    const { data } = await this.client.get("/api/v5/market/ticker", { params: { instId } });
    return data;
  }

  async getInstruments(instType: string, instId?: string): Promise<unknown> {
    const params: Record<string, string> = { instType };
    if (instId) params.instId = instId;
    const { data } = await this.client.get("/api/v5/public/instruments", { params });
    return data;
  }

  // ── Account ───────────────────────────────────────────────────

  async getBalance(): Promise<unknown> {
    const { data } = await this.client.get("/api/v5/account/balance");
    return data;
  }

  async getPositions(instType?: string, instId?: string): Promise<unknown> {
    const params: Record<string, string> = {};
    if (instType) params.instType = instType;
    if (instId) params.instId = instId;
    const { data } = await this.client.get("/api/v5/account/positions", { params });
    return data;
  }

  async getAccountConfig(): Promise<unknown> {
    const { data } = await this.client.get("/api/v5/account/config");
    return data;
  }

  async setPositionMode(posMode: string): Promise<unknown> {
    const { data } = await this.client.post("/api/v5/account/set-position-mode", { posMode });
    return data;
  }

  async setLeverage(instId: string, lever: string, mgnMode: string): Promise<unknown> {
    const { data } = await this.client.post("/api/v5/account/set-leverage", {
      instId,
      lever,
      mgnMode,
    });
    return data;
  }

  // ── Trade ─────────────────────────────────────────────────────

  async placeOrder(body: Record<string, unknown>): Promise<unknown> {
    const { data } = await this.client.post("/api/v5/trade/order", body);
    return data;
  }

  async cancelOrder(instId: string, ordId?: string, clOrdId?: string): Promise<unknown> {
    const body: Record<string, string> = { instId };
    if (ordId) body.ordId = ordId;
    if (clOrdId) body.clOrdId = clOrdId;
    const { data } = await this.client.post("/api/v5/trade/cancel-order", body);
    return data;
  }

  async cancelBatchOrders(orders: Array<{ instId: string; ordId?: string; clOrdId?: string }>): Promise<unknown> {
    const { data } = await this.client.post("/api/v5/trade/cancel-batch-orders", orders);
    return data;
  }

  async getOpenOrders(instType?: string, instId?: string): Promise<unknown> {
    const params: Record<string, string> = {};
    if (instType) params.instType = instType;
    if (instId) params.instId = instId;
    const { data } = await this.client.get("/api/v5/trade/orders-pending", { params });
    return data;
  }

  // ── Algo Orders ───────────────────────────────────────────────

  async placeAlgoOrder(body: Record<string, unknown>): Promise<unknown> {
    const { data } = await this.client.post("/api/v5/trade/order-algo", body);
    return data;
  }

  async cancelAlgoOrders(orders: Array<{ instId: string; algoId: string }>): Promise<unknown> {
    const { data } = await this.client.post("/api/v5/trade/cancel-algos", orders);
    return data;
  }

  /** ordType 为 OKX 必填参数，缺失返回 HTTP 400 code=51000 "Parameter ordType error" */
  async getPendingAlgoOrders(ordType: string, instType?: string, instId?: string): Promise<unknown> {
    const params: Record<string, string> = { ordType };
    if (instType) params.instType = instType;
    if (instId) params.instId = instId;
    const { data } = await this.client.get("/api/v5/trade/orders-algo-pending", { params });
    return data;
  }

  async getFills(instType: string, instId: string, begin?: string): Promise<unknown> {
    const params: Record<string, string> = { instType };
    if (instId) params.instId = instId;
    if (begin) params.begin = begin;
    const { data } = await this.client.get("/api/v5/trade/fills", { params });
    return data;
  }

  /**
   * 拉取账户账单（type=8 资金费）。
   * 注意：OKX /api/v5/account/bills 仅保留最近 7 天数据；
   * 超过 7 天须改用 /api/v5/account/bills-archive（TODO：后续迭代支持）。
   */
  async getFundingBills(instId?: string, after?: string): Promise<{ code: string; msg: string; data: Array<Record<string, unknown>> }> {
    const params: Record<string, string> = { type: "8" };
    if (instId) params.instId = instId;
    if (after) params.after = after;
    const { data } = await this.client.get("/api/v5/account/bills", { params });
    return data;
  }

  async getOrdersHistory(instType: string, instId?: string, begin?: string): Promise<unknown> {
    const params: Record<string, string> = { instType };
    if (instId) params.instId = instId;
    if (begin) params.begin = begin;
    const { data } = await this.client.get("/api/v5/trade/orders-history", { params });
    return data;
  }

  // ── Helper ────────────────────────────────────────────────────

  getBaseUrl(): string {
    return this.client.defaults.baseURL ?? OKX_REST_DEMO;
  }
}
