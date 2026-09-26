/**
 * zhuzhao 统一请求层（01 §3.3 实现规格，替换模板通用封装）
 *
 * 契约：
 * - 信封 {code, message, data, request_id}——code≠0 恒非 2xx（按 HTTP 状态分流）
 * - X-Request-ID = req- + 32 位小写 hex（D2-24）
 * - 401 分码：20002 过期→单飞刷新 / 20003 无效→清 session 跳登录
 * - 刷新失败分流：**仅终态码族（20004/20014/20015）清会话跳登录**；
 *   HTTP 5xx / 网络抖动（无响应）→ 保留会话，仅拒绝本次请求（§3.3：防一次抖动把全员登出）
 */

import axios, { type AxiosInstance, type AxiosError, type InternalAxiosRequestConfig } from 'axios'
import { getAccessToken, getRefreshToken, setTokens, clearTokens, type TokenPair } from '@/common/auth/tokenStorage'
import { useUserStoreWithOut } from '@/store/modules/user'
import { TOKEN_EXPIRED, TOKEN_INVALID, REFRESH_FATAL_CODES } from '@/common/constants/errorBehavior'

// ─── Request-ID（req- + 32 位小写 hex）───
let _counter = 0
export function generateRequestID(): string {
  const hex = (Date.now().toString(16) + (_counter++).toString(16) + Math.random().toString(16).slice(2, 10))
    .padEnd(32, '0').slice(0, 32).toLowerCase()
  return `req-${hex}`
}

/** 带「已重放过」标记的请求配置（重放上限 1 次，防 20002 死循环） */
interface RetryableConfig extends InternalAxiosRequestConfig {
  _retry?: boolean
}

/**
 * 刷新结果——**携带终态语义**，供调用方分流。
 * P1-4 根因：旧实现返回 `string | null`，调用方无法区分「终态失败」与「网络抖动」，
 * 一律 clearTokens + 跳登录 → 与 §3.3「5xx/网络抖动不清会话」矛盾，分流被抹平。
 */
export interface RefreshResult {
  /** 新 AT（成功时非空） */
  token: string | null
  /** true=终态（RT 无效/改密纪元/重放）→ 应清会话跳登录；false=非终态（网络/5xx）→ 保会话 */
  terminal: boolean
}

/** 终态码判定（把 REFRESH_FATAL_CODES 常量真正接上，替代「有无响应」粗判） */
function isFatalRefreshCode(code: unknown): boolean {
  return typeof code === 'number' && (REFRESH_FATAL_CODES as readonly number[]).includes(code)
}

/** 单飞刷新锁 */
let _refreshing: Promise<RefreshResult> | null = null

/**
 * 执行一次刷新（终态语义版，取代旧 _doRefresh 的 `string | null`）。
 *
 * 终态（terminal=true）：
 *  - 无 RT：会话不可续
 *  - 响应 code ∈ REFRESH_FATAL_CODES（20004/20014/20015）
 *  - 4xx 且码族命中
 * 非终态（terminal=false）：
 *  - 无 HTTP 响应（网络断开/超时）
 *  - HTTP 5xx（Redis 抖动 503+10008，fail-closed 可重试）
 *  - 4xx 但码族未命中（保守起见不误登出）
 */
export async function refreshAccessToken(): Promise<RefreshResult> {
  const rt = getRefreshToken()
  if (!rt) return { token: null, terminal: true } // 无 RT 无法刷新 → 会话不可续
  try {
    const resp = await axios.post('/api/v1/auth/refresh', { refresh_token: rt }, {
      headers: { 'X-Request-ID': generateRequestID() },
      timeout: 30000,
    })
    const body = resp.data as { code?: number; data?: TokenPair } | undefined
    if (body?.code === 0 && body.data?.access_token) {
      setTokens(body.data)
      return { token: body.data.access_token, terminal: false }
    }
    // 业务失败：仅终态码族终态化
    return { token: null, terminal: isFatalRefreshCode(body?.code) }
  } catch (err: unknown) {
    const response = (err as AxiosError)?.response
    if (!response) {
      // 无 HTTP 响应（网络断开/超时）→ 非终态，保留会话
      return { token: null, terminal: false }
    }
    if (response.status >= 500) {
      // 5xx（如 Redis 抖动 503+10008）→ 非终态，保留会话
      return { token: null, terminal: false }
    }
    // 其余 4xx：以终态码族为准
    const code = (response.data as { code?: number } | undefined)?.code
    return { token: null, terminal: isFatalRefreshCode(code) }
  }
}

