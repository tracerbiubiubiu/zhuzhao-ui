/**
 * 错误码行为白名单（01 §3.3）
 * 仅「需特殊行为的码」进此表——其余 toast 后端 message。
 */
export const ERROR_BEHAVIOR = {
  /** 403 强制改密——跳改密页，不清会话 */
  FORCE_CHANGE_PASSWORD: 20007,
  /** 429 账号锁定——登录页文案（勿入 401 分支） */
  ACCOUNT_LOCKED: 20006,
  /** 429 全局限流——通用「请求过于频繁」+可选 Retry-After */
  RATE_LIMITED: 10007,
  /** 乐观锁并发冲突——表单场景重拉详情重填 */
  CONCURRENT_MODIFICATION: 10006,
} as const

/** 401 分码（01 §3.3）：20002 过期→刷新 / 20003 无效→跳登录 */
export const TOKEN_EXPIRED = 20002
export const TOKEN_INVALID = 20003

/** 刷新失败码族（终态——清 session 跳登录） */
export const REFRESH_FATAL_CODES = [20004, 20014, 20015]
