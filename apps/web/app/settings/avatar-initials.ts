/**
 * 由显示名/邮箱推导头像首字母（设计稿个人资料卡 1371 的 "WX" 占位的真实数据版）。
 * - 多个词：取前两个词首字母（如 "Wan Xian" → "WX"）。
 * - 单个词：取前两个字符（如 "wanxsb" → "WA"）。
 * - 邮箱：取 @ 前的本地部分再按上述规则处理。
 * - 空值：返回 "?"。
 */
export function avatarInitials(nameOrEmail: string): string {
  const raw = (nameOrEmail ?? "").trim();
  if (!raw) return "?";
  const local = raw.includes("@") ? raw.split("@")[0] : raw;
  const words = local.split(/[\s._-]+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) {
    return words[0].slice(0, 2).toUpperCase();
  }
  return (words[0][0] + words[1][0]).toUpperCase();
}
