/**
 * 会话加载失败分类（01 §3.3 守卫侧实现——与请求层 refreshAccessToken 同一分段哲学）
 *
 * terminal       = 终态 4xx（401 无效/过期终态、非 20007 的 403）→ 清会话跳登录
 * transient      = 非终态（无响应=网络断开/超时、5xx、429 限流）→ 保留会话
 *                  （§3.3：一次后端抖动不得把全员登出；axios 的 5xx **带** response，
 *                   「有无响应」不能当终态判据——守卫旧实现即栽在此）
 * change-password = 403+20007 强制改密 → 跳改密页，绝不清会话（token 清了改密接口就 401）
 */
export type SessionLoadErrorKind = 'terminal' | 'transient' | 'change-password'

interface HttpResponseLike {
  status?: number
  data?: { code?: number } | undefined
}

/** 纯函数（routePermission 同款约定）：按 HTTP 状态+业务码分段，供守卫 catch 分流 */
export function classifySessionLoadError(err: unknown): SessionLoadErrorKind {
  // 请求层标记：refresh 端点非终态失败（5xx/网络）——原始 401 语义不成立，保留会话
  if ((err as { __sessionTransient?: boolean } | null | undefined)?.__sessionTransient === true) return 'transient'
  const response = (err as { response?: HttpResponseLike } | null | undefined)?.response
  if (!response || typeof response.status !== 'number') {
    // 无 HTTP 响应（网络断开/超时）或非 axios 形态错误 → 非终态
    return 'transient'
  }
  const { status } = response
  const bizCode = response.data?.code
  if (status === 403 && bizCode === 20007) return 'change-password'
  // 5xx（Redis 抖动 503+10008 等 fail-closed 可重试）与 429（10007 限流，Retry-After 后重试）
  if (status >= 500 || status === 429) return 'transient'
  // 审计修复（2026-09-30 P2）：裸 403（无业务码）归 transient——403=已认证但无权，
  // 会话加载期网关/Casbin 裸 403 不应登出有效会话；带业务码的 403（如 10004）仍终态
  if (status === 403 && !bizCode) return 'transient'
  return 'terminal'
}
