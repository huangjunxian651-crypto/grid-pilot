import { Injectable } from "@nestjs/common";
import { randomUUID } from "crypto";

export type JobStatus = "pending" | "done" | "error";

export interface AiJob<T> {
  id: string;
  status: JobStatus;
  result?: T;
  errorCode?: string;
  errorMessage?: string;
  createdAt: number;
}

/**
 * 内存任务存储：把可能很慢的 LLM 生成（推理模型可达 1–2 分钟）从请求生命周期里解耦——
 * run() 立即返回任务 id 并后台跑 work，前端轮询 get() 取结果，从而避免单次长同步请求被代理/浏览器超时 reset。
 * 单实例适用；多实例需换 Redis/DB。任务 30 分钟后回收：run() 与 get() 都会顺带 gc，
 * 因此即便长时间无新任务，前端轮询本身也会驱动过期任务回收（命中已回收的任务则返回 undefined → AI_JOB_NOT_FOUND）。
 */
@Injectable()
export class AiJobService {
  private readonly jobs = new Map<string, AiJob<unknown>>();
  private static readonly TTL_MS = 30 * 60 * 1000;

  run<T>(work: () => Promise<T>): string {
    const id = randomUUID();
    const job: AiJob<unknown> = { id, status: "pending", createdAt: Date.now() };
    this.jobs.set(id, job);
    work().then(
      (result) => { job.status = "done"; job.result = result; },
      (err: unknown) => {
        job.status = "error";
        const resp = ((err as { response?: { code?: string; message?: string } })?.response) ?? {};
        job.errorCode = resp.code ?? "AI_LLM_FAILED";
        job.errorMessage = resp.message ?? (err as Error)?.message ?? "unknown error";
      },
    );
    this.gc();
    return id;
  }

  get(id: string): AiJob<unknown> | undefined {
    this.gc();
    return this.jobs.get(id);
  }

  private gc(): void {
    const cutoff = Date.now() - AiJobService.TTL_MS;
    for (const [id, j] of this.jobs) {
      if (j.createdAt < cutoff) this.jobs.delete(id);
    }
  }
}
