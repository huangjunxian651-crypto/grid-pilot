// 交易所返佣比例（小数）。OKX/Binance 20%，Gate 40%。
export const REBATE_RATES: Record<string, number> = {
  binance: 0.2,
  okx: 0.2,
  gateio: 0.4,
};

// ── 返佣注册数据（全站共享，真实资产；不使用设计稿占位 rebateto.me/GRIDPILOT）──

export type ReferralExchange = "binance" | "okx" | "gateio";
export const REFERRAL_EXCHANGES: ReferralExchange[] = ["binance", "okx", "gateio"];

export const EXCHANGE_DISPLAY_NAME: Record<ReferralExchange, string> = {
  binance: "Binance",
  okx: "OKX",
  gateio: "Gate.io",
};

// 各所合约类型副标签（设计稿注册卡用）。
export const EXCHANGE_CONTRACT_LABEL: Record<ReferralExchange, string> = {
  binance: "USD-M 永续",
  okx: "SWAP 永续",
  gateio: "USDT 永续",
};

// 真实邀请码：Binance 用 fanwo20，OKX / Gate 用 fangeiwo。
export const INVITE_CODE: Record<ReferralExchange, string> = {
  binance: "fanwo20",
  okx: "fangeiwo",
  gateio: "fangeiwo",
};

// 各所官方注册链接（已带返佣码），远端镜像不可用时的兜底。
export const OFFICIAL_REGISTER_URL: Record<ReferralExchange, string> = {
  binance: "https://www.binance.com/join?ref=fanwo20",
  okx: "https://www.okx.com/join/fangeiwo",
  gateio: "https://www.gate.io/share/fangeiwo",
};

// 大陆备用镜像清单远端来源。
export const FANGEIWO_MIRROR_URL = "https://fangeiwo.net/invite_links.json";

/** 把远端 platform 字段归一化到内部交易所 id。 */
export function normalizeReferralPlatform(platform: string): ReferralExchange | null {
  const s = platform.toLowerCase();
  if (s.includes("binance")) return "binance";
  if (s.includes("okx")) return "okx";
  if (s.includes("gate")) return "gateio";
  return null;
}

/** 估算可返还金额 = 已付手续费 × 该所比例。非法手续费(负/NaN)归 0。 */
export function estimateRebate(exchangeId: string, feesPaid: number): number {
  const rate = REBATE_RATES[exchangeId] ?? 0;
  if (!Number.isFinite(feesPaid) || feesPaid <= 0) return 0;
  return feesPaid * rate;
}

/** 返还比例的整数百分比（用于文案 {rate}）。 */
export function rebateRatePercent(exchangeId: string): number {
  return Math.round((REBATE_RATES[exchangeId] ?? 0) * 100);
}

const MUTED_KEY = "gp.referral_muted";

export function isReferralMuted(): boolean {
  try {
    return localStorage.getItem(MUTED_KEY) === "1";
  } catch {
    return false;
  }
}

export function setReferralMuted(): void {
  try {
    localStorage.setItem(MUTED_KEY, "1");
  } catch {
    // localStorage 不可用时静默
  }
}

/** 机器人累计手续费首次突破该阈值（USDT）即触发一次性里程碑提示。单值、可调。
 * 取 50 而非更低值：避免高频网格下过快触发、削弱"里程碑"稀缺感、变成例行打扰。 */
export const MILESTONE_FEE_THRESHOLD = 50;

const MILESTONE_KEY = "gp.referral_milestone_shown";

function readMilestoneSet(): Set<string> {
  try {
    return new Set((localStorage.getItem(MILESTONE_KEY) || "").split(",").filter(Boolean));
  } catch {
    return new Set();
  }
}

export function isMilestoneShown(robotId: string): boolean {
  return readMilestoneSet().has(robotId);
}

export function markMilestoneShown(robotId: string): void {
  try {
    const set = readMilestoneSet();
    set.add(robotId);
    localStorage.setItem(MILESTONE_KEY, Array.from(set).join(","));
  } catch {
    // 静默
  }
}
