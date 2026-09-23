"use client";

import { create } from "zustand";
import { deriveBoxLines, toPrice, type BoxGeometryConfig } from "@gridpilot/shared-types";
import type { BoxGeometry } from "@/lib/api";

// ── 本地 BoxLayout（由 deriveBoxLines 导出字段合成）────────────
/** GridLadder 所需的绝对价格布局，由 deriveLayout 产出。 */
export interface BoxLayout {
  // 绝对边界（直接由 BoxLines 映射）
  takeProfitPrice: number;
  fullPositionPrice: number;
  stopLossStartPrice: number;
  liquidationPrice: number;
  boxHighPrice: number;
  boxLowPrice: number;
  // 便于组件访问的 d 空间标量
  mainGridDepth: number;
  isolationEndDepth: number;
  boxDepth: number;
  // 图表辅助字段
  gridStep: number;
  activationPrice: number;
  mainGridCount: number;
}

export type DeriveLayoutInput = BoxGeometryConfig & { activationPrice?: number };

/** deriveBoxLines 的便利包装，补充图表辅助字段。 */
export function deriveLayout(config: DeriveLayoutInput): BoxLayout {
  const lines = deriveBoxLines(config);
  return {
    ...lines,
    gridStep: config.mainGridStep,
    // 默认激活价 = 主网格中点（d = mainGridDepth/2），与后端 decide-box-activation 一致
    activationPrice: config.activationPrice ?? toPrice(lines.mainGridDepth / 2, config),
    mainGridCount: config.mainGridCount,
  };
}

// ── Types ──────────────────────────────────────────────────────
export interface RangeConfig {
  id: string;
  symbol: string;
  exchange: "binance" | "gateio" | "okx";
  direction: "LONG" | "SHORT";
  takeProfitPrice: number;
  mainGridCount: number;
  mainGridStep: number;
  mainGridPortionSize: number;
  mainGridPortionValue?: number;
  stopLossGridCount: number;
  stopLossGridStep: number;
  isolationStep: number;
  leverage: number;
  trailingCallbackRate: number;
  excessProfitMultiplier?: number;
  reorderThreshold: number;
  activationPrice?: number;
}

export interface Fill {
  id: string;
  ts: number;
  side: "buy" | "sell";
  gridIndex: number;
  price: number;
  qty: number;
  route: "POC" | "GTC";
  fee: number;
  feeAsset?: string;
  savings?: number;
  savingsRate?: number;
  boxId?: string;
  orderPrice?: number;
  avgGridPrice?: number;
}

export interface AlgoOrder {
  type: 'emergency' | 'other';
  side: "sell" | "buy";
  triggerPrice: number;
  qty: number;
  closePosition?: boolean;
  status: "open" | "triggered";
}

export interface ActiveOrder {
  id: string;
  side: "buy" | "sell";
  gridPrice: number;
  price: number;
  qty: number;
  route: "POC" | "GTC";
  placedAt: number;
}

export interface LiveState {
  layout: BoxLayout;
  price: number;
  /** 是否有真实行情（WS 或 REST）。false 时 price 仅为布局用几何中点，禁止当行情展示。 */
  priceKnown: boolean;
  bestBid: number;
  bestAsk: number;
  lastPrice: number;
  priceTrend: number;
  fsm: "SLEEPING" | "TRAILING_ENTRY" | "RUNNING" | "LIQUIDATING" | "LIQUIDATED" | "TAKE_PROFIT" | "PAUSED" | "CANCELLED" | "HOLD";
  positionQty: number;
  positionAvgCost: number;
  unrealizedPnl: number;
  actualLeverage: number;
  marginType: "CROSS" | "ISOLATED";
  realizedPnl: number;
  totalWalletBalance?: number;
  makerSavings: number;
  gtcExcess: number;
  gridCycles: number;
  gtcHits: number;
  reorders: number;
  activeOrder: ActiveOrder | null;
  fills: Fill[];
  algoOrders: AlgoOrder[];
  trailingExtreme: number | null;
  sessionStartedAt: number;
  // 新增止损相关字段
  targetBoughtSize?: number;
  targetHoldSize?: number;
  currentZone?: 'MAIN' | 'ISOLATION' | 'STOP_LOSS' | 'PROFIT_EXIT' | 'LOSS_EXIT';
  currentGridIndex?: number;
  /** 箱体几何映射，用于在成交流中渲染箱体标签 */
  boxes?: Record<string, BoxGeometry>;
}

export interface Account {
  totalEquity: number;
  availableUsdt: number;
  marginUsed: number;
  updatedAt: number;
}

