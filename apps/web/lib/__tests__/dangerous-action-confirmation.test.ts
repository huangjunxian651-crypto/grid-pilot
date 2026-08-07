import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";

/**
 * 危险操作二次确认回归护栏。规范见 apps/web/AGENTS.md「危险操作二次确认规范」。
 * 新增危险操作时，必须在下面的 CASES 里补一条：
 *   { file: 相对 apps/web 的路径, action: mutate 调用的特征字符串, mustContain: 附近必须出现的确认调用特征 }
 * 断言方式是启发式的（在 action 出现位置前 WINDOW 行内查找 mustContain），不做真实作用域分析，
 * 足够当回归护栏但不是万能——真正的行为正确性由 confirm-dialog.test.tsx / useConfirm.test.ts 保证。
 *
 * WINDOW = 25（而非最初设想的 20）：实际的 confirm() 调用中，涉及"是否平仓"选项的对话框
 * body 里内联了 checkbox + label（见 handleStop / handleRemoveBox / handleStopAllBots），
 * 比纯文案确认多出几行，导致 confirm() 到对应 mutate() 之间的行距略超过 20 行。
 * 已逐条人工核对：mutate 调用前一行均为 `if (!ok) return;`，且 ok 来自紧邻的 `await confirm(...)`，
 * 确认门确实存在，只是窗口需要放宽以覆盖真实的多行对话框 body。
 */

const ROOT = resolve(__dirname, "../..");
const WINDOW = 25;

function readSrc(file: string): string {
  return readFileSync(resolve(ROOT, file), "utf8");
}

function containsNearby(src: string, action: string, mustContain: string): boolean {
  const idx = src.indexOf(action);
  if (idx === -1) return false;
  const before = src.slice(0, idx);
  const beforeLines = before.split("\n");
  const windowStart = Math.max(0, beforeLines.length - WINDOW);
  const windowText = beforeLines.slice(windowStart).join("\n");
  return windowText.includes(mustContain);
}

const CASES: { file: string; action: string; mustContain: string }[] = [
  { file: "app/robots/page.tsx", action: "pauseRobot.mutate(r.id", mustContain: "await confirm(" },
  { file: "app/robots/page.tsx", action: "stopRobot.mutate({ id: r.id", mustContain: "await confirm(" },
  { file: "app/robots/[id]/page.tsx", action: "pauseRobot.mutate(robot.id", mustContain: "await confirm(" },
  { file: "app/robots/[id]/page.tsx", action: "stopRobot.mutate({ id: robot.id", mustContain: "await confirm(" },
  { file: "app/robots/[id]/page.tsx", action: "removeBox.mutate({ configId", mustContain: "await confirm(" },
  { file: "app/settings/page.tsx", action: "stopRobot.mutate({ id: robot.id", mustContain: "await confirm(" },
  { file: "app/settings/page.tsx", action: "deleteCredential.mutate(cred.id)", mustContain: "confirmWord" },
  { file: "app/settings/page.tsx", action: "deleteAccount.mutate(undefined", mustContain: "confirmWord" },
  { file: "app/keys/page.tsx", action: "deleteMutation.mutate(c.id)", mustContain: "await confirm(" },
];

describe("危险操作二次确认契约", () => {
  for (const { file, action, mustContain } of CASES) {
    it(`${file} 里 "${action}" 前方 ${WINDOW} 行内必须出现 "${mustContain}"`, () => {
      const src = readSrc(file);
      expect(src, `未在源码中找到特征字符串 "${action}"，检查测试用例是否已过期`).toContain(action);
      expect(
        containsNearby(src, action, mustContain),
        `"${action}" 附近 ${WINDOW} 行内未找到 "${mustContain}"——该危险操作疑似绕过了二次确认`,
      ).toBe(true);
    });
  }

  it("app 与 components 目录下不允许出现 window.confirm(/window.alert( 或裸写的 confirm(/alert(", () => {
    // 覆盖两种拼写：带 window. 前缀的（旧写法）和裸写的（本功能上线前 app/keys/page.tsx
    // 实际使用过的写法：`if (confirm(t("keys.confirm_delete")))`，无 window. 前缀）。
    // 合法调用点固定长这样：`await confirm({`（见 useConfirm() 返回的 request 函数，
    // 调用方统一 `const confirm = useConfirm();` 后 `await confirm({ tier, title, body })`），
    // 所以白名单只放行这一种形态；alert( 没有任何合法调用点，一律拦截。
    const LEGIT_CONFIRM_CALL = /await confirm\(\{/;
    const BARE_CONFIRM_CALL = /\bconfirm\(/;
    const BARE_ALERT_CALL = /\balert\(/;

    const offenders: string[] = [];
    function walk(dir: string) {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "__tests__" || entry.name === "node_modules") continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) { walk(full); continue; }
        if (!/\.(ts|tsx)$/.test(entry.name)) continue;
        const content = readFileSync(full, "utf8");
        for (const line of content.split("\n")) {
          if (BARE_ALERT_CALL.test(line)) {
            offenders.push(`${full}: ${line.trim()}`);
            continue;
          }
          if (BARE_CONFIRM_CALL.test(line) && !LEGIT_CONFIRM_CALL.test(line)) {
            offenders.push(`${full}: ${line.trim()}`);
          }
        }
      }
    }
    walk(resolve(ROOT, "app"));
    walk(resolve(ROOT, "components"));
    expect(offenders, `发现残留的 window.confirm/alert 或裸写 confirm()/alert()：${offenders.join(", ")}`).toEqual([]);
  });

  it("Providers 必须挂载 <ConfirmDialogHost/>，否则所有危险操作会静默失效", () => {
    // 这是纯字符串契约校验（非渲染测试）：真正的“store 请求 → 弹窗渲染”端到端行为
    // 由 components/shell/__tests__/providers.test.tsx 验证。这里只保证 ConfirmDialogHost
    // 没有被误删/漏挂载——万一被移除，所有 confirm() 调用会永远 pending，且不会有任何
    // 现有测试失败（因为其它测试各自手动渲染 <ConfirmDialogHost/>，不经过 Providers）。
    const src = readSrc("components/shell/providers.tsx");
    expect(src).toContain("<ConfirmDialogHost");
  });
});
