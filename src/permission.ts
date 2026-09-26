/**
 * 路由守卫（01 §3.1 六步实现规格）
 *
 * 1. 白名单页（/login、/change-password）→ 直接放行
 * 2. 无 AT → 重定向 /login（redirect 须校验站内相对路径——防开放重定向）
 * 3. session 未加载 → 并行拉 GET /user/profile + GET /user/menus + GET /user/permissions
 *    → 存 Pinia → 按菜单树 addRoute
 * 4. must_change_password=true → 强制重定向改密页（后端已双保险 403+20007）
 * 5. 注册 404 catch-all（必须在全部 addRoute 之后，仅一次）
 * 6. next()；目标路由不存在 → 落 404 页
 */

import type { RouteRecordRaw } from 'vue-router'
import NProgress from 'nprogress'
import router from './router'
import { isLoggedIn } from '@/common/auth/tokenStorage'
import { NO_REDIRECT_WHITE_LIST } from './constants'
import { checkRoutePermission } from './router/routePermission'
import { usePermissionStoreWithOut } from '@/store/modules/permission'
import { useUserStoreWithOut } from '@/store/modules/user'
import 'nprogress/nprogress.css'

NProgress.configure({ showSpinner: false })

/** 白名单：登录页+改密页（强制改密期间唯一可达页） */
const WHITE_LIST = [...NO_REDIRECT_WHITE_LIST, '/change-password']

// ─── 动态路由注册（§3.2）───
let catchAllRegistered = false
/** 登出时重置（B3：防再登录后 catch-all 幽灵跳过注册） */
export const resetCatchAll = () => { catchAllRegistered = false }

/** route: 码族降级告警只发一次（防每次导航刷屏） */
let degradedWarned = false

export const ensureDynamicRoutes = async () => {
  const permissionStore = usePermissionStoreWithOut()
  if (permissionStore.isAddRouters) return false

  // 从 userStore.rawMenus 读（loadSession 三件并行已拉——避免重复请求）
  const userStore = useUserStoreWithOut()
  const menus = userStore.rawMenus as unknown as MenuNode[]

  permissionStore.generateRoutes(menus).forEach((route) => {
    router.addRoute(route as unknown as RouteRecordRaw)
  })

  // 404 catch-all 尾注册（必须在全部 addRoute 之后，仅一次）
  if (!catchAllRegistered) {
    router.addRoute({
      path: '/:pathMatch(.*)*',
      name: 'NotFound',
      component: () => import('@/views/Error/404.vue'),
      meta: { title: '404' },
    })
    catchAllRegistered = true
  }

  permissionStore.setIsAddRouters(true)
  return true
}

/** 后端菜单节点（07-menu 契约） */
export interface MenuNode {
  id: string
  code: string
  name: string
  menu_type: number // 1=目录 2=页面 3=按钮（不进树）
  path: string
  component: string
  icon: string
  sort_order: number
  visible: boolean
  children?: MenuNode[]
}

// ─── 守卫 ───
export const setupPermission = () => {
  router.beforeEach(async (to, _from, next) => {
    NProgress.start()

    // 1. 白名单直接放行
    if (WHITE_LIST.includes(to.path)) {
      next()
      return
    }

    // 2. 无 AT → 跳登录（带 redirect）
    if (!isLoggedIn()) {
      next({ path: '/login', query: { redirect: to.fullPath } })
      return
    }

    const userStore = useUserStoreWithOut()

    // 3. session 未加载（首跳/刷新）→ 三件并行
    if (!userStore.sessionLoaded) {
      try {
        await userStore.loadSession()
        await ensureDynamicRoutes()
        // 重新导航到目标（addRoute 后路由表已变，需 replace 触发匹配）
        next({ ...to, replace: true })
        return
      } catch (err) {
        // 区分：有 HTTP 响应（401/4xx 终态）→ 清跳登录；无响应（网络/5xx）→ 保留会话
        const hasResponse = (err as { response?: unknown })?.response !== undefined
        if (hasResponse) {
          userStore.resetState()
          next({ path: '/login', query: { redirect: to.fullPath } })
        } else {
          console.warn('[guard] session load network error, keeping session', err)
          next(false)
        }
        return
      }
    }

    // 4. must_change_password → 强制跳改密页
    if (userStore.mustChangePassword && to.path !== '/change-password') {
      next('/change-password')
      return
    }

    // 5. route:{path} 校验（FE3——真实边界在后端三层，此处为体验层拦截手输 URL）
    //    纯函数 checkRoutePermission：豁免清单/无码落 404/码族未就绪降级（见其注释）
    const routeCheck = checkRoutePermission(to, userStore.permissions)
    if (routeCheck.degraded && !degradedWarned) {
      degradedWarned = true
      console.warn(
        '[permission] 后端未下发任何 route: 权限码（GET /user/permissions 缺 route: 码族）——' +
          'route:{path} 校验降级跳过，仅依赖后端 /user/menus 过滤与后端鉴权。' +
          '待后端该码族就绪后自动恢复校验。',
      )
    }
    if (!routeCheck.allow) {
      // 无权限/路由不存在 → 落 404 页（§3.1⑥）。catch-all 已在 ensureDynamicRoutes 内尾注册，
      // 404 自身走 isExemptRoute 豁免，不会产生重定向循环。
      next({ name: 'NotFound', replace: true })
      return
    }

    // 6. 放行
    next()
  })

  router.afterEach(() => {
    NProgress.done()
  })
}

// 兼容旧导出（LoginForm 等处使用）
export const setupPermissionGuard = setupPermission
