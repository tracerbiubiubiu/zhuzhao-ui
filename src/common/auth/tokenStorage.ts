/**
 * TokenStorage — AT/RT/device_id 三件同源的存储抽象（01 §3.3）
 *
 * 现态实现 = 内存 + localStorage；B7 cookie 会话演进时只换实现（调用面零改动）。
 * device_id = 浏览器级 UUID（首次生成后持久化），登录/登出/改密三处同源取此——
 * 缺省归 "default" 单槽会多浏览器互踢（W0 后端已收紧为必填）。
 */

const STORAGE_KEY = 'zhuzhao_tokens'
const DEVICE_KEY = 'zhuzhao_device_id'

export interface TokenPair {
  access_token: string
  refresh_token: string
  expires_in?: number
  must_change_password?: boolean
}

// 内存缓存（避免每请求读 localStorage）
let cached: TokenPair | null = null
let cachedDeviceId: string | null = null

/** 生成浏览器级 UUID（v4 简版——device_id 不需密码学强度） */
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

/** 获取或创建浏览器级 device_id（白名单 [a-zA-Z0-9_-]{1,64}——UUID 天然合规） */
export function getDeviceId(): string {
  if (cachedDeviceId) return cachedDeviceId
  cachedDeviceId = localStorage.getItem(DEVICE_KEY)
  if (!cachedDeviceId) {
    cachedDeviceId = generateUUID()
    try {
      localStorage.setItem(DEVICE_KEY, cachedDeviceId)
    } catch {
      // 写失败（隐私模式/配额）→ 降级内存态：本会话内仍同源，仅不跨刷新
    }
  }
  return cachedDeviceId
}

/** 保存 TokenPair（登录/刷新/改密轮换后调用） */
export function setTokens(pair: TokenPair): void {
  cached = pair
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pair))
  } catch {
    // 写失败 → 内存态仍可用（本标签页会话正常，刷新后需重登）
  }
}

/** 获取 AT（null = 未登录） */
export function getAccessToken(): string | null {
  if (cached) return cached.access_token
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      cached = JSON.parse(raw) as TokenPair
      return cached?.access_token ?? null
    }
  } catch {
    // 损坏数据视为未登录
  }
  return null
}

/** 获取 RT（单飞刷新用） */
export function getRefreshToken(): string | null {
  if (cached) return cached.refresh_token
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      cached = JSON.parse(raw) as TokenPair
      return cached?.refresh_token ?? null
    }
  } catch {
    // ignore
  }
  return null
}

/** 清除全部 token（登出/刷新失败） */
export function clearTokens(): void {
  cached = null
  localStorage.removeItem(STORAGE_KEY)
}

/** 是否已登录 */
export function isLoggedIn(): boolean {
  return getAccessToken() !== null
}
