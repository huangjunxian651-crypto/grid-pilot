# 手续费与资金费文档

站内页面 `/learn/fees`（`apps/web/app/learn/fees/page.tsx` → `<FeesInfographic/>`）已从早期的 markdown 长文重做成**组件化图文信息图**。正文不再以 markdown 维护：

- 版式与图表组件：`apps/web/app/learn/fees/_components/`（`FeeShockHero`、`FeeWhyCard`、`MakerTakerCard`、`FundingCard`、`FeeSaveCard` 等）。
- 文案：`apps/web/lib/i18n.ts` 中的 `learn.fees.*` 键（zh/en + 各语言 overlay，共 12 语言）。
- 返佣注册引导：共享组件 `apps/web/components/referral/referral-cta.tsx`（`referral.*` 键）。

旧的 `apps/web/content/learn/fees-and-funding.{zh,en}.md` 与对应的 load-doc 加载逻辑已删除，勿再去找或在此复制正文。
