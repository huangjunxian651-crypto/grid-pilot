-- 机器人唯一性基准从 (credentialId, symbol) 切到物理正确的 (exchangeAccountId, symbol)。
-- 删除上一轮加的冗余索引：它被 GridRobot_active_unique (symbol, exchangeAccountId) 蕴含
-- （同凭证必同账户），且粒度偏松（放行同账户跨凭证）。活跃唯一性改由 GridRobot_active_unique 承载。
DROP INDEX IF EXISTS "GridRobot_credentialId_symbol_active_key";
