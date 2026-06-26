/**
 * Environment variable loader for integration tests.
 * Loads credentials from process.env with safe defaults.
 */

export interface ExchangeCredentials {
  apiKey: string;
  apiSecret: string;
  passphrase?: string;
}

export function getBinanceCredentials(): ExchangeCredentials | null {
  const key = process.env.BINANCE_API_KEY;
  const secret = process.env.BINANCE_API_SECRET;
  if (!key || !secret) return null;
  return { apiKey: key, apiSecret: secret };
}

export function getGateioCredentials(): ExchangeCredentials | null {
  const key = process.env.GATEIO_API_KEY;
  const secret = process.env.GATEIO_API_SECRET;
  if (!key || !secret) return null;
  return { apiKey: key, apiSecret: secret };
}

export function getOkxCredentials(): ExchangeCredentials | null {
  const key = process.env.OKX_API_KEY;
  const secret = process.env.OKX_API_SECRET;
  const passphrase = process.env.OKX_PASSPHRASE;
  if (!key || !secret || !passphrase) return null;
  return { apiKey: key, apiSecret: secret, passphrase };
}

export function shouldRun(exchange: "binance" | "gateio" | "okx"): boolean {
  switch (exchange) {
    case "binance":
      return getBinanceCredentials() !== null;
    case "gateio":
      return getGateioCredentials() !== null;
    case "okx":
      return getOkxCredentials() !== null;
  }
}
