/**
 * 全局错误提示决策（01 §3.3 errorBehavior 白名单接线）
 *
 * 纯函数 resolveErrorToast 产出「是否 toast / 类型 / 文案」；副作用 notifyError 仅在
 * 有 DOM 的环境懒加载 ElMessage（node 单测环境零组件库依赖）。
 * 原则：凡已有专属交互的码不重复全局提示——401 走会话链路（跳登录/清会话）、
 * 403+20007 跳改密页、10006 乐观锁由表单重拉详情、_silentError 调用方自管。
 * 其余 toast 后端 message 并附 request_id（排障凭据——D2 契约）。
 */
import type { AxiosError } from 'axios'
import { ERROR_BEHAVIOR } from '@/common/constants/errorBehavior'

/** 调用方自管错误展示（表单内联 errorMsg 场景）——请求 config 置 _silentError: true */
declare module 'axios' {
  export interface AxiosRequestConfig {
    _silentError?: boolean
  }
}

interface ErrorBody {
  code?: number
  message?: string
  request_id?: string
}

export interface ErrorToastDecision {
  type: 'error' | 'warning'
  message: string
}

export function resolveErrorToast(error: unknown): ErrorToastDecision | null {
  if (typeof error !== 'object' || error === null) return null
  const e = error as AxiosError<ErrorBody> & { __sessionTransient?: boolean; code?: string }
  if (e.config?._silentError) return null // 调用方自管（登录/改密表单）
  if (e.code === 'ERR_CANCELED') return null // 主动取消不是错误（useCrud 竞态 abort）
  // refresh 链路非终态（5xx/网络抖动）：原始 401 语义不成立，提示可重试而非「登录过期」
  if (e.__sessionTransient === true) {
    return { type: 'warning', message: '服务暂时不可用，请稍后重试' }
  }
  const status = e.response?.status
  const body = e.response?.data
  const bizCode = body?.code
  // 会话链路已有专属处置（跳改密页/跳登录/清会话），不重复全局提示
  if (status === 401 || (status === 403 && bizCode === ERROR_BEHAVIOR.FORCE_CHANGE_PASSWORD)) {
    return null
  }
  // 乐观锁冲突：表单场景由调用方重拉详情重填（01 §3.3——明确非 toast）
  if (bizCode === ERROR_BEHAVIOR.CONCURRENT_MODIFICATION) return null
  const suffix = body?.request_id ? `（request_id: ${body.request_id}）` : ''
  if (bizCode === ERROR_BEHAVIOR.RATE_LIMITED) {
    return { type: 'warning', message: `${body?.message || '请求过于频繁，请稍后重试'}${suffix}` }
  }
  if (bizCode === ERROR_BEHAVIOR.ACCOUNT_LOCKED) {
    return { type: 'error', message: `${body?.message || '失败次数过多，账号已临时锁定'}${suffix}` }
  }
  const fallback = status ? `请求失败（HTTP ${status}）` : '网络异常，请检查连接后重试'
  return { type: 'error', message: `${body?.message || fallback}${suffix}` }
}

/** 展示错误提示（node/SSR 无 DOM 时静默跳过；EP 懒加载避免单测引入全量组件库） */
export function notifyError(error: unknown): void {
  const decision = resolveErrorToast(error)
  if (!decision || typeof document === 'undefined') return
  void import('element-plus')
    .then(({ ElMessage }) => ElMessage(decision))
    .catch(() => {
      /* 组件库加载失败不影响错误传播 */
    })
}
