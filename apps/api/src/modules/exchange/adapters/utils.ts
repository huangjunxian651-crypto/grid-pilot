// Exchange adapter shared utilities
// Symbol format conversion, quantity conversion, clientOrderId transformation

// ── Symbol Mapping ────────────────────────────────────────────

export function toBinanceSymbol(symbol: string): string {
  return symbol.replace("/", "");
}

export function toGateioSymbol(symbol: string): string {
  return symbol.replace("/", "_");
}

export function toOkxSymbol(symbol: string): string {
  return symbol.replace("/", "-") + "-SWAP";
}

// ── Quantity Conversion ───────────────────────────────────────

/**
 * 币本位数量 → 合约张数。
 *
 * 按 lotSz（最小张数步进）对齐，而非强制整张。OKX ETH-USDT-SWAP 的 lotSz=0.01（允许零头张），
 * 0.05 ETH=0.5 张是合法订单；旧实现 Math.round(0.5)=1 张会把它进位成 0.1 ETH=2×，引发单线 churn。
 * lotSize 默认 1（整张），保持 Gate 等整张合约交易所的原语义。
 */
export function coinToContracts(
  qty: number,
  contractSize: number,
  lotSize = 1,
): number {
  const step = lotSize > 0 ? lotSize : 1;
  const lots = Math.round(qty / contractSize / step);
  if (lots <= 0) {
    throw new Error(
      `Quantity ${qty} is too small for contract size ${contractSize} (would round to 0 contracts)`,
    );
  }
  // 清理 lots*step 的 IEEE754 噪声（如 1.5、1.23 不带尾随浮点垃圾）
  return parseFloat((lots * step).toFixed(8));
}

// Convert contract units to coin units
export function contractsToCoin(qty: number, contractSize: number): number {
  return qty * contractSize;
}

// ── ClientOrderId Transformation ──────────────────────────────

// Gate.io: add t- prefix
export function toGateioClientId(id: string): string {
  return `t-${id}`;
}

export function fromGateioClientId(id: string): string {
  return id.startsWith("t-") ? id.slice(2) : id;
}

/**
 * Gate.io 算法单方向推导。
 * 平仓型触发单(close=true,size=0)本身无方向,按触发规则推导真实平仓方向:
 *   rule 2(price_below,跌破触发)= 平多 = sell;rule 1(price_above,涨破)= 平空 = buy。
 * 带量单按 size 符号(正=buy,负=sell)。
 * 修复:此前对 size=0 的平仓单用 `size>=0?buy:sell` 一律误判为 buy。
 */
export function deriveGateioAlgoSide(initialSize: number, initialClose: boolean, triggerRule: number): "buy" | "sell" {
  if (initialClose) return triggerRule === 2 ? "sell" : "buy";
  return initialSize >= 0 ? "buy" : "sell";
}

/** OKX clientId 净化：仅保留字母数字（长度校验由调用方 fail-loud，勿在此截断后丢信息） */
export function okxSanitizeClientId(id: string): string {
  return id.replace(/[^a-zA-Z0-9]/g, "");
}

// OKX: ensure alphanumeric only, max 32 chars
export function toOkxClientId(id: string): string {
  return okxSanitizeClientId(id).slice(0, 32);
}

// Binance: direct pass-through (already compatible)
export function toBinanceClientId(id: string): string {
  return id.slice(0, 36);
}

// ── Unified clientOrderId codec ───────────────────────────────
// 格式: <symbol><yymmddHHMMSS><B|S><seq>，纯字母数字无分隔符。
// 字符集满足 OKX(纯字母数字)/Binance/Gate.io。长度对常见 symbol 满足
// Gate.io 的 t-+≤30 约束；超长 symbol+高 seq 由 gateio.adapter createOrder
// 的 fail-loud 断言（Task 2）兜底。

/** 把 Date 格式化为 12 位 yymmddHHMMSS（UTC，交易系统统一用 UTC）。 */
export function formatSessionTimestamp(date: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    p(date.getUTCFullYear() % 100) +
    p(date.getUTCMonth() + 1) +
    p(date.getUTCDate()) +
    p(date.getUTCHours()) +
    p(date.getUTCMinutes()) +
    p(date.getUTCSeconds())
  );
}

/** 所有权 token = 去掉下划线的 sessionCode（即 symbol+time）。 */
export function sessionToken(sessionCode: string): string {
  return sessionCode.replace(/_/g, "");
}

/** 编码网格订单 clientId：<symbol><yymmddHHMMSS><B|S><seq>。 */
export function encodeClientOrderId(
  sessionCode: string,
  side: "BUY" | "SELL",
  seq: number,
): string {
  return `${sessionToken(sessionCode)}${side === "BUY" ? "B" : "S"}${seq}`;
}

export interface ParsedClientOrderId {
  symbol: string;
  time: string; // 12 位 yymmddHHMMSS
  side: "BUY" | "SELL";
  seq: number;
}

/**
 * 解析网格订单 clientId。以定长 12 位时间段 + 单字符 B/S 为锚反推。
 * 现实币种 symbol 结尾为字母（如 USDT），不会与时间段的 12 位数字混淆。
 * 不匹配（如旧格式 / 算法单 / fill event）返回 null。
 */
