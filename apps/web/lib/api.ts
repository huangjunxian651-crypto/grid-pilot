import {
  Credential,
  CreateCredentialInput,
  UpdateCredentialInput,
  Profile,
  UpdateProfileInput,
  AuthUser,
  NotificationItem as Notification,
  ExchangeId,
  FsmState,
  Direction,
} from "@gridpilot/shared-types";
import type { AccountSnapshot, PositionInfo } from "@gridpilot/shared-types";
export type { AccountSnapshot, PositionInfo } from "@gridpilot/shared-types";

const API_BASE = "/api";

const STATUS_DEFAULT_MESSAGES: Record<number, string> = {
  400: "请求参数错误",
  401: "登录已过期，请重新登录",
  403: "无权访问",
  404: "请求的资源不存在",
  409: "操作冲突，请刷新后重试",
  500: "服务异常，请稍后重试",
  502: "服务异常，请稍后重试",
  503: "服务暂不可用，请稍后重试",
};

const HTTP_STATUS_TEXTS = new Set([
  "Bad Request", "Unauthorized", "Forbidden", "Not Found",
  "Method Not Allowed", "Conflict", "Gone",
  "Internal Server Error", "Bad Gateway", "Service Unavailable",
  "Gateway Timeout",
]);

export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

function extractCode(text: string): string | undefined {
  try {
    const o = JSON.parse(text);
    return o && typeof o === "object" && typeof (o as any).code === "string" ? (o as any).code : undefined;
  } catch {
    return undefined;
  }
}

function extractMessage(text: string, status: number): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return text || STATUS_DEFAULT_MESSAGES[status] || `请求失败 (${status})`;
  }

  if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;

    if (obj.message != null) {
      if (Array.isArray(obj.message)) {
        return obj.message.length > 0
          ? obj.message.join("; ")
          : STATUS_DEFAULT_MESSAGES[status] || `请求失败 (${status})`;
      }
      if (typeof obj.message === "string") {
        if (HTTP_STATUS_TEXTS.has(obj.message)) {
          return STATUS_DEFAULT_MESSAGES[status] || `请求失败 (${status})`;
        }
        if (obj.message) return obj.message;
      }
    }

    if (typeof obj.error === "string" && obj.error && !HTTP_STATUS_TEXTS.has(obj.error)) {
      return obj.error;
    }
  }

  return STATUS_DEFAULT_MESSAGES[status] || `请求失败 (${status})`;
}

export async function fetchJson<T>(
  input: string,
  init?: RequestInit,
): Promise<T> {
  const url = input.startsWith("http") ? input : `${API_BASE}${input}`;

  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...init?.headers,
      },
    });
  } catch {
    throw new ApiError(0, "网络连接失败，请稍后重试");
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const msg = extractMessage(text, res.status);
    const code = extractCode(text);
    throw new ApiError(res.status, msg, code);
  }

  if (res.status === 204) {
    return undefined as T;
  }

  return res.json() as Promise<T>;
}

export type { Credential, CreateCredentialInput, UpdateCredentialInput, Profile, UpdateProfileInput, AuthUser, Notification, ExchangeId, FsmState, Direction };

