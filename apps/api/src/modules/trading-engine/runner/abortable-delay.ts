// 可被 AbortSignal 提前唤醒的等待。
//
// 关键：三条退出路径都不能在 signal 上残留 'abort' 监听器，否则长生命周期的
// AbortController（runner 整个生命周期复用同一个）会随每次退避累积监听器 →
// EventTarget 监听器泄漏 + 内存缓慢增长。
//   - 已 abort：立即 resolve，不注册监听器
//   - 超时路径：显式 removeEventListener 后 resolve
//   - abort 路径：{ once:true } 触发后自动移除
export function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
