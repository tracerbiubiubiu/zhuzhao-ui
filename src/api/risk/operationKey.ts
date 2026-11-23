/** 风险写操作也可从内网 HTTP 页面发起，使用不依赖安全上下文的随机源。
 * 与工单 `@/api/ticket/operationKey` 同纪律同实现；不跨域复用，
 * 避免两域操作号出现共享前缀或互相可猜测的关联。 */
export function newRiskOperationId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}
