"use client";

import React, { Suspense } from "react";
import { Shell } from "@/components/shell/shell";
import { SectionHeader } from "@/components/ui/primitives";
import { RobotWizard } from "@/components/robots/robot-wizard";
import { useLang } from "@/lib/i18n-context";

export default function NewRobotPage() {
  const { t } = useLang();
  return (
    <Shell breadcrumb={[t("robot.page_title"), t("common.new")]}>
      <SectionHeader title={t("robot.new_title")} subtitle={t("robot.new_subtitle")} />
      <Suspense fallback={null}>
        <RobotWizard />
      </Suspense>
    </Shell>
  );
}
