import { deriveLayout, type BoxLayout } from "@/lib/store";
import { boxGeometryError, type BoxGeometryError } from "@/lib/box-geometry-error";
import type { AddBoxInput, RobotBox } from "@/lib/api";

/** 箱体参数表单值（全部字符串，对应受控输入框）。 */
export interface BoxFormValue {
  takeProfitPrice: string;
  mainGridCount: string;
  mainGridStep: string;
  mainGridPortionSize: string;
  leverage: string;
  stopLossGridCount: string;
  stopLossGridStep: string;
  isolationStep: string;
  activationPrice: string;
}

/** 新增箱体默认值，镜像详情页 openAddBox。 */
export function emptyBoxFormValue(): BoxFormValue {
  return {
    takeProfitPrice: "", mainGridCount: "", mainGridStep: "", mainGridPortionSize: "",
    leverage: "20", stopLossGridCount: "4", stopLossGridStep: "",
    isolationStep: "", activationPrice: "",
  };
}

/** 由箱体生成表单值，镜像详情页 openEditBox。 */
export function boxFormValueFromBox(b: RobotBox): BoxFormValue {
  return {
    takeProfitPrice: String(b.takeProfitPrice),
    mainGridCount: String(b.mainGridCount),
    mainGridStep: String(b.mainGridStep),
    mainGridPortionSize: String(b.mainGridPortionSize),
    leverage: String(b.leverage),
    stopLossGridCount: String(b.stopLossGridCount),
    stopLossGridStep: String(b.stopLossGridStep),
    isolationStep: b.isolationStep != null ? String(b.isolationStep) : "",
    activationPrice: b.activationPrice > 0 ? String(b.activationPrice) : "",
  };
}

/** 装配为 AddBoxInput，镜像详情页 submitBox：空的 activation/isolation 省略。 */
export function boxFormValueToAddBoxInput(v: BoxFormValue, direction: string): AddBoxInput {
  const act = v.activationPrice.trim() === "" ? undefined : Number(v.activationPrice);
  const isolStep = v.isolationStep.trim() === "" ? undefined : Number(v.isolationStep);
  return {
    direction,
    takeProfitPrice: Number(v.takeProfitPrice),
    mainGridCount: parseInt(v.mainGridCount, 10),
    mainGridStep: Number(v.mainGridStep),
    mainGridPortionSize: Number(v.mainGridPortionSize),
    leverage: parseInt(v.leverage, 10),
    stopLossGridCount: parseInt(v.stopLossGridCount, 10),
    stopLossGridStep: Number(v.stopLossGridStep),
    ...(act != null ? { activationPrice: act } : {}),
    ...(isolStep != null ? { isolationStep: isolStep } : {}),
  };
}

/** 预览布局，镜像详情页 previewLayout memo；参数不全返回 null。 */
export function boxFormPreviewLayout(v: BoxFormValue, direction: string): BoxLayout | null {
  const takeProfitPrice = Number(v.takeProfitPrice);
  const count = parseInt(v.mainGridCount, 10);
  const step = Number(v.mainGridStep);
  const slCount = parseInt(v.stopLossGridCount, 10);
  const slStep = Number(v.stopLossGridStep);
  if (!(takeProfitPrice > 0) || !(count > 0) || !(step > 0)) return null;
  const act = v.activationPrice.trim() === "" ? undefined : Number(v.activationPrice);
  return deriveLayout({
    takeProfitPrice, mainGridCount: count, mainGridStep: step,
    stopLossGridCount: Number.isFinite(slCount) ? slCount : 0,
    stopLossGridStep: Number.isFinite(slStep) ? slStep : 0,
    isolationStep: v.isolationStep.trim() !== "" ? Number(v.isolationStep) : (Number.isFinite(slStep) ? slStep : 0),
    activationPrice: act,
    direction: (direction === "SHORT" ? "SHORT" : "LONG"),
  });
}

/** 几何 + 激活价校验，均返回 i18n 错误键（供组件 t() 翻译）。 */
export function boxFormErrors(
  v: BoxFormValue,
  direction: string,
): { geometry: BoxGeometryError | null; activation: BoxGeometryError | null } {
  const geometry = boxGeometryError({
    direction,
    takeProfitPrice: Number(v.takeProfitPrice),
    mainGridCount: parseInt(v.mainGridCount, 10),
    mainGridStep: Number(v.mainGridStep),
    stopLossGridCount: parseInt(v.stopLossGridCount, 10),
    stopLossGridStep: Number(v.stopLossGridStep),
  });

  let activation: BoxGeometryError | null = null;
  const layout = boxFormPreviewLayout(v, direction);
  if (layout && v.activationPrice.trim() !== "") {
    const val = Number(v.activationPrice);
    const lo = Math.min(layout.takeProfitPrice, layout.fullPositionPrice);
    const hi = Math.max(layout.takeProfitPrice, layout.fullPositionPrice);
    if (!(val > lo && val < hi)) {
      activation = { key: "robot.activation_range_error", params: { lo: lo.toFixed(2), hi: hi.toFixed(2) } };
    }
  }
  return { geometry, activation };
}

/** 由 AI 推荐的箱体参数生成表单值（用于向导 seedBox 预填）。 */
export function boxFormValueFromRecommendation(r: {
  takeProfitPrice: number;
  mainGridCount: number;
  mainGridStep: number;
  mainGridPortionSize: number;
  leverage: number;
  stopLossGridCount: number;
  stopLossGridStep: number;
  isolationStep: number;
}): BoxFormValue {
  return {
    takeProfitPrice: String(r.takeProfitPrice),
    mainGridCount: String(r.mainGridCount),
    mainGridStep: String(r.mainGridStep),
    mainGridPortionSize: String(r.mainGridPortionSize),
    leverage: String(r.leverage),
    stopLossGridCount: String(r.stopLossGridCount),
    stopLossGridStep: String(r.stopLossGridStep),
    isolationStep: String(r.isolationStep),
    activationPrice: "",
  };
}