// ── Re-exports ─────────────────────────────────────────────────
export type { PredictAction, PredictResult, PredictInput } from "@gridpilot/shared-types";
export { predictActions } from "@gridpilot/shared-types";

// ── Formatters ─────────────────────────────────────────────────
export const fmt = {
  usd: (n: number | null | undefined, d = 2) => (n ?? 0).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }),
  coin: (n: number | null | undefined, d = 4) => (n ?? 0).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }),
  pct: (n: number | null | undefined, d = 2) => ((n ?? 0) * 100).toFixed(d) + "%",
  signed: (n: number | null | undefined, d = 2) => { const v = n ?? 0; return (v >= 0 ? "+" : "") + v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }); },
  ago: (ts: number, lang: string = "en") => {
    const s = Math.floor((Date.now() - ts) / 1000);
    if (lang === "zh" || lang === "zh-TW") {
      if (s < 60) return s + "秒前";
      if (s < 3600) return Math.floor(s / 60) + "分钟前";
      if (s < 86400) return Math.floor(s / 3600) + "小时前";
      return Math.floor(s / 86400) + "天前";
    }
    if (s < 60) return s + "s ago";
    if (s < 3600) return Math.floor(s / 60) + "m ago";
    if (s < 86400) return Math.floor(s / 3600) + "h ago";
    return Math.floor(s / 86400) + "d ago";
  },
  time: (ts: number) => new Date(ts).toLocaleTimeString("en-GB", { hour12: false }),
  exchangeName: (id: string) => ({ binance: "Binance", gateio: "Gate.io", okx: "OKX" }[id] || id),
};

// ── Theme store ────────────────────────────────────────────────
type Theme = "dark" | "light";
const THEME_KEY = "gp-theme";

/** 读取已持久化的主题偏好（默认 dark）。供 store 初始化与防闪 script 复用。 */
export function readInitialTheme(): Theme {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === "light" || v === "dark" ? v : "dark";
  } catch {
    return "dark";
  }
}

interface ThemeStore {
  theme: Theme;
  toggleTheme: () => void;
}

export const useThemeStore = create<ThemeStore>((set) => ({
  // 固定 dark 初值以保证 SSR 与客户端首帧一致（避免 hydration mismatch）；
  // 持久化偏好由 Providers 挂载后 effect 同步，CSS 由 layout 内联 script 预置。
  theme: "dark",
  toggleTheme: () => set((s) => {
    const next: Theme = s.theme === "dark" ? "light" : "dark";
    try { localStorage.setItem(THEME_KEY, next); } catch { /* noop */ }
    document.documentElement.setAttribute("data-theme", next);
    return { theme: next };
  }),
}));

export function aggregateSnapshots(snaps: { totalEquity: number; availableUsdt: number; marginUsed: number }[]): Account {
  return snaps.reduce(
    (acc, s) => ({
      totalEquity: acc.totalEquity + s.totalEquity,
      availableUsdt: acc.availableUsdt + s.availableUsdt,
      marginUsed: acc.marginUsed + s.marginUsed,
      updatedAt: 0,
    }),
    { totalEquity: 0, availableUsdt: 0, marginUsed: 0, updatedAt: 0 },
  );
}

interface AccountStore {
  snapshots: import('./api').AccountSnapshot[];
  setSnapshots: (s: import('./api').AccountSnapshot[]) => void;
  updateSnapshot: (snap: import('./api').AccountSnapshot) => void;
}

export const useAccountStore = create<AccountStore>((set) => ({
  snapshots: [],
  setSnapshots: (s) => set({ snapshots: s }),
  updateSnapshot: (snap) =>
    set((state) => ({
      snapshots: state.snapshots.map((s) =>
        s.credentialId === snap.credentialId ? snap : s,
      ),
    })),
}));

/**
 * 箱体派生标签：方向 + 价格区间（Box 无存储名称）。
 * isolationStep 为真实可空列，缺省回退 stopLossGridStep。
 */
export function boxLabel(geometry: {
  direction: "LONG" | "SHORT";
  takeProfitPrice: number;
  mainGridCount: number;
  mainGridStep: number;
  stopLossGridCount: number;
  stopLossGridStep: number;
  isolationStep?: number | null;
}): string {
  const lines = deriveBoxLines({ ...geometry, isolationStep: geometry.isolationStep ?? geometry.stopLossGridStep });
  const arrow = geometry.direction === "LONG" ? "↑" : "↓";
  return `${arrow} ${lines.boxLowPrice.toFixed(0)}–${lines.boxHighPrice.toFixed(0)}`;
}
