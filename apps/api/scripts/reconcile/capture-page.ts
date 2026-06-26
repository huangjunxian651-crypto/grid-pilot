/**
 * capture-page.ts — 用 kimi-webbridge 读 /robots/[id] 渲染值,结构化输出 page 层 JSON。
 *   ts-node scripts/reconcile/capture-page.ts --robotId=<id> [--out=<file>]
 * 依赖 kimi-webbridge 守护进程(127.0.0.1:10086)与浏览器已登录态。
 */
import { writeFileSync } from "fs";
const BRIDGE = "http://127.0.0.1:10086/command";
const SESSION = "gridpilot-e2e-reconcile";
function arg(n: string) { const h = process.argv.find((a) => a.startsWith(`--${n}=`)); return h ? h.slice(n.length + 3) : undefined; }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function cmd(action: string, args: any) {
  const r = await fetch(BRIDGE, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, args, session: SESSION }) });
  return r.json();
}
function num(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = s.replace(/,/g, "").match(/-?\$?\s*([+-]?[\d.]+)/);
  return m ? Number(m[1].replace("$", "")) : null;
}
async function main() {
  const robotId = arg("robotId")!;
  await cmd("navigate", { url: `http://localhost:3300/robots/${robotId}`, session: SESSION });
  // 轮询直到监控面板渲染出关键文案（SPA 路由+WS 首帧可能数秒）
  let t = "";
  for (let i = 0; i < 15; i++) {
    await sleep(1200);
    const res = await cmd("evaluate", { code: `(document.querySelector("main")?.innerText||document.body.innerText)` });
    t = res?.data?.value ?? "";
    if (t.includes("已实现盈亏") && t.includes("标记价")) break;
  }
  const pick = (re: RegExp) => { const m = t.match(re); return m ? m[1] : null; };

  // FSM: 头部 "<DIR> · <STATE> · 标记价"
  const fsm = pick(/(?:LONG|SHORT)\s*·\s*([A-Z_]+)\s*·/);
  // KPI: "已实现盈亏\n+$0.00"
  const realizedStr = pick(/已实现盈亏\s*\n\s*([+\-]?\$?-?[\d.,]+)/);
  const unrealStr = pick(/未实现盈亏\s*\n\s*([+\-]?\$?-?[\d.,]+)/);
  const alphaStr = pick(/ALPHA 超额\s*\n\s*([+\-]?\$?[\d.,]+)/i);
  const markStr = pick(/标记价\s*\n\s*([\d.,]+)/);
  const posStr = pick(/持仓\s*\n\s*([\d.,]+)/);
  const avgStr = pick(/avg \$([\d.,]+)/);
  const fillsCountStr = pick(/实时成交流\s*\n\s*(\d+)/);
  const grids = pick(/(\d+ \/ 98 格已成交)/);

  const page = {
    capturedAt: Date.now(),
    robotId,
    fsm,
    realizedPnl: num(realizedStr),
    unrealizedPnl: num(unrealStr),
    alphaSavings: num(alphaStr),
    mark: num(markStr),
    positionQty: num(posStr),
    avgCost: num(avgStr),
    fillStreamCount: fillsCountStr ? Number(fillsCountStr) : null,
    gridsFilled: grids,
    raw: t.slice(0, 400),
  };
  const out = arg("out");
  if (out) writeFileSync(out, JSON.stringify(page, null, 2));
  console.log(JSON.stringify({ fsm: page.fsm, realizedPnl: page.realizedPnl, unrealizedPnl: page.unrealizedPnl, alphaSavings: page.alphaSavings, positionQty: page.positionQty, mark: page.mark, fillStreamCount: page.fillStreamCount }));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
