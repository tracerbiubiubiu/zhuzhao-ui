/**
 * zhuzhao 统一请求层（01 §3.3 实现规格，替换模板通用封装）
 *
 * 契约：
 * - 信封 {code, message, data, request_id}——code≠0 恒非 2xx（按 HTTP 状态分流）
 * - X-Request-ID = req- + 32 位小写 hex（D2-24）
 * - 401 分码：20002 过期→单飞刷新 / 20003 无效→清 session 跳登录
 * - 5xx 不清会话（拒绝挂起+提示重试）
 */

import axios, { type AxiosInstance, type AxiosError, type InternalAxiosRequestConfig } from 'axios'
import { getAccessToken, getRefreshToken, setTokens, clearTokens } from '@/common/auth/tokenStorage'
import { TOKEN_EXPIRED, TOKEN_INVALID } from '@/common/constants/errorBehavior'

// ─── Request-ID（req- + 32 位小写 hex）───
let _counter = 0
export function generateRequestID(): string {
  const hex = (Date.now().toString(16) + (_counter++).toString(16) + Math.random().toString(16).slice(2, 10))
    .padEnd(32, '0').slice(0, 32).toLowerCase()
  return `req-${hex}`
}

// ─── 单飞刷新 ───
let _refreshing: Promise<string | null> | null = null

async function _doRefresh(): Promise<string | null> {
  const rt = getRefreshToken()
  if (!rt) return null
  try {
    const resp = await axios.post('/api/v1/auth/refresh', { refresh_token: rt }, {
      headers: { 'X-Request-ID': generateRequestID() },
      timeout: 30000,
    })
    if (resp.data?.code === 0 && resp.data.data?.access_token) {
      setTokens(resp.data.data)
      return resp.data.data.access_token as string
    }
    // 终态码族（20004/20014/20015）→ 清 session
    clearTokens()
    return null
  } catch (err: unknown) {
    // P1 修复：有 HTTP 响应=终态→清；无响应（网络错误/5xx）→保会话
    const hasResponse = (err as { response?: unknown })?.response !== undefined
    if (hasResponse) {
      clearTokens()
      return null
    }
    return null // 网络错误不清会话——P1 修复
  }
}

function _singleFlightRefresh(): Promise<string | null> {
  if (!_refreshing) {
    _refreshing = _doRefresh().finally(() => { _refreshing = null })
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
  (response) => response.data?.data ?? response.data,
  async (error: AxiosError) => {
    const status = error.response?.status
    const body = error.response?.data as { code?: number } | undefined
    const bizCode = body?.code

    if (status === 401) {
      if (bizCode === TOKEN_EXPIRED) {
        const newAT = await _singleFlightRefresh()
        if (newAT && error.config) {
          error.config.headers.Authorization = `Bearer ${newAT}`
          return service(error.config)
        }
        clearTokens()
        _redirectToLogin()
        return Promise.reject(error)
      }
      if (bizCode === TOKEN_INVALID) {
        clearTokens()
        _redirectToLogin()
        return Promise.reject(error)
      }
    }
    return Promise.reject(error)
  },
)

function _redirectToLogin(): void {
  if (typeof window === 'undefined') return
  // hash 路由：真实路径在 location.hash（#/xxx），pathname 恒为 base
  const currentHash = window.location.hash
  if (currentHash.startsWith('#/login')) return // 已在登录页防重入
  const fullPath = currentHash.replace(/^#/, '') || '/'
  window.location.hash = `#/login?redirect=${encodeURIComponent(fullPath)}`
}

export default service
