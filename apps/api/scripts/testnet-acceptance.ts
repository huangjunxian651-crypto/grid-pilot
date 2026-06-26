#!/usr/bin/env tsx
/**
 * GridPilot Testnet 人工验收脚本
 *
 * 用法:
 *   npx tsx apps/api/scripts/testnet-acceptance.ts --exchange=gateio --yes [--env=/path/.env.testnet] [--symbol=ETH_USDT]
 *
 * 依赖:
 *   - .env.testnet 含有效测试网凭证（主仓库根，或用 --env 显式指定）
 *   - 交易所测试网/Demo 环境可达
 *
 * 性质:
 *   人工辅助核对工具 —— 顺序驱动真实 GridBotRunner,打印每一步的交易所返回与 runner 状态,
 *   由人工判断 futures-grid-go/TODO.md 五大目标的 PASS/FAIL。
 *   **不做自动断言**(真实行情不确定),不 import vitest,不写 expect。
 *
 * ╔════════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️  警告: 此脚本会在交易所【真实下单 / 真实平仓 / 真实取消订单】。            ║
 * ║      虽然三所适配器当前硬编码连接 Testnet/Demo 环境(见“已知限制”),          ║
 * ║      仍请务必确认 .env.testnet 中是 *测试网* 凭证,切勿填入主网 Key。          ║
 * ║      必须显式传入 --yes 才会真正执行,否则脚本只打印警告并安全退出。           ║
 * ╚════════════════════════════════════════════════════════════════════════════╝
 */

import { readFileSync, existsSync } from 'fs';
import * as path from 'path';

import { GateioAdapter } from '../src/modules/exchange/adapters/gateio/gateio.adapter';
import { BinanceAdapter } from '../src/modules/exchange/adapters/binance/binance.adapter';
import { OkxAdapter } from '../src/modules/exchange/adapters/okx/okx.adapter';
import type { IExchangeAdapter } from '../src/modules/exchange/interfaces/exchange-adapter.interface';

import { ExchangeAdapterBridge } from '../src/modules/trading-engine/adapters/exchange-adapter.bridge';
import { GridBotRunner, type BotConfig } from '../src/modules/trading-engine/runner/grid-bot-runner';
import { BotFsm } from '../src/modules/trading-engine/fsm/bot-fsm';
import { StrategyEngine } from '../src/modules/trading-engine/strategy/strategy-engine';
import { StopLossBufferSentinel } from '../src/modules/trading-engine/stop-loss-sentinel/stop-loss-sentinel';
import { ExecutionEngine } from '../src/modules/trading-engine/execution/execution-engine';
import { ExchangeTruthService } from '../src/modules/trading-engine/exchange-truth-service/exchange-truth.service';
import { BotStateReconstructor } from '../src/modules/trading-engine/reconstructor/bot-state-reconstructor';

// ──────────────────────────────────────────────────────────────────────────────
// 小工具
// ──────────────────────────────────────────────────────────────────────────────

type ExchangeName = 'binance' | 'gateio' | 'okx';

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function hr(): void {
  console.log('─'.repeat(78));
}

function title(s: string): void {
  console.log('');
  hr();
  console.log(`  ${s}`);
  hr();
}

function dump(label: string, value: unknown): void {
  let rendered: string;
  try {
    rendered = JSON.stringify(value, (_k, v) => (v instanceof Map ? Array.from(v.entries()) : v), 2);
  } catch {
    rendered = String(value);
  }
  console.log(`${label}:\n${rendered}`);
}

// ──────────────────────────────────────────────────────────────────────────────
// 参数解析
// ──────────────────────────────────────────────────────────────────────────────

interface Args {
  exchange: ExchangeName;
  env?: string;
  symbol: string;
  yes: boolean;
}

