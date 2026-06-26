import { describe, it, expect, vi } from "vitest";
import { AiJobService } from "./ai-job.service";

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("AiJobService", () => {
  it("run 立即返回 id，pending；work 成功后变 done 并带 result", async () => {
    const svc = new AiJobService();
    const id = svc.run(async () => ({ ok: 1 }));
    expect(typeof id).toBe("string");
    expect(svc.get(id)?.status).toBe("pending");
    await tick();
    const j = svc.get(id);
    expect(j?.status).toBe("done");
    expect(j?.result).toEqual({ ok: 1 });
  });

  it("work 抛编码异常 → error 并记录 errorCode", async () => {
    const svc = new AiJobService();
    const id = svc.run(async () => { throw { response: { code: "AI_LLM_FAILED", message: "boom" } }; });
    await tick();
    const j = svc.get(id);
    expect(j?.status).toBe("error");
    expect(j?.errorCode).toBe("AI_LLM_FAILED");
  });

  it("未知 id 返回 undefined", () => {
    expect(new AiJobService().get("nope")).toBeUndefined();
  });

  it("get 时回收已过期任务：TTL 之后再 get 返回 undefined（轮询本身驱动回收）", () => {
    vi.useFakeTimers();
    try {
      const svc = new AiJobService();
      const id = svc.run(async () => ({ ok: 1 }));
      expect(svc.get(id)).toBeTruthy();
      vi.advanceTimersByTime(31 * 60 * 1000);
      expect(svc.get(id)).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
