import { describe, expect, it } from 'vitest'
import { classifySessionLoadError } from './sessionError'

/** 仿 axios 错误形态：{ response: { status, data } } */
const axiosErr = (status: number, code?: number) => ({
  response: { status, data: code === undefined ? undefined : { code } },
})

describe('classifySessionLoadError（§3.3 会话加载失败分段）', () => {
  it('403+20007 强制改密 → change-password（不清会话）', () => {
    expect(classifySessionLoadError(axiosErr(403, 20007))).toBe('change-password')
  })

  it('5xx → transient（503+10008 Redis 抖动 / 502 网关不可达均保会话）', () => {
    expect(classifySessionLoadError(axiosErr(503, 10008))).toBe('transient')
    expect(classifySessionLoadError(axiosErr(502, 10008))).toBe('transient')
    expect(classifySessionLoadError(axiosErr(500))).toBe('transient')
  })

  it('429 限流 → transient（10007，Retry-After 后可重试，不得登出）', () => {
    expect(classifySessionLoadError(axiosErr(429, 10007))).toBe('transient')
  })

  it('401（20002/20003）→ terminal（终态清会话）', () => {
    expect(classifySessionLoadError(axiosErr(401, 20002))).toBe('terminal')
    expect(classifySessionLoadError(axiosErr(401, 20003))).toBe('terminal')
  })

  it('非 20007 的 403 → transient（审计修正：裸 403 归 transient，仅带业务码的终态 403 拆会话）', () => {
    expect(classifySessionLoadError(axiosErr(403, 10004))).toBe('terminal')
    expect(classifySessionLoadError(axiosErr(403))).toBe('transient')
  })

  it('无响应（网络断开/超时）与非 axios 形态错误 → transient', () => {
    expect(classifySessionLoadError(new Error('Network Error'))).toBe('transient')
    expect(classifySessionLoadError({ message: 'timeout of 30000ms exceeded' })).toBe('transient')
    expect(classifySessionLoadError(undefined)).toBe('transient')
  })

  it('携带 __sessionTransient 标记的 401 → transient（refresh 端点 5xx/网络失败，§3.3 红线）', () => {
    // 请求层在 refresh 非终态失败时给原始 401 打标——缺此分支则一次 503 仍会登出（跨层分歧）
    expect(classifySessionLoadError({ ...axiosErr(401, 20002), __sessionTransient: true })).toBe('transient')
  })
})
