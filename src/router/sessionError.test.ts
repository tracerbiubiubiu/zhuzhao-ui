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

  it('非 20007 的 403 → terminal', () => {
    expect(classifySessionLoadError(axiosErr(403, 10004))).toBe('terminal')
    expect(classifySessionLoadError(axiosErr(403))).toBe('terminal')
  })

  it('无响应（网络断开/超时）与非 axios 形态错误 → transient', () => {
    expect(classifySessionLoadError(new Error('Network Error'))).toBe('transient')
    expect(classifySessionLoadError({ message: 'timeout of 30000ms exceeded' })).toBe('transient')
    expect(classifySessionLoadError(undefined)).toBe('transient')
  })
})
