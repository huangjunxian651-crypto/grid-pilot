"use client";

import React, { useMemo } from "react";
import { Field } from "@/components/ui/primitives";
import { GridLadder } from "@/components/charts/grid-ladder";
import { useLang } from "@/lib/i18n-context";
import { predictActions } from "@gridpilot/shared-types";
import {
  type BoxFormValue,
  boxFormPreviewLayout,
  boxFormErrors,
} from "./box-form-model";

export function BoxForm({
  value,
  onChange,
  direction,
  price,
}: {
  value: BoxFormValue;
  onChange: (v: BoxFormValue) => void;
  direction: "LONG" | "SHORT";
  price: number;
}) {
  const { t } = useLang();
  const set = (patch: Partial<BoxFormValue>) => onChange({ ...value, ...patch });

  const layout = useMemo(() => boxFormPreviewLayout(value, direction), [value, direction]);
  const errs = useMemo(() => boxFormErrors(value, direction), [value, direction]);

  const previewPrice = price > 0
    ? price
    : layout ? (layout.boxHighPrice + layout.boxLowPrice) / 2 : 0;

  const prediction = useMemo(() => {
    if (!layout) return null;
    try {
      const slStep = Number(value.stopLossGridStep);
      // isolationStep 缺省回退 stopLossGridStep，与 boxFormPreviewLayout 的防 NaN 逻辑对齐
      const isolationStep = value.isolationStep.trim() !== ""
        ? Number(value.isolationStep)
        : (Number.isFinite(slStep) ? slStep : 0);
      return predictActions({
        takeProfitPrice: Number(value.takeProfitPrice),
        mainGridCount: parseInt(value.mainGridCount, 10),
        mainGridStep: Number(value.mainGridStep),
        mainGridPortionSize: Number(value.mainGridPortionSize) || 0,
        stopLossGridCount: parseInt(value.stopLossGridCount, 10),
        stopLossGridStep: slStep,
        isolationStep,
        direction,
        price: previewPrice,
        positionQty: 0,
      });
    } catch {
      return null;
    }
  }, [layout, value, direction, previewPrice]);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "240px 1fr", gap: 20 }}>
      <div>
        <div style={{ fontSize: 10, color: "var(--fg-3)", textTransform: "uppercase", marginBottom: 6 }}>{t("robot.structure_preview")}</div>
        <div data-testid="box-anatomy-preview">
          {layout
            ? <GridLadder layout={layout} price={previewPrice} prediction={prediction} t={t} compact />
            : <div style={{ fontSize: 11, color: "var(--fg-3)", padding: 20, textAlign: "center", border: "1px solid var(--border-subtle)", borderRadius: 6 }}>{t("robot.preview_hint")}</div>}
        </div>
      </div>
      <div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label={t("robot.field_take_profit")} value={value.takeProfitPrice} onChange={(x) => set({ takeProfitPrice: x })} placeholder="2800" />
          <Field label={t("robot.field_grid_count")} value={value.mainGridCount} onChange={(x) => set({ mainGridCount: x })} placeholder="200" />
          <Field label={t("robot.field_grid_step")} value={value.mainGridStep} onChange={(x) => set({ mainGridStep: x })} placeholder="2" />
          <Field label={t("robot.field_portion")} value={value.mainGridPortionSize} onChange={(x) => set({ mainGridPortionSize: x })} placeholder="0.05" />
          <Field label={t("robot.cfg_leverage")} value={value.leverage} onChange={(x) => set({ leverage: x })} placeholder="20" />
          <Field label={t("robot.field_sl_count")} value={value.stopLossGridCount} onChange={(x) => set({ stopLossGridCount: x })} placeholder="4" />
          <Field label={t("robot.field_sl_step")} value={value.stopLossGridStep} onChange={(x) => set({ stopLossGridStep: x })} placeholder="2" />
          <Field label={`${t("bot.isolation_step")}${t("robot.field_isolation_suffix")}`} value={value.isolationStep} onChange={(x) => set({ isolationStep: x })} placeholder="2" />
          <Field label={t("robot.field_activation")} value={value.activationPrice} onChange={(x) => set({ activationPrice: x })} placeholder={t("robot.field_activation_ph")} />
        </div>
        {layout && errs.geometry && <div style={{ fontSize: 11, color: "var(--down)", marginTop: 8 }}>{t(errs.geometry.key, errs.geometry.params)}</div>}
        {errs.activation && <div style={{ fontSize: 11, color: "var(--down)", marginTop: 8 }}>{t(errs.activation.key, errs.activation.params)}</div>}
      </div>
    </div>
  );
}
