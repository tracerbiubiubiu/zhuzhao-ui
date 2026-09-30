/**
 * 用户会话 Store（zhuzhao 契约版）
 * - session = TokenStorage（AT/RT/device_id）+ 用户基本信息+权限码（无角色——Profile 无角色字段）
 * - 登录/登出/改密走 @/api/auth（device_id 三处同源）
 * - must_change_password 由登录响应透传（守卫 §3.1 分支 4）
 */

import { defineStore } from 'pinia'
import { store } from '../index'
import { loginApi, logoutApi, updatePasswordApi, type LoginParams } from '@/api/auth'
import {
  clearTokens, setTokens, isLoggedIn, type TokenPair,
} from '@/common/auth/tokenStorage'
// 静态导入（复检 P1-2 修）：vueQuery 模块零应用侧依赖（仅 @tanstack/vue-query），
// 无环；原 logout 内动态导入既漏了 resetState 三路（401 终态/守卫失败不清缓存），
// 又是 build INEFFECTIVE_DYNAMIC_IMPORT 警告源
import { queryClient } from '@/plugins/vueQuery'
import { usePermissionStore } from './permission'
import { useTagsViewStore } from './tagsView'
import { resetRouter } from '@/router'
import { resetCatchAll } from '@/permission'

/** GET /user/profile 响应（User 结构体——无角色字段） */
export interface UserProfile {
  id: string
  username: string
  employee_no: string
  real_name: string
  email: string
  phone: string
  avatar: string
  must_change_password: boolean
}

/** GET /user/permissions 响应（权限码数组——前端显隐用，非安全边界） */
export type PermissionCodes = string[]

interface UserState {
  profile: UserProfile | null
  permissions: PermissionCodes
  /** 首登强制改密标记（登录响应透传；改密成功后置 false） */
  mustChangePassword: boolean
  /** session 已加载标志（守卫防重入死循环） */
  sessionLoaded: boolean
  rawMenus: unknown[]
}

/**
 * 权限码匹配——已带命名空间前缀（`button:`/`route:`）的完整码直通，裸码按按钮码拼
 * `button:` 前缀（01 §3.4：码 = `button:` + menus.permission 字面值）。三个 getter 必须
 * 共用同一匹配（曾各自实现导致 hasAny 漏拼前缀恒 miss——按钮对有权限用户永久置灰；
 * 亦曾误拼 `button:route:/x` 使 hasAny 收窄匹配不了路由码——检视 P2）。
 */
function matchesCode(permissions: PermissionCodes, code: string): boolean {
  if (code.startsWith('button:') || code.startsWith('route:')) {
    return permissions.includes(code)
  }
  return permissions.includes(`button:${code}`)
}

export const useUserStore = defineStore('user', {
  state: (): UserState => ({
    profile: null,
    permissions: [],
    mustChangePassword: false,
    sessionLoaded: false,
    rawMenus: [],
  }),

  getters: {
    isAuthenticated(): boolean {
      return isLoggedIn()
    },
    /** 按钮权限判定：button:{permission} 码（01 §3.4——= menus.permission 字面值） */
    hasPermission(state) {
      return (code: string) => matchesCode(state.permissions, code)
    },
    /** 路由权限判定：route:{path} */
    hasRoute(state) {
      return (path: string) => state.permissions.includes(`route:${path}`)
    },
    /** 任意码判定（复杂组合走此函数式；与 hasPermission 同一套 button: 匹配） */
    hasAny(state) {
      return (...codes: string[]) => codes.some((c) => matchesCode(state.permissions, c))
    },
  },

  actions: {
    /** 登录（存 TokenPair+标记 mustChangePassword） */
    async login(params: LoginParams) {
      const pair: TokenPair = await loginApi(params)
      setTokens(pair)
      this.mustChangePassword = pair.must_change_password ?? false
      this.sessionLoaded = false // 新会话须重拉 profile/permissions
    },

    /** 刷新后加载 session 三件：profile + menus + permissions（守卫 §3.1 步 3） */
    async loadSession() {
      if (this.sessionLoaded) return
      // P3-4 修复：静态导入消除 INEFFECTIVE_DYNAMIC_IMPORT（动态导入在 tree-shake 后无效——build 警告根因）
      const { default: request } = await import('@vea/request')
      const [profile, perms, menus] = await Promise.all([
        request.get('/api/v1/user/profile'),
        request.get('/api/v1/user/permissions'),
        request.get('/api/v1/user/menus'),
      ])
      this.rawMenus = ((menus as unknown as { menus?: unknown[] })?.menus ?? [])
      this.profile = profile as unknown as UserProfile
      this.permissions = ((perms as unknown as { permissions?: string[] })?.permissions ?? []) as string[]
      if (this.profile?.must_change_password) {
        this.mustChangePassword = true
      }
      this.sessionLoaded = true
    },

    /** 改密（成功=TokenPair 轮换——整体替换+清 mustChangePassword） */
    async changePassword(oldPassword: string, newPassword: string) {
      const pair: TokenPair = await updatePasswordApi(oldPassword, newPassword)
      setTokens(pair)
      this.mustChangePassword = false
      if (this.profile) this.profile.must_change_password = false
    },

    /** 登出（先调 logoutApi，无论成败都拆除会话） */
    async logout() {
      try {
        await logoutApi()
      } finally {
        // 会话拆除收敛为唯一实现（与 401 终态 / 守卫加载失败共用——缓存清空在 resetState 内）
        this.resetState()
      }
    },

    /**
     * 会话拆除（唯一实现——登出 / 401 终态 / 守卫加载失败共用，§3.1/§3.3）
     *
     * 必须「彻底」：`_redirectToLogin()` 只改 `location.hash`、**不整页刷新**，
     * Pinia 实例在标签页内存活。若只清 token/用户态而不清 permissionStore，
     * 同标签换用户登录时 `ensureDynamicRoutes()` 会因 `isAddRouters===true` 提前 return，
     * 新用户的菜单永久不会 addRoute → 侧栏/路由残留上一个用户的可见性（跨用户越权）。
     * 故此处清：token + 用户态（含 rawMenus）+ 动态路由/注册标志 + tagsView + 路由注册表。
     */
    resetState() {
      // 1. token
      clearTokens()
      // 2. 用户态复位（含 rawMenus——菜单缓存，不随 token 清除会串会话）
      this.profile = null
      this.permissions = []
      this.mustChangePassword = false
      this.sessionLoaded = false
      this.rawMenus = []
      // 3. 权限动态路由复位（isAddRouters 必须回 false，否则新会话不重注册）
      usePermissionStore().reset()
      // 4. 标签页复位
      useTagsViewStore().removeAllViews()
      // 5. 路由注册表复位（清动态路由 + 允许 catch-all 下次重新尾注册）
      resetRouter()
      resetCatchAll()
      // 6. 服务端态缓存清空（01 §4：防跨用户残留上一账号的列表/详情缓存——
      //    复检 P1-2：此前仅在 logout 清，401 终态与守卫失败走本方法不清 → 跨用户串台）
      queryClient.clear()
    },
  },
})

export const useUserStoreWithOut = () => useUserStore(store)