function parseArgs(argv: string[]): Args {
  const map = new Map<string, string>();
  for (const raw of argv) {
    if (!raw.startsWith('--')) continue;
    const eq = raw.indexOf('=');
    if (eq === -1) {
      map.set(raw.slice(2), 'true');
    } else {
      map.set(raw.slice(2, eq), raw.slice(eq + 1));
    }
  }

  const exchange = map.get('exchange') as ExchangeName | undefined;
  if (!exchange || !['binance', 'gateio', 'okx'].includes(exchange)) {
    console.error('错误: 必须指定 --exchange=binance|gateio|okx');
    console.error(
      '用法: npx tsx apps/api/scripts/testnet-acceptance.ts --exchange=gateio --yes [--env=/path/.env.testnet] [--symbol=ETH_USDT]',
    );
    process.exit(2);
  }

  return {
    exchange,
    env: map.get('env'),
    symbol: map.get('symbol') ?? 'ETH_USDT',
    yes: map.get('yes') === 'true',
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// .env.testnet 加载(轻量内联解析,避免引入 dotenv 依赖)
// ──────────────────────────────────────────────────────────────────────────────

function resolveEnvPath(explicit?: string): string {
  if (explicit) return path.resolve(explicit);
  // 默认: 从 apps/api/scripts 回到主仓库根。注意 worktree 路径较深,
  // 此默认值在 worktree 内通常指向 worktree 根而非主仓库 —— 强烈建议显式传 --env。
  return path.resolve(__dirname, '../../../.env.testnet');
}

function loadEnv(file: string): Record<string, string> {
  if (!existsSync(file)) {
    throw new Error(
      `找不到 .env.testnet: ${file}\n` +
        '请用 --env=/绝对路径/.env.testnet 显式指定(主仓库根的 .env.testnet)。',
    );
  }
  const out: Record<string, string> = {};
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

// ──────────────────────────────────────────────────────────────────────────────
// adapter 创建(测试网)
// ──────────────────────────────────────────────────────────────────────────────

function createAdapter(exchange: ExchangeName, env: Record<string, string>): IExchangeAdapter {
  const accountId = `acceptance-${exchange}`;
  switch (exchange) {
    case 'binance': {
      const apiKey = env.BINANCE_API_KEY;
      const apiSecret = env.BINANCE_API_SECRET;
      if (!apiKey || !apiSecret) throw new Error('缺少 BINANCE_API_KEY / BINANCE_API_SECRET');
      // BinanceAdapter 硬编码 BINANCE_REST_DEMO/BINANCE_WS_DEMO(测试网),无主网开关。
      return new BinanceAdapter({ apiKey, apiSecret, accountId });
    }
    case 'gateio': {
      const apiKey = env.GATEIO_API_KEY;
      const apiSecret = env.GATEIO_API_SECRET;
      if (!apiKey || !apiSecret) throw new Error('缺少 GATEIO_API_KEY / GATEIO_API_SECRET');
      // GateioAdapter 硬编码 GATEIO_REST_TESTNET/GATEIO_WS_TESTNET,无主网开关。
      return new GateioAdapter({ apiKey, apiSecret, accountId });
    }
    case 'okx': {
      const apiKey = env.OKX_API_KEY;
      const apiSecret = env.OKX_API_SECRET;
      const passphrase = env.OKX_PASSPHRASE;
      if (!apiKey || !apiSecret || !passphrase)
        throw new Error('缺少 OKX_API_KEY / OKX_API_SECRET / OKX_PASSPHRASE');
      // OkxAdapter 通过 'x-simulated-trading: 1' header 走 Demo 环境(见 okx-rest-client)。
      return new OkxAdapter({ apiKey, apiSecret, passphrase, accountId });
    }
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// runner 装配(参照 blackbox-e2e 的依赖装配)
// ──────────────────────────────────────────────────────────────────────────────

function buildRunner(config: BotConfig, bridge: ExchangeAdapterBridge): GridBotRunner {
  return new GridBotRunner(config, bridge, {
    fsm: new BotFsm(),
    strategy: new StrategyEngine(),
    sentinel: new StopLossBufferSentinel(),
    execution: new ExecutionEngine(bridge),
    truth: new ExchangeTruthService(bridge),
    reconstructor: new BotStateReconstructor(),
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// 安全小额配置(围绕当前市价的窄区间 + 交易所最小量级)
// ──────────────────────────────────────────────────────────────────────────────

function makeSafeConfig(symbol: string, marketPrice: number): BotConfig {
  // 围绕当前市价构造一个窄盒子。direction=LONG: entryPrice 略高于市价,
  // 使 price < entryPrice → 进入 TRAILING_ENTRY(目标②)。
  const takeProfitPrice = +(marketPrice * 1.03).toFixed(2);
  const stopLossGridCount = 2;
  const stopLossGridStep = 2.5;
  const isolationStep = 2.5;
  const mainGridCount = 6;
  const stopLossBand = stopLossGridCount * stopLossGridStep;
  const liquidationPrice = +(marketPrice * 0.97).toFixed(2);
  const mainGridStep = +((takeProfitPrice - liquidationPrice - stopLossBand - isolationStep) / mainGridCount).toFixed(4);
  const entryPrice = +(marketPrice * 1.002).toFixed(2);

  return {
    configId: `acceptance-${Date.now()}`,
    sessionCode: `acc${Date.now().toString().slice(-8)}`,
    symbol,
    direction: 'LONG',
    takeProfitPrice,
    mainGridCount,
    mainGridStep,
    mainGridPortionSize: 0.01,
    leverage: 5,
    stopLossGridCount,
    stopLossGridStep,
    isolationStep,
    reorderThreshold: 0.0005,
    gtcBoundary: 1.02,
    gtcThreshold: 0.001,
    trailingEntry: true,
    trailingCallbackRate: 0.002,
    entryPrice,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// 交易所开放订单 / 算法单快照(只读,用于人工核对)
// ──────────────────────────────────────────────────────────────────────────────

async function snapshotExchange(bridge: ExchangeAdapterBridge, symbol: string, prefix: string) {
  const openOrders = await bridge.getOpenOrders(symbol).catch((e) => {
    console.warn(`getOpenOrders 失败: ${(e as Error).message}`);
    return [] as Awaited<ReturnType<typeof bridge.getOpenOrders>>;
  });
  const algoOrders = await bridge.getAlgoOrders(symbol).catch((e) => {
    console.warn(`getAlgoOrders 失败: ${(e as Error).message}`);
    return [] as Awaited<ReturnType<typeof bridge.getAlgoOrders>>;
  });

  const ours = (cid?: string) => !!cid && cid.startsWith(prefix);
  dump('交易所开放(普通)订单', openOrders);
  dump('交易所算法单', algoOrders);
  console.log(
    `本系统普通单(前缀 ${prefix}): ${openOrders.filter((o) => ours(o.clientOrderId)).length} / 总 ${openOrders.length}`,
  );
  console.log(
    `本系统算法单(前缀 ${prefix}): ${
      algoOrders.filter((a) => ours((a as { clientOrderId?: string }).clientOrderId)).length
    } / 总 ${algoOrders.length}`,
  );
  return { openOrders, algoOrders };
}

// ──────────────────────────────────────────────────────────────────────────────
// 主流程
// ──────────────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));

  title('GridPilot Testnet 人工验收脚本');
  console.log(`交易所: ${args.exchange}`);
  console.log(`交易对: ${args.symbol}`);

  // ── 安全闸:无 --yes 打印警告并退出 ──
  if (!args.yes) {
    console.log('');
    console.log('⚠️  此脚本会在交易所真实下单 / 平仓 / 取消订单。');
    console.log('⚠️  确认你使用的是【测试网/Demo 凭证】后,加 --yes 重新运行。');
    console.log('   例: npx tsx apps/api/scripts/testnet-acceptance.ts --exchange=gateio --yes');
    console.log('');
    console.log('未检测到 --yes,安全退出(未连接交易所,未下任何单)。');
    process.exit(0);
  }

  // ── 加载凭证 ──
  const envPath = resolveEnvPath(args.env);
  console.log(`加载凭证: ${envPath}`);
  const env = loadEnv(envPath);

  // ── 创建 adapter → bridge ──
  const iAdapter = createAdapter(args.exchange, env);
  const bridge = new ExchangeAdapterBridge(iAdapter);

  // ── 取一次市价以构造窄盒子配置 ──
  title('准备: 获取当前市价并构造安全小额配置');
  let marketPrice = 0;
  try {
    const ticker = await bridge.getTicker(args.symbol);
    marketPrice = ticker.last;
    dump('当前 ticker', ticker);
  } catch (e) {
    console.error(`获取 ticker 失败: ${(e as Error).message}`);
    console.error('无法确定市价,使用占位价 3000(请人工核对配置区间是否合理)。');
    marketPrice = 3000;
  }

  const config = makeSafeConfig(args.symbol, marketPrice);
  const prefix = `${config.sessionCode}_`;
  title('将使用的完整 BotConfig(请人工确认后继续)');
  dump('BotConfig', config);
  console.log(`本系统订单前缀(sessionCode_): ${prefix}`);
  console.log('5 秒后开始执行... (Ctrl-C 可中止)');
  await delay(5000);

  let runner = buildRunner(config, bridge);

  // ════════════════════════════════════════════════════════════════════════
  // 【目标② & ③】启动 runner: 追踪建仓 → RUNNING → RUNNING 下下网格单
  // ════════════════════════════════════════════════════════════════════════
  try {
    title('【目标②/③】start runner: 观察 TRAILING_ENTRY → RUNNING,RUNNING 下下网格/止损单');
    await runner.start();
    await delay(1500);

    const s0 = runner.getState();
    console.log(`初始 FSM 状态: ${s0?.fsm.kind ?? '(null)'}`);
    dump('runner.getState() 初始', s0);

    if (s0?.fsm.kind === 'TRAILING_ENTRY') {
      console.log(
        '处于 TRAILING_ENTRY(目标②: 价格从上方进入追踪建仓)。',
        '等待真实行情反弹超过 trailingCallbackRate 触发 → RUNNING。',
      );
      // 真实行情驱动,无法人工 push tick。轮询观察一段时间。
      for (let i = 0; i < 12; i++) {
        await delay(5000);
        const k = runner.getState()?.fsm.kind;
        console.log(`  [${(i + 1) * 5}s] FSM=${k}, lastPrice=${runner.getState()?.lastPrice}`);
        if (k === 'RUNNING') break;
      }
    }

    const sRun = runner.getState();
    console.log(`当前 FSM 状态: ${sRun?.fsm.kind}`);
    console.log(
      sRun?.fsm.kind === 'RUNNING'
        ? '已进入 RUNNING(目标②成立: 反弹确认后建仓)。'
        : '尚未进入 RUNNING —— 真实行情可能未触发反弹。可重跑或人工核对。',
    );

    // 目标③: 仅 RUNNING 可下单。RUNNING 下等待策略产生网格/止损单。
    console.log('观察 RUNNING 状态下是否产生网格单 / 止损算法单...');
    await delay(8000);
    dump('runner.getState() (观察下单后)', runner.getState());
    await snapshotExchange(bridge, args.symbol, prefix);
    console.log(
      '目标③ 人工判断: 上方“本系统普通单/算法单”数量应仅在 RUNNING 状态出现;' +
        '非 RUNNING(如 TRAILING_ENTRY)不应有本系统网格/止损单(平仓单除外)。',
    );
  } catch (e) {
    console.error(`【目标②/③】步骤异常(继续后续): ${(e as Error).message}`);
  }

  // ════════════════════════════════════════════════════════════════════════
  // 【目标④】任意状态可取消订单 —— 经 USER_LIQUIDATE 路径触发取消
  // ════════════════════════════════════════════════════════════════════════
  try {
    title('【目标④】任意状态可取消订单: 取消前后对比交易所开放订单');
    console.log('取消前快照:');
    await snapshotExchange(bridge, args.symbol, prefix);

    console.log('提交 USER_LIQUIDATE 事件(应取消本系统活动网格单/算法单并平仓)...');
    runner.submitEvent({ type: 'USER_LIQUIDATE' });
    await delay(6000);

    console.log('取消后快照:');
    dump('runner.getState() (USER_LIQUIDATE 后)', runner.getState());
    await snapshotExchange(bridge, args.symbol, prefix);
    console.log(
      '目标④ 人工判断: 取消后“本系统普通单/算法单”数量应清零(或显著减少);' +
        '用户手动单(非本前缀)应不受影响。',
    );
  } catch (e) {
    console.error(`【目标④】步骤异常(继续后续): ${(e as Error).message}`);
  }

  // ════════════════════════════════════════════════════════════════════════
  // 【目标⑤】退出时本系统创建的订单全部取消(按 sessionCode 前缀)
  // ════════════════════════════════════════════════════════════════════════
  try {
    title('【目标⑤】退出清理: stop() 后该交易对下本系统(前缀)订单应全部取消');
    console.log('runner.stop() ...');
    await runner.stop();
    await delay(3000);

    console.log('stop 后快照:');
    const snap = await snapshotExchange(bridge, args.symbol, prefix);
    const leftoverOrders = snap.openOrders.filter((o) => o.clientOrderId?.startsWith(prefix));
    const leftoverAlgos = snap.algoOrders.filter((a) =>
      (a as { clientOrderId?: string }).clientOrderId?.startsWith(prefix),
    );
    console.log(
      `目标⑤ 人工判断: 退出后本系统残留 普通单=${leftoverOrders.length} 算法单=${leftoverAlgos.length}` +
        ' (期望均为 0;非本前缀的用户手动单应保留)。',
    );
  } catch (e) {
    console.error(`【目标⑤】步骤异常(继续后续): ${(e as Error).message}`);
  }

  // ════════════════════════════════════════════════════════════════════════
  // 【目标①】异常退出恢复: 有持仓重启 → 直接 RUNNING 接管(跳过追踪建仓)
  // ════════════════════════════════════════════════════════════════════════
  try {
    title('【目标①】异常退出恢复: 用同 config 重建 runner 并 start(模拟重启)');
    console.log(
      '若上一轮已建仓且仓位未被完全平掉,重启时 cold-start recover 应识别既有持仓 → 直接 RUNNING,跳过 TRAILING_ENTRY。',
    );

    // 注意: 用同一 config(含同 sessionCode),使前缀过滤与恢复语义一致。
    const restarted = buildRunner(config, bridge);
    await restarted.start();
    await delay(2000);

    const sr = restarted.getState();
    console.log(`重建后 FSM 状态: ${sr?.fsm.kind ?? '(null)'}`);
    dump('runner.getState() (重启后)', sr);
    dump('重启后 position', sr?.position ?? null);
    console.log(
      '目标① 人工判断: 若 position 非空,FSM 应为 RUNNING(直接接管,未走 TRAILING_ENTRY);' +
        '若 position 为空(已平仓/无持仓),则可能回到 TRAILING_ENTRY —— 属正常,因无仓可接管。',
    );

    // 收尾: 停止重启的 runner,清理本系统残留单。
    console.log('收尾 restarted.stop() (清理本系统残留单)...');
    await restarted.stop();
    await delay(2000);
    console.log('收尾后快照:');
    await snapshotExchange(bridge, args.symbol, prefix);
  } catch (e) {
    console.error(`【目标①】步骤异常: ${(e as Error).message}`);
  } finally {
    // 确保第一个 runner 一定被停掉(防止之前异常导致未 stop)。
    try {
      if (runner.isRunning()) await runner.stop();
    } catch {
      /* ignore */
    }
    // 释放底层 adapter 连接。
    try {
      iAdapter.destroy();
    } catch {
      /* ignore */
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 人工核对清单
  // ──────────────────────────────────────────────────────────────────────────
  title('人工核对清单(根据以上输出逐项勾选)');
  console.log('[ ] 目标① 异常退出恢复: 有持仓重启后 FSM 直接为 RUNNING(跳过追踪建仓)');
  console.log('[ ] 目标② 下跌追踪建仓: TRAILING_ENTRY → 反弹确认 → RUNNING');
  console.log('[ ] 目标③ 仅 RUNNING 可下单(网格单 + 止损算法单);非 RUNNING 不下单(平仓单除外)');
  console.log('[ ] 目标④ 任意状态可取消订单: USER_LIQUIDATE 后本系统单被取消,用户手动单不受影响');
  console.log('[ ] 目标⑤ 退出清理: stop() 后该交易对下本系统(前缀)订单全部取消');
  console.log('');
  console.log('脚本执行完成。请结合上方交易所返回与 FSM 状态人工判定。');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('脚本顶层异常:', e);
    // 顶层异常仍以 0 退出(人工工具),除参数错误(已在 parseArgs 用 exit(2))。
    process.exit(0);
  });