export function parseClientOrderId(id: string): ParsedClientOrderId | null {
  const m = /^(.+?)(\d{12})([BS])(\d+)$/.exec(id);
  if (!m) return null;
  return {
    symbol: m[1],
    time: m[2],
    side: m[3] === "B" ? "BUY" : "SELL",
    seq: Number(m[4]),
  };
}

/**
 * 识别 clean-switch 部署前的旧格式网格单 id：`SYMBOL_<13位毫秒戳>_SIDE_seq`。
 * 用于冷启动时告警交易所上残留的旧会话挂单（它们无法被新所有权逻辑认领）。
 * 13 位毫秒戳精确区分旧格式与新 12 位 yymmddHHMMSS 格式；算法单/用户手动单不匹配。
 */
export function isLegacyClientOrderId(id: string | undefined): boolean {
  if (!id) return false;
  return /_\d{13}_(BUY|SELL)_\d+$/.test(id);
}

// ── Algo clientOrderId codec ──────────────────────────────────
// 格式: <sessionToken>A<E|G><2位suffix>，纯字母数字。与网格单（token+B|S+数字）
// 以时间段后的字母 A 区分。旧格式 `${runCode}_algo_…` 经 toOkxClientId
// 去下划线 + 截断 32 字符后丢失随机后缀（每次重下同一 id 被 OKX 拒重复），
// 且带下划线前缀匹配不上 OKX 回报的无下划线 id（所有权检查永远不中），
// 故 algo 单与网格单一样必须用无分隔符格式。
// 长度预算：algo 开销 16（12 位时间 + A + kind + 2 位后缀）；但 symbol 限额
// 由 SYMBOL_TOKEN_LIMIT_BY_EXCHANGE 按 algo/网格两种 id 预算的较大开销推导
// （gateio 10 / okx 14 / binance 18，见下）。后缀短带来的撞 id 概率（1/1296）
// 由交易所拒重复 + 下个 tick 换后缀重试自愈。

const ALGO_KIND_CODE = { emergency: "E", grid: "G" } as const;

/** 各交易所 clientOrderId 最大长度（Gate 为 text ≤30 扣除 `t-` 前缀） */
export const MAX_CLIENT_ID_LEN_BY_EXCHANGE: Record<string, number> = {
  gateio: 28,
  okx: 32,
  binance: 36,
};

/** algo id 开销：12 位时间 + 'A' + 1 字符 kind + 2 位后缀 */
const ALGO_CLIENT_ID_OVERHEAD = 16;
/** 网格 id 开销：12 位时间 + B|S + seq 预留 5 位（nextSeq 跨重启持久增长，999 不够） */
const GRID_CLIENT_ID_OVERHEAD = 18;

// 权威值来自 shared-types（前后端单一源）；re-export 以保持既有 import 路径不变。
export { SYMBOL_TOKEN_LIMIT_BY_EXCHANGE } from '@gridpilot/shared-types';

// 由 codec 开销推导，仅供下方不变式测试断言与权威值一致（改 codec 开销不会静默失配）。
export const DERIVED_SYMBOL_TOKEN_LIMIT_BY_EXCHANGE: Record<string, number> = Object.fromEntries(
  Object.entries(MAX_CLIENT_ID_LEN_BY_EXCHANGE).map(([exchange, maxLen]) => [
    exchange,
    maxLen - Math.max(ALGO_CLIENT_ID_OVERHEAD, GRID_CLIENT_ID_OVERHEAD),
  ]),
);

export type AlgoOrderKind = keyof typeof ALGO_KIND_CODE;

export function encodeAlgoClientOrderId(
  sessionCode: string,
  kind: AlgoOrderKind,
  suffix: string,
): string {
  return `${sessionToken(sessionCode)}A${ALGO_KIND_CODE[kind]}${suffix}`;
}

export interface ParsedAlgoClientOrderId {
  token: string; // <symbol><yymmddHHMMSS>
  kind: AlgoOrderKind;
  suffix: string;
}

/**
 * 判断算法单 clientId 是否属于指定会话（runner 所有权检查与状态面板共用，
 * 防止两处谓词各自演化漂移）：
 * 新格式 `<token>A…`；旧格式 `${sessionCode}_algo_…`（Gate/Binance 回报原样）；
 * 旧格式截断态 `<token>algo…`（OKX 净化旧格式后的形态，残留单须仍可认领清理）。
 */
export function ownsSessionAlgoClientOrderId(clientOrderId: string | undefined, sessionCode: string): boolean {
  if (!clientOrderId) return false;
  const token = sessionToken(sessionCode);
  return (
    clientOrderId.startsWith(`${token}A`) ||
    clientOrderId.startsWith(`${sessionCode}_algo_`) ||
    clientOrderId.startsWith(`${token}algo`)
  );
}

/** 解析 algo 单 clientId。锚定 12 位时间段 + 'A' + 类别码；不匹配返回 null。 */
export function parseAlgoClientOrderId(id: string | undefined): ParsedAlgoClientOrderId | null {
  if (!id) return null;
  const m = /^(.+?\d{12})A([EG])([a-zA-Z0-9]+)$/.exec(id);
  if (!m) return null;
  return { token: m[1], kind: m[2] === "E" ? "emergency" : "grid", suffix: m[3] };
}

// ── Timestamp ─────────────────────────────────────────────────

export function nowMs(): number {
  return Date.now();
}

// ── Error Helpers ─────────────────────────────────────────────

export function isExchangeError(err: unknown): err is Error {
  return err instanceof Error;
}

export function extractErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
