/** 拒单原因可操作白名单：用户能通过明确操作解决的错误码（Runner 关键事件通知设计 spec）。 */
const ACTIONABLE_REJECTION_REASONS: ReadonlySet<string> = new Set([
  'ACCOUNT_MODE_RESTRICTED', // OKX 简单模式（Lv1）不能交易合约，需网页端升级账户模式
  '51008', // OKX 保证金不足，需充值/划转
  '51010', // OKX 账户模式不支持该操作（如简单模式下合约交易），需网页端升级账户模式
]);

export function isActionableRejection(errorCode: string | undefined): errorCode is string {
  return errorCode !== undefined && ACTIONABLE_REJECTION_REASONS.has(errorCode);
}
