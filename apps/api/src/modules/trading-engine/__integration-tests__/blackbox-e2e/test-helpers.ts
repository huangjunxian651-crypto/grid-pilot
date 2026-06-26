export async function delay(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

export async function waitForState(
  runner: { getState: () => { fsm: { kind: string } } | null },
  kind: string,
  timeoutMs = 5000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = runner.getState();
    if (state?.fsm.kind === kind) return;
    await delay(50);
  }
  throw new Error(`Timeout waiting for state ${kind}`);
}
