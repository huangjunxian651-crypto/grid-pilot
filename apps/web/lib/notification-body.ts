import type { Notification } from "@/lib/api";

type Translate = (key: string, params?: Record<string, string | number>) => string;

/**
 * 通知正文渲染：code+params → notifications.<code> 插值；reason 嵌套翻译 errors.<reason>。
 * 任一词条缺失时回退（reason 回退原始码，code 回退 body），保证旧数据/新 code 可读。
 */
export function resolveNotificationBody(n: Notification, t: Translate): string {
  if (!n.code) return n.body;

  const reasonRaw = n.params?.reason;
  const reasonKey = `errors.${reasonRaw}`;
  const reasonText = reasonRaw ? (t(reasonKey) === reasonKey ? reasonRaw : t(reasonKey)) : "";

  const bodyKey = `notifications.${n.code}`;
  const text = t(bodyKey, { ...n.params, reason: reasonText });
  return text === bodyKey ? n.body : text;
}

/**
 * 通知标题渲染：code → notifications.title.<code>；未命中（旧数据/新 code）回退后端原始
 * title —— 后端目前仍硬编码英文 title 字段（trading-engine.service.ts /
 * critical-event-notification.ts），直接展示会在中文界面里混入英文，故短标题走前端翻译层。
 */
export function resolveNotificationTitle(n: Notification, t: Translate): string {
  if (!n.code) return n.title;
  const titleKey = `notifications.title.${n.code}`;
  const text = t(titleKey);
  return text === titleKey ? n.title : text;
}
