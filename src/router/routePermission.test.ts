/**
 * route:{path} 码校验纯函数单测（01 §3.1⑥ / §3.4）
 */
import { describe, it, expect } from 'vitest'
import { checkRoutePermission, isExemptRoute } from '@/router/routePermission'

describe('checkRoutePermission', () => {
  it('豁免清单：/home、/login、/change-password、/session-error、/403、/profile、/redirect*、根、404 自身', () => {
    for (const path of ['/home', '/login', '/change-password', '/session-error', '/403', '/profile', '/my-org', '/redirect/system/user', '/']) {
      expect(isExemptRoute({ path })).toBe(true)
      expect(checkRoutePermission({ path }, []).reason).toBe('exempt')
    }
    // 404 页自身（catch-all 命中）
    expect(isExemptRoute({ path: '/somewhere', name: 'NotFound' })).toBe(true)
    expect(checkRoutePermission({ path: '/somewhere', name: 'NotFound' }, []).allow).toBe(true)
    // /403 不豁免会自锁（守卫 no-code 分支跳入后再校验永无 route:/403 码）
    // redirect 前缀精确化：'/redirector' 类近似前缀路径不再被误豁免
    expect(isExemptRoute({ path: '/redirector' })).toBe(false)
  })

  it('有码放行（has-code）', () => {
    const result = checkRoutePermission(
      { path: '/system/user' },
      ['route:/system/user', 'button:user:create'],
    )
    expect(result).toEqual({ allow: true, degraded: false, reason: 'has-code' })
  })

  it('无码落 404（no-code）——码族已就绪但目标缺码', () => {
    const result = checkRoutePermission(
      { path: '/system/user' },
      ['route:/home', 'route:/system/role'],
    )
    expect(result).toEqual({ allow: false, degraded: false, reason: 'no-code' })
  })

  it('降级跳过（degraded）——后端一条 route: 码都没有（码族未就绪，防整站打死）', () => {
    const withButtonOnly = checkRoutePermission({ path: '/system/user' }, ['button:user:create'])
    expect(withButtonOnly).toEqual({ allow: true, degraded: true, reason: 'degraded' })

    const empty = checkRoutePermission({ path: '/system/user' }, [])
    expect(empty).toEqual({ allow: true, degraded: true, reason: 'degraded' })
  })

  it('非字符串/非 route: 前缀的码不触发就绪判定', () => {
    const result = checkRoutePermission({ path: '/audit' }, ['something_else'])
    expect(result.degraded).toBe(true)
  })
})
