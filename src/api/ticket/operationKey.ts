/** 工单写操作也可从内网 HTTP 页面发起，使用不依赖安全上下文的随机源。 */
export function newTicketOperationKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}
