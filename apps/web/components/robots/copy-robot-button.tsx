"use client";

import React from "react";
import Link from "next/link";
import { Button } from "@/components/ui/primitives";
import { Icons } from "@/components/ui/icons";
import { useLang } from "@/lib/i18n-context";

/** 从（通常已归档的）机器人复制配置，跳到预填向导。三处复用：归档区/归档列表/详情页。 */
export function CopyRobotButton({ robotId }: { robotId: string }) {
  const { t } = useLang();
  return (
    <Link href={`/robots/new?from=${robotId}`}>
      <Button variant="ghost" size="sm" icon={<Icons.Copy size={13} />}>{t("common.copy")}</Button>
    </Link>
  );
}
