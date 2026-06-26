export interface ConfigRow {
  id: string;
  credentialId: string;
  symbol: string;
  direction: string;
}

export interface RobotGroup {
  credentialId: string;
  symbol: string;
  direction: string;
  configIds: string[];
}

/**
 * 把存量箱体配置按 (credentialId, symbol, direction) 分组，每组将成为一个 GridRobot。
 * 用 direction 入键，避免把多空配置混进同一个机器人（§12.7 单向持仓）。
 * 分组顺序按首次出现的顺序，保证回填确定性。
 */
export function groupConfigsByRobot(configs: ConfigRow[]): RobotGroup[] {
  const groups = new Map<string, RobotGroup>();
  for (const c of configs) {
    const key = `${c.credentialId}|${c.symbol}|${c.direction}`;
    let g = groups.get(key);
    if (!g) {
      g = { credentialId: c.credentialId, symbol: c.symbol, direction: c.direction, configIds: [] };
      groups.set(key, g);
    }
    g.configIds.push(c.id);
  }
  return [...groups.values()];
}
