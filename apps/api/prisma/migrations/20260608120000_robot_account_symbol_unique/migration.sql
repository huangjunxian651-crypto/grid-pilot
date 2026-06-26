-- 不变量：同一 (credentialId, symbol) 至多一个未结束 (endedAt IS NULL) 的 GridRobot。
-- 偏唯一索引：仅约束活跃机器人，已结束 (endedAt 非空) 的历史行不参与唯一性。
CREATE UNIQUE INDEX "GridRobot_credentialId_symbol_active_key"
  ON "GridRobot" ("credentialId", "symbol")
  WHERE "endedAt" IS NULL;