export const credentialApi = {
  list: () => fetchJson<Credential[]>("/credentials"),
  get: (id: string) => fetchJson<Credential>(`/credentials/${id}`),
  create: (data: CreateCredentialInput) =>
    fetchJson<Credential>("/credentials", { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: UpdateCredentialInput) =>
    fetchJson<Credential>(`/credentials/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  remove: (id: string) =>
    fetchJson<void>(`/credentials/${id}`, { method: "DELETE" }),
};

// ── Bot Sessions / Runner ─────────────────────────────────────

export interface ActiveOrderDetail {
  id: string;
  side: "buy" | "sell";
  gridPrice: number;
  price: number;
  qty: number;
  route: "POC" | "GTC";
  placedAt: number;
}

export interface AlgoOrderDetail {
  type: 'emergency' | 'other';
  side: "sell" | "buy";
  triggerPrice: number;
  qty: number;
  closePosition?: boolean;
  status: "open" | "triggered";
  clientOrderId?: string;
}

export interface BotStatus {
  sessionCode: string;
  state: string;
  symbol: string;
  direction: string;
  price?: number;
  positionQty?: number;
  realizedPnl?: number;
  unrealizedPnl?: number;
  activeOrderDetail?: ActiveOrderDetail | null;
  algoOrders?: AlgoOrderDetail[];
  totalFills?: number;
  totalOrdersPlaced?: number;
  totalReorders?: number;
  entryPrice?: number;
  leverage?: number;
  marginType?: "CROSS" | "ISOLATED";
  totalWalletBalance?: number;
}

export interface DashboardKpi {
  activeBots: number;
  totalFills: number;
  totalOrdersPlaced: number;
  totalReorders: number;
  equity?: number;
  availableUsdt?: number;
}

export interface BotSessionConfig {
  id: string;
  symbol: string;
  direction: string;
  takeProfitPrice: number;
  mainGridCount: number;
  mainGridStep: number;
  mainGridPortionSize: number;
  leverage: number;
  stopLossGridCount: number;
  stopLossGridStep: number;
  isolationStep: number;
  activationPrice?: number;
  trailingCallbackRate?: number;
  excessProfitMultiplier?: number;
  reorderThreshold?: number;
  account?: {
    exchangeId: string;
    accountId: string;
    label: string;
  };
}

export interface BotSession {
  id: string;
  boxId: string;
  runCode: string;
  state: string;
  startedAt?: string;
  endedAt?: string;
  createdAt: string;
  updatedAt: string;
  box?: BotSessionConfig;
}

export interface BotOrder {
  id: string;
  sessionId: string;
  side: string;
  price?: number;
  qty: number;
  status: string;
  createdAt: string;
}

export interface StartBotResponse {
  success: boolean;
  sessionCode: string;
  state: string;
  sessionId: string;
}

export interface StopBotResponse {
  success: boolean;
  sessionCode: string;
}

export interface SessionListParams {
  state?: string;
  limit?: number;
  offset?: number;
}

export interface SessionListResponse {
  data: BotSession[];
  total: number;
  limit: number;
  offset: number;
}

export interface EngineEvent {
  id: string;
  configId: string;
  eventType: string;
  eventData: Record<string, unknown>;
  seq: number;
  createdAt: string;
  symbol: string | null;
  direction: string | null;
  route: string | null;
  accountLabel: string | null;
}

export interface EventAggregates {
  totalFee: number;
  totalSavings: number;
  totalRealizedPnl: number;
  makerCount: number;
  gtcCount: number;
  unknownRouteCount: number;
}

export interface EventListResponse {
  data: EngineEvent[];
  total: number;
  limit: number;
  offset: number;
  /** 仅 type=FILL 时存在：对完整过滤结果(不只当前页)的汇总，KPI 瓦片应读这里而不是对 data 做 reduce。 */
  aggregates?: EventAggregates;
}

export interface FillRecord {
  id: string;
  eventType: string;
  eventData: {
    type?: 'FILL';
    side: 'BUY' | 'SELL';
    fillQty: number;
    fillPrice: number;
    orderId?: string;
    clientOrderId?: string;
    gridIndex?: number;
    savings?: number;
    savingsRate?: number;
    fee?: number;
    feeAsset?: string;
    orderPrice?: number;
    avgGridPrice?: number;
  };
  seq: number;
  createdAt: string;
  boxId?: string;
}

export interface FillsResponse {
  data: FillRecord[];
  total: number;
  limit: number;
}

export interface BoxGeometry {
  id: string;
  direction: 'LONG' | 'SHORT';
  takeProfitPrice: number;
  mainGridCount: number;
  mainGridStep: number;
  stopLossGridCount: number;
  stopLossGridStep: number;
  isolationStep?: number | null;
}

export interface RobotSummaryMetrics {
  todayRealizedPnl: number;
  alphaTotal: number;
}

export interface RobotFillsResponse {
  data: FillRecord[];
  boxes: Record<string, BoxGeometry>;
  summary: RobotSummaryMetrics;
  total: number;
  limit: number;
  nextCursor?: string | null;
}

// ── Savings / Strategy Advantage ─────────────────────────────────

export interface FillSavings {
  fillId: string;
  fillPrice: number;
  fillQty: number;
  side: 'BUY' | 'SELL';
  gridIndex: number;
  savings: number;
  savingsRate: number;
  createdAt: string;
}

export interface SavingsSummary {
  totalSavings: number;
  totalSavingsRate: number;
  fillCount: number;
  buySavings: number;
  sellSavings: number;
  buyCount: number;
  sellCount: number;
  fills: FillSavings[];
}

export const dashboardApi = {
  get: () => fetchJson<DashboardKpi>("/trading-engine/dashboard"),
};

// P2-1 权益/Alpha 历史曲线
export type HistoryRange = "7d" | "30d" | "90d" | "all";

export interface EquityHistoryResponse {
  series: { t: number; equity: number }[];
  bucketMs: number;
}

export interface SavingsHistoryResponse {
  series: { t: number; alpha: number }[];
  bucketMs: number;
}

export const historyApi = {
  equity: (range: HistoryRange) => fetchJson<EquityHistoryResponse>(`/trading-engine/equity/history?range=${range}`),
  savings: (range: HistoryRange) => fetchJson<SavingsHistoryResponse>(`/trading-engine/savings/history?range=${range}`),
};

export interface EventsQueryParams {
  type?: string;
  limit?: number;
  offset?: number;
  robotId?: string;
  route?: "POC" | "GTC" | "UNKNOWN";
  search?: string;
  since?: string;
  until?: string;
  sortBy?: "time" | "notional" | "realizedPnl" | "fee";
  sortDir?: "asc" | "desc";
}

function buildEventsSearchParams(params?: EventsQueryParams): URLSearchParams {
  const search = new URLSearchParams();
  if (params?.type) search.set("type", params.type);
  if (params?.limit != null) search.set("limit", String(params.limit));
  if (params?.offset != null) search.set("offset", String(params.offset));
  if (params?.robotId) search.set("robotId", params.robotId);
  if (params?.route) search.set("route", params.route);
  if (params?.search) search.set("search", params.search);
  if (params?.since) search.set("since", params.since);
  if (params?.until) search.set("until", params.until);
  if (params?.sortBy) search.set("sortBy", params.sortBy);
  if (params?.sortDir) search.set("sortDir", params.sortDir);
  return search;
}

export const eventsApi = {
  list: (params?: EventsQueryParams) => {
    const qs = buildEventsSearchParams(params).toString();
    return fetchJson<EventListResponse>(`/trading-engine/events${qs ? `?${qs}` : ""}`);
  },
  exportUrl: (params?: Omit<EventsQueryParams, "limit" | "offset">) => {
    const qs = buildEventsSearchParams(params).toString();
    return `/api/trading-engine/events/export${qs ? `?${qs}` : ""}`;
  },
};


// ── Robots (multi-box) ──────────────────────────────────────────

export interface AddBoxInput {
  direction: string;
  takeProfitPrice: number;
  mainGridCount: number;
  mainGridStep: number;
  mainGridPortionSize: number;
  leverage: number;
  stopLossGridCount: number;
  stopLossGridStep: number;
  isolationStep?: number;
  activationPrice?: number;
  trailingEntry?: boolean;
}

export interface EditBoxInput {
  takeProfitPrice: number;
  mainGridCount: number;
  mainGridStep: number;
  mainGridPortionSize: number;
  leverage: number;
  stopLossGridCount: number;
  stopLossGridStep: number;
  isolationStep?: number;
  activationPrice?: number;
  trailingEntry?: boolean;
}

export interface RobotBox {
  id: string;
  direction: string;
  takeProfitPrice: number;
  mainGridCount: number;
  mainGridStep: number;
  mainGridPortionSize: number;
  leverage: number;
  stopLossGridCount: number;
  stopLossGridStep: number;
  isolationStep?: number;
  activationPrice: number;
  trailingEntry: boolean;
  trailingCallbackRate: number;
  excessProfitMultiplier: number;
  reorderThreshold: number;
  enabled: boolean;
  realizedPnl?: number;
  totalFees?: number;
  totalSavings?: number;
  netPnl?: number;
}

export interface Robot {
  id: string;
  symbol: string;
  direction: string;
  status: string;
  activeBoxId: string | null;
  activeSessionCode: string | null;
  managed: boolean;
  latestPrice: number | null;
  exchangeId: string;
  accountLabel: string;
  credentialId: string;
  boxCount: number;
  realizedPnl: number;
  totalFees: number;
  totalFunding: number;
  netPnl: number;
  totalPnl: number | null;
  activeBoxHighPrice: number | null;
  activeBoxLowPrice: number | null;
  lastPositionQty: number | null;
  lastEntryPrice: number | null;
  lastUnrealizedPnl: number | null;
  lastSnapshotAt: string | null;
  createdAt: string;
  endedAt: string | null;
  stopStage: string | null;
  stopWarning: string | null;
}

export interface RobotDetail extends Robot {
  boxes: RobotBox[];
  /** 活跃 session 的当前 FSM 状态（Run.state 真相源），供前端刷新时播种 FSM 时间线；无活跃 run 时为 null */
  activeFsmState: string | null;
}

export const robotApi = {
  list: () => fetchJson<Robot[]>("/trading-engine/robots"),
  listArchived: () => fetchJson<Robot[]>("/trading-engine/robots/archived"),
  get: (id: string) => fetchJson<RobotDetail>(`/trading-engine/robots/${id}`),
  create: (input: { credentialId: string; symbol: string; direction: string }) =>
    fetchJson<{ success: boolean; robotId: string }>("/trading-engine/robots", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  start: (id: string) =>
    fetchJson<{ success: boolean; robotId: string }>(`/trading-engine/robots/${id}/start`, { method: "POST" }),
  pause: (id: string) =>
    fetchJson<{ success: boolean; robotId: string }>(`/trading-engine/robots/${id}/pause`, { method: "POST" }),
  stop: (id: string, opts: { closePosition?: boolean } = {}) =>
    fetchJson<{ success: boolean; robotId: string; status: string }>(`/trading-engine/robots/${id}/stop`, {
      method: "POST",
      body: JSON.stringify({ closePosition: opts.closePosition ?? false }),
    }),
  reconcile: (id: string) =>
    fetchJson<{ success: boolean; robotId: string; newFillsCount: number; dbPosition: number; exchangePosition: number; positionMatches: boolean }>(
      `/trading-engine/robots/${id}/reconcile`,
      { method: "POST" },
    ),
  addBox: (robotId: string, input: AddBoxInput) =>
    fetchJson<{ success: boolean; boxId: string }>(`/trading-engine/robots/${robotId}/boxes`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  removeBox: (robotId: string, configId: string, closePosition: boolean) =>
    fetchJson<{ success: boolean }>(`/trading-engine/robots/${robotId}/boxes/${configId}?closePosition=${closePosition}`, {
      method: "DELETE",
    }),
  editBox: (robotId: string, configId: string, input: EditBoxInput) =>
    fetchJson<{ success: boolean }>(`/trading-engine/robots/${robotId}/boxes/${configId}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  boxPnl: (configId: string) =>
    fetchJson<{ realizedPnl: number; fillCount: number }>(`/trading-engine/configs/${configId}/pnl`),
  boxFills: (configId: string, limit = 100) =>
    fetchJson<{ data: Array<{ id: string; eventType: string; eventData: { side?: string; fillQty?: number; fillPrice?: number; gridIndex?: number }; seq: number; createdAt: string }>; total: number; limit: number }>(`/trading-engine/configs/${configId}/fills?limit=${limit}`),
  robotFills: (robotId: string, limit = 100, opts?: { cursor?: string; orderSearch?: string }) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (opts?.cursor) params.set("cursor", opts.cursor);
    if (opts?.orderSearch) params.set("orderSearch", opts.orderSearch);
    return fetchJson<RobotFillsResponse>(`/trading-engine/robots/${robotId}/fills?${params.toString()}`);
  },
};

// ── Profile ─────────────────────────────────────────────────────

export const profileApi = {
  get: () => fetchJson<Profile>("/profile"),
  update: (data: UpdateProfileInput) =>
    fetchJson<Profile>("/profile", { method: "PUT", body: JSON.stringify(data) }),
  delete: () => fetchJson<{ success: boolean }>("/profile", { method: "DELETE" }),
};

// ── Auth ──────────────────────────────────────────────────────

export const authApi = {
  me: () => fetchJson<AuthUser | null>("/auth/me", { credentials: "include" }),
  register: (data: { email: string; password: string; language?: string }) =>
    fetchJson<{ user: AuthUser }>("/auth/register", {
      method: "POST",
      body: JSON.stringify(data),
      credentials: "include",
    }),
  login: (data: { email: string; password: string }) =>
    fetchJson<{ user: AuthUser }>("/auth/login", {
      method: "POST",
      body: JSON.stringify(data),
      credentials: "include",
    }),
  logout: () =>
    fetchJson<void>("/auth/logout", {
      method: "POST",
      credentials: "include",
    }),
  changePassword: (data: { currentPassword: string; newPassword: string }) =>
    fetchJson<{ success: boolean }>("/auth/change-password", {
      method: "POST",
      body: JSON.stringify(data),
      credentials: "include",
    }),
};

// ── Notifications ──────────────────────────────────────────────

export const notificationApi = {
  list: () => fetchJson<Notification[]>("/notifications"),
  markRead: (id: string) =>
    fetchJson<Notification>(`/notifications/${id}/read`, { method: "PUT" }),
  markAllRead: () =>
    fetchJson<{ success: boolean }>("/notifications/read-all", { method: "PUT" }),
  deleteAll: () =>
    fetchJson<{ success: boolean }>("/notifications", { method: "DELETE" }),
};

export async function getAccount(credentialId: string): Promise<AccountSnapshot> {
  return fetchJson<AccountSnapshot>(`/trading-engine/account/${credentialId}`);
}

export async function getAccounts(): Promise<AccountSnapshot[]> {
  return fetchJson<AccountSnapshot[]>("/trading-engine/accounts");
}

// ── Savings API ─────────────────────────────────────────────────

export const savingsApi = {
  getConfigSavings: (configId: string, limit?: number) => {
    const qs = limit ? `?limit=${limit}` : '';
    return fetchJson<SavingsSummary>(`/trading-engine/savings/config/${configId}${qs}`);
  },

};

// ── AI Grid Recommendations ──────────────────────────────────────

export type AiRiskTier = "low" | "mid" | "high";
export type AiEvidenceMetricKey = "realized_vol" | "range_pct" | "atr" | "max_drawdown" | "trend" | "vpvr_node";
export interface AiEvidence { metricKey: AiEvidenceMetricKey; value: string; }
export interface GridRecommendation {
  label: string; direction: "LONG" | "SHORT";
  boxLowPrice: number; boxHighPrice: number; takeProfitPrice: number;
  mainGridCount: number; mainGridStep: number; mainGridPortionSize: number; leverage: number;
  stopLossGridCount: number; stopLossGridStep: number; isolationStep: number;
  confidence: number; rationale: string; evidence: AiEvidence[];
  /** 后端 deriveRisk 校正后的最终风险等级（展示用）。 */
  riskTierFinal?: AiRiskTier;
  riskScore?: number;
}
export interface GridRecommendationsResponse {
  symbol: string; direction: "LONG" | "SHORT"; asOf: string; currentPrice: number;
  windows: Record<string, { days: number; currentPrice: number; high: number; low: number; rangePct: number; realizedVol: number; atr: number; maxDrawdownPct: number; trendPct: number }>;
  vpvr: { priceLow: number; priceHigh: number; bins: number[] };
  recommendations: GridRecommendation[];
}

export interface AiJobStatus {
  status: "pending" | "done" | "error";
  result?: GridRecommendationsResponse;
  errorCode?: string;
}

/** 每个交易对最近一次后台分析结果（= 完整推荐结果 + 落库时间）。 */
export type LatestRecommendation = GridRecommendationsResponse & { updatedAt: string };

export const aiApi = {
  /** 同步生成（快模型用）；慢推理模型请走异步任务，避免代理超时。language 指定 label/rationale 生成语种。 */
  gridRecommendations: (symbol: string, direction: string, language = "zh") =>
    fetchJson<GridRecommendationsResponse>(`/ai/grid-recommendations?symbol=${encodeURIComponent(symbol)}&direction=${direction}&language=${encodeURIComponent(language)}`),
  /** 异步：创建生成任务，立即返回 jobId。 */
  startJob: (symbol: string, direction: string, language = "zh") =>
    fetchJson<{ jobId: string; status: string }>(`/ai/grid-recommendations/jobs?symbol=${encodeURIComponent(symbol)}&direction=${direction}&language=${encodeURIComponent(language)}`, { method: "POST" }),
  /** 异步：查任务状态/结果。 */
  jobStatus: (jobId: string) =>
    fetchJson<AiJobStatus>(`/ai/grid-recommendations/jobs/${jobId}`),
  /** 每个交易对最近一次后台分析结果（打开页面即展示）。language 指定展示语种（无缓存回退 zh）。 */
  latestRecommendations: (language = "zh") =>
    fetchJson<LatestRecommendation[]>(`/ai/recommendations/latest?language=${encodeURIComponent(language)}`),
};

export interface AiSettingsMasked {
  provider: "anthropic" | "openai";
  anthropicModel: string;
  anthropicBaseUrl: string | null;
  openaiModel: string | null;
  openaiBaseUrl: string | null;
  hasAnthropicKey: boolean;
  hasOpenaiKey: boolean;
}
export interface AiSettingsUpdate {
  provider?: string;
  anthropicApiKey?: string;
  anthropicModel?: string;
  anthropicBaseUrl?: string;
  openaiApiKey?: string;
  openaiModel?: string;
  openaiBaseUrl?: string;
}

export const aiSettingsApi = {
  get: () => fetchJson<AiSettingsMasked>("/ai/settings"),
  update: (data: AiSettingsUpdate) => fetchJson<AiSettingsMasked>("/ai/settings", { method: "PUT", body: JSON.stringify(data) }),
};