/** 单飞刷新：并发 401 只发一次 POST /auth/refresh，其余挂起复用同一 Promise */
export function singleFlightRefresh(): Promise<RefreshResult> {
  if (!_refreshing) {
    _refreshing = refreshAccessToken().finally(() => { _refreshing = null })
  }
  return _refreshing
}

// ─── axios 实例 ───
const service: AxiosInstance = axios.create({ timeout: 30000 })

service.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const at = getAccessToken()
  if (at) config.headers.Authorization = `Bearer ${at}`
  config.headers['X-Request-ID'] = generateRequestID()
  return config
})

service.interceptors.response.use(
  (response) => {
    // 成功但 data:null 的接口（logout 等）→ 返回 null 而非整个信封
    const envelope = response.data as { code?: number; data?: unknown }
    const result = envelope?.code === 0 ? (envelope.data ?? null) : envelope
    return result as never // 类型断言：运行时 data 直返（调用方拿到的就是业务数据）
  },
  async (error: AxiosError) => {
    const status = error.response?.status
    const body = error.response?.data as { code?: number } | undefined
    const bizCode = body?.code

    // 403+20007 强制改密（errorBehavior 接线——跳改密页不清会话）
    if (status === 403 && bizCode === 20007) {
      if (typeof window !== 'undefined') {
        const hash = window.location.hash
        if (!hash.includes('/change-password')) {
          window.location.hash = '#/change-password'
        }
      }
      return Promise.reject(error)
    }

    if (status === 401) {
      if (bizCode === TOKEN_EXPIRED) {
        const config = error.config as RetryableConfig | undefined
        // 重放上限 1 次：已重放过的请求再 401 → 不再刷新，直接终态处理，避免无限循环
        if (config?._retry) {
          _clearPiniaAndRedirect()
          return Promise.reject(error)
        }
        const result = await singleFlightRefresh()
        if (result.token && config) {
          config._retry = true
          config.headers.Authorization = `Bearer ${result.token}`
          return service(config)
        }
        // 非终态（网络抖动/5xx）→ 保留会话，仅拒绝本次请求（不清 session、不跳登录）
        if (!result.terminal) {
          return Promise.reject(error)
        }
        // 终态（RT 无效/改密纪元/重放）→ 清会话跳登录
        _clearPiniaAndRedirect()
        return Promise.reject(error)
      }
      if (bizCode === TOKEN_INVALID) {
        _clearPiniaAndRedirect()
        return Promise.reject(error)
      }
    }
    return Promise.reject(error)
  },
)

/**
 * 终态会话失效：清 token（兜底）+ 彻底拆除会话（userStore.resetState 内含
 * 权限动态路由/注册标志、tagsView、resetRouter、rawMenus 清理）+ 跳登录。
 * 仅终态路径调用；非终态（网络/5xx）绝不清会话。
 */
function _clearPiniaAndRedirect(): void {
  clearTokens()
  try {
    const userStore = useUserStoreWithOut()
    userStore.resetState()
  } catch { /* Pinia 未初始化（如单测环境）——仅清 token */ }
  _redirectToLogin()
}

function _redirectToLogin(): void {
  if (typeof window === 'undefined') return
  // hash 路由：真实路径在 location.hash（#/xxx），pathname 恒为 base
  const currentHash = window.location.hash
  if (currentHash.startsWith('#/login')) return // 已在登录页防重入
  const fullPath = currentHash.replace(/^#/, '') || '/'
  window.location.hash = `#/login?redirect=${encodeURIComponent(fullPath)}`
}

export default service
