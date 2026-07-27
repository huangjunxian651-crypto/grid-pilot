"use client";

import React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/primitives";
import { Icons } from "@/components/ui/icons";
import { useLang } from "@/lib/i18n-context";
import { useReconcileRobot } from "@/lib/hooks/useBots";

/** 手动触发一次对账：拉交易所真实成交补齐缺口，并展示双侧持仓对比。
 * 只在机器人有活跃 run 时可见（RUNNING/PAUSED），STOPPED 时没有 run 可对账。 */
export function ReconcileButton({ robotId, status }: { robotId: string; status: string }) {
  const { t } = useLang();
  const reconcile = useReconcileRobot();

  if (status !== "RUNNING" && status !== "PAUSED") return null;

  // 失败时不在本地弹 toast：全局 QueryClient 的 MutationCache.onError（见
  // components/shell/providers.tsx）已经统一处理所有 mutation 失败，与 Pause/
  // Start 按钮同款约定（它们同样只传 onSuccess，不在本地重复处理 onError）。
  // 本地再弹一次会导致重复 toast，且不经 t() 包裹会直接暴露未翻译的后端错误文案。
  const handleClick = () => {
    reconcile.mutate(robotId, {
      onSuccess: (result) => {
        const message = result.positionMatches
          ? t("robot.reconcile_position_ok", { count: result.newFillsCount, qty: result.exchangePosition })
          : t("robot.reconcile_position_diff", {
              count: result.newFillsCount,
              dbQty: result.dbPosition,
              exchangeQty: result.exchangePosition,
            });
        toast.success(`${t("robot.toast_reconciled")}: ${message}`);
      },
    });
  };

  return (
    <Button
      variant="ghost"
      size="md"
      icon={<Icons.Refresh size={13} />}
      disabled={reconcile.isPending}
      onClick={handleClick}
      data-testid="reconcile-btn"
    >
      {t("robot.action_reconcile")}
    </Button>
  );
}
