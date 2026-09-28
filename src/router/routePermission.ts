/**
 * route:{path} 码校验（纯函数，便于单测——设计 §3.1⑥ / §3.4）
 *
 * §3.4：路由级兜底——菜单树本身已过滤可见性，此层防御「用户手输 URL 直抵」。
 * 码由后端 `GET /user/permissions` 下发（admin/superadmin 由后端全量展开）。
 *
 * 本模块无副作用、不依赖 store/router，可在 node 环境直接单测。
 */

/** 权限码前缀（路由级） */
export const ROUTE_CODE_PREFIX = 'route:'

/**
 * 无条件豁免的路径：
 * - `/home`：公共工作台，种子 home 对所有登录用户可见
 * - `/login`、`/change-password`、`/session-error`：白名单页（守卫 step 1 已放行，此处双保险）
 * - `/403`：无权限页自身（不豁免会自锁——跳入后再校验永无 route:/403 码）
 * - `/profile`：个人中心（§3.2④ 菜单外静态补充路由——无 route: 码，任何登录用户可达）
 * - `/my-org`：「我的组织」自服务面（§3.2④ 同款——owner/admin 经 L3 见委托控件，委托端点跳 Casbin）
 * redirect 中转、404 页在 isExemptRoute 内另行判定。
 */
export const ROUTE_EXEMPT_PATHS = ['/home', '/login', '/change-password', '/session-error', '/403', '/profile', '/my-org']

/** 404 页自身（catch-all 命中时的路由名）——不参与校验，否则会自锁 */
const NOT_FOUND_ROUTE_NAME = 'NotFound'

export type RouteCheckReason = 'exempt' | 'degraded' | 'has-code' | 'no-code'

export interface RouteCheckResult {
  /** 是否放行 */
  allow: boolean
  /** 是否走了降级分支（后端 route: 码族未就绪） */
  degraded: boolean
  reason: RouteCheckReason
}

/** 目标路由是否属于豁免清单（不校验 route: 码） */
export function isExemptRoute(to: { path: string; name?: unknown }): boolean {
  if (to.name === NOT_FOUND_ROUTE_NAME) return true
  const path = to.path
  if (path === '/' || path === '') return true
  if (ROUTE_EXEMPT_PATHS.includes(path)) return true
  // redirect 中转（/redirect/:path(.*)）——tags 刷新用，不参与权限
  // （精确前缀：'/redirect/' 起——裸 startsWith('/redirect') 会误豁免 '/redirector' 类路径）
  if (path === '/redirect' || path.startsWith('/redirect/')) return true
  return false
}

/**
 * 校验目标路由是否持有 `route:{path}` 码。
 *
 * 规则（§3.1⑥）：
 *  1. 豁免路径 → 放行（exempt）
 *  2. 后端一条 `route:` 码都没有 → 码族未就绪，降级放行（degraded）。
 *     ⚠ 这是**刻意的降级保护**：若因后端未上线该码族而一律落 404，会「整站打死」
 *     （所有业务页对 admin 也不可达）。菜单可见性由后端 /user/menus 过滤兜底，
 *     真实鉴权在后端三层（§6），前端此层仅体验层拦截，故未就绪时不阻断。
 *  3. 有码族 → 命中放行，未命中落 404（no-code）。
 */
export function checkRoutePermission(
  to: { path: string; name?: unknown },
  permissions: readonly string[],
): RouteCheckResult {
  if (isExemptRoute(to)) {
    return { allow: true, degraded: false, reason: 'exempt' }
  }

  const hasAnyRouteCode = permissions.some(
    (code) => typeof code === 'string' && code.startsWith(ROUTE_CODE_PREFIX),
  )
  if (!hasAnyRouteCode) {
    return { allow: true, degraded: true, reason: 'degraded' }
  }

  const required = `${ROUTE_CODE_PREFIX}${to.path}`
  return permissions.includes(required)
    ? { allow: true, degraded: false, reason: 'has-code' }
    : { allow: false, degraded: false, reason: 'no-code' }
}
