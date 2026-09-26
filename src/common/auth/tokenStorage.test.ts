/**
 * TokenStorage 单测（01 §3.3）——device_id 首次生成并持久化 + AT/RT set/get/clear。
 *
 * 用 vi.resetModules() + 动态 import 拿到干净的模块态（模块内有内存缓存）。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const freshTokenStorage = async () => {
  vi.resetModules()
  return import('@/common/auth/tokenStorage')
}

describe('tokenStorage', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('device_id 首次生成并持久化，白名单字符集合规，二次读取稳定', async () => {
    const mod = await freshTokenStorage()
    const id = mod.getDeviceId()
    expect(id).toMatch(/^[a-zA-Z0-9_-]{1,64}$/)
    expect(localStorage.getItem('zhuzhao_device_id')).toBe(id)
    expect(mod.getDeviceId()).toBe(id) // 内存缓存命中同一值
  })

  it('device_id 已存在时沿用持久化值', async () => {
    localStorage.setItem('zhuzhao_device_id', 'existing-device-id')
    const mod = await freshTokenStorage()
    expect(mod.getDeviceId()).toBe('existing-device-id')
  })

  it('set / get / clear TokenPair', async () => {
    const mod = await freshTokenStorage()
    expect(mod.isLoggedIn()).toBe(false)

    mod.setTokens({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600 })
    expect(mod.getAccessToken()).toBe('AT')
    expect(mod.getRefreshToken()).toBe('RT')
    expect(mod.isLoggedIn()).toBe(true)

    mod.clearTokens()
    expect(mod.getAccessToken()).toBeNull()
    expect(mod.getRefreshToken()).toBeNull()
    expect(mod.isLoggedIn()).toBe(false)
    expect(localStorage.getItem('zhuzhao_tokens')).toBeNull()
  })

  it('冷启动从 localStorage 反序列化缓存', async () => {
    localStorage.setItem('zhuzhao_tokens', JSON.stringify({ access_token: 'A2', refresh_token: 'R2' }))
    const mod = await freshTokenStorage()
    expect(mod.getAccessToken()).toBe('A2')
    expect(mod.getRefreshToken()).toBe('R2')
  })

  it('损坏的存储数据视为未登录（不抛）', async () => {
    localStorage.setItem('zhuzhao_tokens', '{not-json')
    const mod = await freshTokenStorage()
    expect(mod.getAccessToken()).toBeNull()
  })
})
