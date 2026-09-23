import type { WindowFeatures, Vpvr } from "../market-features";

export interface GridAdvisorInput {
  symbol: string;
  direction: "LONG" | "SHORT";
  currentPrice: number;
  windows: Record<string, WindowFeatures>;
  vpvr: Vpvr;
}

export type RiskTier = "low" | "mid" | "high";

/** 证据指标键（结构化，前端按 key 做 i18n + 术语提示）。 */
export type EvidenceMetricKey =
  | "realized_vol" | "range_pct" | "atr" | "max_drawdown" | "trend" | "vpvr_node";
export const EVIDENCE_METRIC_KEYS: EvidenceMetricKey[] = [
  "realized_vol", "range_pct", "atr", "max_drawdown", "trend", "vpvr_node",
];

export interface EvidenceItem { metricKey: EvidenceMetricKey; value: string; }

export interface GridRecommendation {
  label: string;
  direction: "LONG" | "SHORT";
  boxLowPrice: number;
  boxHighPrice: number;
  takeProfitPrice: number;
  mainGridCount: number;
  mainGridStep: number;
  mainGridPortionSize: number;
  leverage: number;
  stopLossGridCount: number;
  stopLossGridStep: number;
  isolationStep: number;
  confidence: number;
  rationale: string;
  evidence: EvidenceItem[];
  /** LLM 自报风险初判（hint，仅存不展示）。 */
  riskTier?: RiskTier;
  /** 后端 deriveRisk 校正后的最终风险（展示用，shaping 阶段填）。 */
  riskTierFinal?: RiskTier;
  riskScore?: number;
}

/** 结构化输出 JSON Schema（Anthropic output_config.format / OpenAI response_format 共用）。 */
export const GRID_RECS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    recommendations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          label: { type: "string" },
          direction: { type: "string", enum: ["LONG", "SHORT"] },
          boxLowPrice: { type: "number" },
          boxHighPrice: { type: "number" },
          takeProfitPrice: { type: "number" },
          mainGridCount: { type: "integer" },
          mainGridStep: { type: "number" },
          mainGridPortionSize: { type: "number" },
          leverage: { type: "integer" },
          stopLossGridCount: { type: "integer" },
          stopLossGridStep: { type: "number" },
          isolationStep: { type: "number" },
          confidence: { type: "number" },
          riskTier: { type: "string", enum: ["low", "mid", "high"] },
          rationale: { type: "string" },
          evidence: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                metricKey: { type: "string", enum: ["realized_vol", "range_pct", "atr", "max_drawdown", "trend", "vpvr_node"] },
                value: { type: "string" },
              },
              required: ["metricKey", "value"],
            },
          },
        },
        required: ["label","direction","boxLowPrice","boxHighPrice","takeProfitPrice","mainGridCount","mainGridStep","mainGridPortionSize","leverage","stopLossGridCount","stopLossGridStep","isolationStep","confidence","riskTier","rationale","evidence"],
      },
    },
  },
  required: ["recommendations"],
} as const;

/** UI 语言代码 → 人类可读语言名（喂给 LLM 的「用 X 作答」指令，比裸代码更可靠，尤其区分简/繁中文）。 */
const LANGUAGE_NAMES: Record<string, string> = {
  zh: "简体中文", "zh-TW": "繁體中文", "zh-HK": "繁體中文", en: "English",
  ja: "日本語", es: "Español", ar: "العربية", fr: "Français",
  pt: "Português", it: "Italiano", ko: "한국어", th: "ไทย", vi: "Tiếng Việt",
};
/** 把语言代码解析为人类可读名；已是名/未知则原样返回。 */
export function resolveLanguageName(language?: string): string | undefined {
  if (!language) return undefined;
  return LANGUAGE_NAMES[language] ?? language;
}

export function buildSystemPrompt(language?: string): string {
  return [
    "You are a grid-trading strategy advisor for GridPilot, a perpetual-futures dynamic grid bot.",
    ...(language ? [`IMPORTANT: Write every \`label\` and \`rationale\` in ${language}. Keep \`evidence\` metricKey/value and all numbers as-is.`, ""] : []),
    "",
    "## Domain: what a grid 'box' is",
    "A box is a price range [boxLowPrice, boxHighPrice] in which the bot places a ladder of orders to BUY LOW and SELL HIGH, capturing oscillation. Key parameters:",
    "- direction: LONG or SHORT.",
    "- takeProfitPrice: the profit-side anchor price (LONG = the high end, SHORT = the low end).",
    "- mainGridCount × mainGridStep: the main grid — number of levels and the price spacing between them. Main grid depth = mainGridCount * mainGridStep.",
    "- mainGridPortionSize: USDT notional value invested per grid level; the runtime converts it to contracts/coins using the grid price.",
    "- leverage: futures leverage.",
    "- stopLossGridCount × stopLossGridStep: the stop-loss ladder beyond the full-position line. Set stopLossGridCount=0 for no stop loss.",
    "- isolationStep: width of the isolation band between main grid and stop-loss zone.",
    "",
    "## Objective",
    "Given recent market data, recommend grid configs that MAXIMIZE round-trip fills (capturing volatility within the box) WHILE controlling tail risk (price exiting the box and hitting stop-loss/liquidation). A box too narrow gets exited often; too wide trades too sparsely.",
    "",
    "## Hard constraints (must satisfy)",
    "- All prices > 0 and near the current price / window highs-lows / VPVR high-volume nodes.",
    "- mainGridCount >= 1, mainGridStep > 0, mainGridPortionSize > 0, leverage >= 1.",
    "- If stopLossGridCount > 0: stopLossGridStep > 0, isolationStep > 0, and the stop-loss range (stopLossGridCount*stopLossGridStep) must be <= 1/5 of total box depth.",
    "- boxLowPrice < boxHighPrice; takeProfitPrice within [boxLowPrice, boxHighPrice].",
    "",
    "## Output",
    "Return EXACTLY 2 to 3 recommendations. PRIORITIZE robust, lower-risk configs — most users want conservative setups.",
    "Cover conservative/balanced/aggressive styles but LEAN conservative; do NOT return only high-leverage or narrow-box (high-risk) setups. At least one must be a wide defensive config (lower leverage, with stop-loss, wider range).",
    "For each rec output `riskTier` (one of low|mid|high) reflecting its leverage, box width vs volatility, and stop-loss.",
    "Each: a short label, a confidence in [0,1], a one-line rationale, and concrete `evidence` — an array where each item has a `metricKey` (one of: realized_vol, range_pct, atr, max_drawdown, trend, vpvr_node) and a formatted `value` string (e.g. \"3.2%\", \"1885\"). Treat any profit estimate as a qualitative estimate, NOT a backtest.",
    "Choose mainGridStep relative to recent volatility/ATR so levels are neither too dense nor too sparse. Anchor boxLow/boxHigh to window highs/lows and VPVR nodes.",
  ].join("\n");
}

export function buildUserPrompt(input: GridAdvisorInput, language?: string): string {
  return [
    ...(language ? [`Write label/rationale in ${language}.`, ""] : []),
    `symbol: ${input.symbol}`,
    `direction: ${input.direction}`,
    `currentPrice: ${input.currentPrice}`,
    "",
    "windowFeatures (days -> features):",
    JSON.stringify(input.windows),
    "",
    "vpvr (volume-by-price histogram, low->high):",
    JSON.stringify(input.vpvr),
    "",
    "Recommend 2-3 grid configs per the system instructions. Anchor all prices near currentPrice and the VPVR high-volume nodes.",
  ].join("\n");
}
