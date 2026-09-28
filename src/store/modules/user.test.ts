/**
 * user store 权限 getter 单测（01 §3.4）
 *
 * 背景：hasAny 曾与 hasPermission 各自实现（漏拼 button: 前缀恒 miss），且 getter 层
 * 零测试盲区——本文件钉死三个 getter 共用同一套匹配语义。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useUserStore } from './user'

// 打桩 @/router（避免真实 router 的 createWebHashHistory DOM 依赖——request 单测同款约定）
vi.mock('@/router', () => ({
  __esModule: true,
  default: {
    addRoute: vi.fn(),
    getRoutes: vi.fn(() => [] as unknown[]),
    hasRoute: () => false,
    beforeEach: () => {},
    afterEach: () => {},
  },
  resetRouter: vi.fn(),
  constantRouterMap: [],
}))

describe('user store 权限 getter', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('hasPermission：裸码自动拼 button: 前缀；完整码不双拼', () => {
    const store = useUserStore()
    store.permissions = ['button:user:create', 'button:user:update']

    expect(store.hasPermission('user:create')).toBe(true)
    expect(store.hasPermission('user:delete')).toBe(false)
    // 完整码形态（防双拼 button:button:）
    expect(store.hasPermission('button:user:create')).toBe(true)
    // 后端原始串（无 button: 前缀的码）不因恰好包含子串误命中
    expect(store.hasPermission('user:cre')).toBe(false)
  })

  it('hasAny：与 hasPermission 同一套匹配（回归——曾裸串恒 miss）', () => {
    const store = useUserStore()
    store.permissions = ['button:user:update']

    // 回归断言：修复前 hasAny('user:update') 恒 false（漏拼前缀）
    expect(store.hasAny('user:update')).toBe(true)
    expect(store.hasAny('user:create', 'user:update')).toBe(true)
    expect(store.hasAny('user:create', 'user:delete')).toBe(false)
    // 完整码混入同样命中
    expect(store.hasAny('button:user:update')).toBe(true)
  })

  it('命名空间直通：route: 码不被误拼 button: 前缀（回归——曾 button:route:/x 恒 miss）', () => {
    const store = useUserStore()
    store.permissions = ['route:/system/user', 'button:user:create']

    expect(store.hasAny('route:/system/user')).toBe(true)
    expect(store.hasPermission('route:/system/user')).toBe(true)
    expect(store.hasAny('route:/system/role', 'user:create')).toBe(true)
    expect(store.hasAny('route:/nope')).toBe(false)
  })

  it('hasRoute：route:{path} 精确匹配，不受 button: 匹配影响', () => {
    const store = useUserStore()
    store.permissions = ['route:/system/user', 'button:user:create']

    expect(store.hasRoute('/system/user')).toBe(true)
    expect(store.hasRoute('/system/role')).toBe(false)
    expect(store.hasPermission('/system/user')).toBe(false)
  })
})
